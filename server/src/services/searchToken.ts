import crypto from 'node:crypto';
import { type SearchQuery, searchQuerySchema } from '../domain/types';
import type { RedisClient } from '../infra/redis';

export interface SearchTokenRecord {
  token: string;
  max_user_id: string;
  query: SearchQuery;
  created_at: string;
  expires_at: string;
}

/** Параметр startapp: латиница, цифры, «_» и «-», до 512 символов. */
export const START_PARAM_RE = /^[A-Za-z0-9_-]{1,512}$/;

/**
 * Короткоживущий search_token: бот не передаёт весь запрос в URL,
 * а сохраняет его на сервере и кладёт в deep link только непрозрачный токен.
 */
export class SearchTokenService {
  constructor(
    private readonly redis: RedisClient,
    private readonly ttlSec: number,
  ) {}

  async create(maxUserId: string, query: SearchQuery): Promise<SearchTokenRecord> {
    const token = `st_${crypto.randomBytes(18).toString('base64url')}`;
    const now = Date.now();
    const record: SearchTokenRecord = {
      token,
      max_user_id: maxUserId,
      query: searchQuerySchema.parse(query),
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + this.ttlSec * 1000).toISOString(),
    };
    await this.redis.set(`st:${token}`, JSON.stringify(record), 'EX', this.ttlSec);
    return record;
  }

  async get(token: string): Promise<SearchTokenRecord | null> {
    if (!START_PARAM_RE.test(token) || !token.startsWith('st_')) return null;
    const raw = await this.redis.get(`st:${token}`);
    if (!raw) return null;
    return JSON.parse(raw) as SearchTokenRecord;
  }
}
