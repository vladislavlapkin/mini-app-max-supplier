import os from 'node:os';
import type { Logger } from '../logger';
import type { RedisClient } from './redis';

/**
 * Очередь фоновых задач на Redis Streams с consumer group.
 * Webhook только кладёт событие в очередь и сразу отвечает 200; обработка — здесь.
 * Незавершённые задачи подбираются через XAUTOCLAIM, после 5 попыток уходят в dead-letter stream.
 */
export class StreamQueue<T> {
  private running = false;
  private readonly consumer = `${os.hostname()}-${process.pid}`;

  constructor(
    private readonly redis: RedisClient,
    private readonly blocking: RedisClient,
    private readonly stream: string,
    private readonly group: string,
    private readonly log: Logger,
    private readonly maxDeliveries = 5,
  ) {}

  async init(): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', this.stream, this.group, '$', 'MKSTREAM');
    } catch (err) {
      if (!String((err as Error).message).includes('BUSYGROUP')) throw err;
    }
  }

  async push(job: T): Promise<string> {
    return (await this.redis.xadd(this.stream, 'MAXLEN', '~', '10000', '*', 'data', JSON.stringify(job))) as string;
  }

  start(handler: (job: T) => Promise<void>, concurrency = 4): void {
    this.running = true;
    void this.loop(handler, concurrency);
    void this.reclaimLoop(handler);
  }

  stop(): void {
    this.running = false;
  }

  private async handle(id: string, fields: string[], handler: (job: T) => Promise<void>): Promise<void> {
    const idx = fields.indexOf('data');
    try {
      const job = JSON.parse(fields[idx + 1]) as T;
      await handler(job);
      await this.redis.xack(this.stream, this.group, id);
    } catch (err) {
      this.log.error({ err: (err as Error).message, jobId: id, stream: this.stream }, 'job failed, will retry');
    }
  }

  private async loop(handler: (job: T) => Promise<void>, concurrency: number): Promise<void> {
    while (this.running) {
      try {
        const res = (await this.blocking.xreadgroup('GROUP', this.group, this.consumer, 'COUNT', concurrency, 'BLOCK', 5000, 'STREAMS', this.stream, '>')) as
          | [string, [string, string[]][]][]
          | null;
        if (!res) continue;
        const entries = res[0][1];
        await Promise.all(entries.map(([id, fields]) => this.handle(id, fields, handler)));
      } catch (err) {
        if (!this.running) break;
        const message = (err as Error).message;
        this.log.error({ err: message }, 'queue read failed');
        // Поток или группа удалены (например, после очистки Redis) — пересоздаём и продолжаем
        if (message.includes('NOGROUP')) await this.init().catch(() => undefined);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private async reclaimLoop(handler: (job: T) => Promise<void>): Promise<void> {
    while (this.running) {
      await new Promise((r) => setTimeout(r, 15_000));
      if (!this.running) break;
      try {
        const pending = (await this.redis.xpending(this.stream, this.group, '-', '+', 20)) as [string, string, number, number][];
        for (const [id, , idleMs, deliveries] of pending) {
          if (idleMs < 30_000) continue;
          if (deliveries >= this.maxDeliveries) {
            const entry = (await this.redis.xrange(this.stream, id, id)) as [string, string[]][];
            if (entry[0]) await this.redis.xadd(`${this.stream}:dead`, '*', ...entry[0][1]);
            await this.redis.xack(this.stream, this.group, id);
            this.log.error({ jobId: id }, 'job moved to dead-letter stream');
            continue;
          }
          const claimed = (await this.redis.xclaim(this.stream, this.group, this.consumer, 30_000, id)) as [string, string[]][];
          for (const [cid, fields] of claimed) await this.handle(cid, fields, handler);
        }
      } catch (err) {
        this.log.warn({ err: (err as Error).message }, 'queue reclaim failed');
      }
    }
  }
}
