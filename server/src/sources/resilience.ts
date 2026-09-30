import { SourceNotConfiguredError } from './types';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(`${label}: превышено время ожидания ${ms} мс`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  isRetryable?: (err: unknown) => boolean;
}

/** Повтор с экспоненциальной задержкой и джиттером. */
export async function retry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const retryable = opts.isRetryable ? opts.isRetryable(err) : !(err instanceof SourceNotConfiguredError);
      if (!retryable || attempt === opts.attempts) break;
      const delay = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** (attempt - 1));
      await sleep(delay / 2 + Math.random() * (delay / 2));
    }
  }
  throw lastErr;
}

export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`${name}: источник временно отключён после серии ошибок`);
    this.name = 'CircuitOpenError';
  }
}

/** Простой circuit breaker: после N ошибок подряд перестаёт дёргать источник на resetTimeoutMs. */
export class CircuitBreaker {
  private state: BreakerState = 'CLOSED';
  private failures = 0;
  private openedAt = 0;

  constructor(
    readonly name: string,
    private readonly failureThreshold = 5,
    private readonly resetTimeoutMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  get currentState(): BreakerState {
    if (this.state === 'OPEN' && this.now() - this.openedAt >= this.resetTimeoutMs) this.state = 'HALF_OPEN';
    return this.state;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (this.currentState === 'OPEN') throw new CircuitOpenError(this.name);
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      if (!(err instanceof SourceNotConfiguredError)) this.onFailure();
      throw err;
    }
  }

  private onSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  private onFailure() {
    this.failures += 1;
    if (this.state === 'HALF_OPEN' || this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.openedAt = this.now();
    }
  }
}
