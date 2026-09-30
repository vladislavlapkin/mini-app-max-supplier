import crypto from 'node:crypto';
import type { CertificateRequirement, SupplierTypePref } from '../domain/types';
import type { RedisClient } from '../infra/redis';

/** Состояния диалога (раздел 6.1 ТЗ). */
export type DialogState =
  | 'NEW'
  | 'WAITING_PRODUCT'
  | 'WAITING_REGION'
  | 'WAITING_VOLUME'
  | 'WAITING_SUPPLIER_TYPE'
  | 'WAITING_CERTIFICATE'
  | 'QUERY_CONFIRMATION'
  | 'APP_OPENING'
  | 'SEARCHING'
  | 'SHOWING_RESULTS'
  | 'SHOWING_DETAILS'
  | 'COMPLETED'
  | 'ERROR';

export interface BotSession {
  session_id: string;
  max_user_id: string;
  chat_id: string | null;
  state: DialogState;
  query_text: string;
  product: { raw: string; normalized: string; name: string; product_id: string | null; category_id: string; confidence: number } | null;
  region: { name: string; code: string } | null;
  volume: { value: number; unit: string; mode: 'up_to' | 'from' | 'exact' } | null;
  wholesale: boolean | null;
  supplier_type: SupplierTypePref | null;
  certificate_requirement: CertificateRequirement | null;
  clarifications_asked: number;
  /** true — пользователь меняет параметры через меню «Изменить параметры». */
  editing: boolean;
  last_search_token: string | null;
  created_at: string;
  updated_at: string;
}

const TTL_SEC = 24 * 3600;

export function newSession(userId: string, chatId: string | null): BotSession {
  const now = new Date().toISOString();
  return {
    session_id: crypto.randomUUID(),
    max_user_id: userId,
    chat_id: chatId,
    state: 'NEW',
    query_text: '',
    product: null,
    region: null,
    volume: null,
    wholesale: null,
    supplier_type: null,
    certificate_requirement: null,
    clarifications_asked: 0,
    editing: false,
    last_search_token: null,
    created_at: now,
    updated_at: now,
  };
}

/** Сессии диалога в Redis с TTL: пользовательские данные не хранятся дольше суток. */
export class SessionStore {
  constructor(private readonly redis: RedisClient) {}

  async get(userId: string, chatId: string | null): Promise<BotSession> {
    const raw = await this.redis.get(`sess:${userId}`);
    if (raw) {
      const s = JSON.parse(raw) as BotSession;
      if (chatId && !s.chat_id) s.chat_id = chatId;
      return s;
    }
    return newSession(userId, chatId);
  }

  async save(s: BotSession): Promise<void> {
    s.updated_at = new Date().toISOString();
    await this.redis.set(`sess:${s.max_user_id}`, JSON.stringify(s), 'EX', TTL_SEC);
  }

  async reset(userId: string, chatId: string | null): Promise<BotSession> {
    const s = newSession(userId, chatId);
    await this.save(s);
    return s;
  }
}
