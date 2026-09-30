import type { StreamQueue } from '../infra/queue';
import type { RedisClient } from '../infra/redis';
import type { Logger } from '../logger';
import type { MaxApi } from '../max/client';
import type { MaxUpdate } from '../max/types';
import { dedupKey, markUpdateSeen, parseUpdate } from '../max/updates';
import type { BotTransport } from './orchestrator';
import { T } from './texts';

export function maxTransport(api: MaxApi): BotTransport {
  return {
    async send(to, body) {
      await api.sendMessage(to, body);
    },
    async answer(callbackId, body) {
      await api.answerCallback(callbackId, body);
    },
  };
}

export type IngestResult = 'queued' | 'duplicate' | 'skipped' | 'invalid';

/** Приём событий MAX: валидация → дедупликация → очередь. Одинаков для webhook и long polling. */
export class UpdateIngestor {
  constructor(
    private readonly redis: RedisClient,
    private readonly queue: StreamQueue<MaxUpdate>,
    private readonly log: Logger,
  ) {}

  async ingest(raw: unknown): Promise<IngestResult> {
    const parsed = parseUpdate(raw);
    if (!parsed.ok) {
      if (!parsed.skip) this.log.warn({ err: parsed.error }, 'invalid MAX update payload');
      return parsed.skip ? 'skipped' : 'invalid';
    }
    const key = dedupKey(parsed.update);
    if (!(await markUpdateSeen(this.redis, key))) {
      this.log.info({ key }, 'duplicate MAX update ignored');
      return 'duplicate';
    }
    await this.queue.push(parsed.update);
    return 'queued';
  }
}

/** Long polling для локальной разработки, когда нет публичного HTTPS для webhook. */
export class Poller {
  private running = false;

  constructor(
    private readonly api: MaxApi,
    private readonly redis: RedisClient,
    private readonly ingestor: UpdateIngestor,
    private readonly log: Logger,
  ) {}

  start(): void {
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
  }

  private async loop(): Promise<void> {
    this.log.info('MAX long polling started');
    while (this.running) {
      try {
        const stored = await this.redis.get('max:marker');
        const res = await this.api.getUpdates({ marker: stored ? Number(stored) : null, timeout: 25, types: ['message_created', 'message_callback', 'bot_started'] });
        for (const u of res.updates ?? []) await this.ingestor.ingest(u);
        if (res.marker !== null && res.marker !== undefined) await this.redis.set('max:marker', String(res.marker));
      } catch (err) {
        if (!this.running) break;
        this.log.warn({ err: (err as Error).message }, 'long polling error, retry in 5s');
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }
}

/** Уведомления бота, инициированные из mini-app. */
export class BotNotifier {
  constructor(
    private readonly api: MaxApi | null,
    private readonly log: Logger,
  ) {}

  async selectionSaved(userId: string): Promise<boolean> {
    if (!this.api || !/^\d+$/.test(userId)) return false;
    try {
      await this.api.sendMessage({ userId: Number(userId) }, { text: T.selectionSaved });
      return true;
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'notify selection saved failed');
      return false;
    }
  }
}
