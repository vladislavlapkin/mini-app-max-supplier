import { maxApiErrors } from '../infra/metrics';
import { type Logger, maskSecrets } from '../logger';
import { CircuitBreaker, sleep } from '../sources/resilience';
import type { BotInfo, MaxUpdate, NewMessageBody } from './types';

export class MaxApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'MaxApiError';
  }
}

/**
 * Клиент MAX Bot API. Токен передаётся только в заголовке Authorization и никогда не пишется в логи.
 * Повтор с экспоненциальной задержкой при 429/5xx и сетевых ошибках, circuit breaker на серию отказов.
 */
export class MaxApi {
  private readonly breaker = new CircuitBreaker('MAX_API', 8, 20_000);

  constructor(
    private readonly token: string,
    private readonly baseUrl: string,
    private readonly log: Logger,
  ) {}

  private async request<T>(method: 'GET' | 'POST' | 'DELETE' | 'PUT', path: string, opts: { query?: Record<string, unknown>; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) url.searchParams.set(k, v.join(','));
      else url.searchParams.set(k, String(v));
    }
    const maxAttempts = 3;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.breaker.exec(async () => {
          const res = await fetch(url, {
            method,
            headers: { Authorization: this.token, ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
            body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
            signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
          });
          const text = await res.text();
          if (!res.ok) {
            maxApiErrors.inc({ method: `${method} ${path}`, status: String(res.status) });
            throw new MaxApiError(res.status, `MAX API ${method} ${path}: HTTP ${res.status} ${maskSecrets(text.slice(0, 300), [this.token])}`);
          }
          return (text ? JSON.parse(text) : {}) as T;
        });
      } catch (err) {
        lastErr = err;
        const status = err instanceof MaxApiError ? err.status : 0;
        const retryable = status === 0 || status === 429 || status >= 500;
        if (!retryable || attempt === maxAttempts) break;
        const delay = Math.min(4000, 300 * 2 ** (attempt - 1));
        await sleep(delay / 2 + Math.random() * (delay / 2));
      }
    }
    const message = maskSecrets(String((lastErr as Error)?.message ?? lastErr), [this.token]);
    this.log.warn({ method, path, err: message }, 'MAX API request failed');
    throw lastErr instanceof MaxApiError ? lastErr : new MaxApiError(0, message);
  }

  getMe(): Promise<BotInfo> {
    return this.request('GET', '/me');
  }

  sendMessage(to: { userId?: number; chatId?: number }, body: NewMessageBody): Promise<unknown> {
    return this.request('POST', '/messages', { query: { user_id: to.userId, chat_id: to.chatId }, body });
  }

  /** Ответ на нажатие callback-кнопки: можно заменить исходное сообщение или показать уведомление. */
  answerCallback(callbackId: string, body: { message?: NewMessageBody; notification?: string }): Promise<unknown> {
    return this.request('POST', '/answers', { query: { callback_id: callbackId }, body });
  }

  getUpdates(params: { marker?: number | null; timeout?: number; limit?: number; types?: string[] }): Promise<{ updates: MaxUpdate[]; marker: number | null }> {
    return this.request('GET', '/updates', {
      query: { marker: params.marker ?? undefined, timeout: params.timeout ?? 30, limit: params.limit ?? 100, types: params.types },
      timeoutMs: ((params.timeout ?? 30) + 15) * 1000,
    });
  }

  getSubscriptions(): Promise<{ subscriptions: { url: string; time: number; update_types?: string[] }[] }> {
    return this.request('GET', '/subscriptions');
  }

  subscribe(url: string, secret: string, updateTypes: string[]): Promise<{ success: boolean; message?: string }> {
    return this.request('POST', '/subscriptions', { body: { url, update_types: updateTypes, secret } });
  }

  unsubscribe(url: string): Promise<{ success: boolean; message?: string }> {
    return this.request('DELETE', '/subscriptions', { query: { url } });
  }
}
