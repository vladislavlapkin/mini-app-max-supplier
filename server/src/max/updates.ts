import crypto from 'node:crypto';
import { z } from 'zod';
import type { RedisClient } from '../infra/redis';
import type { MaxUpdate } from './types';

const user = z.object({ user_id: z.number() }).passthrough();
const message = z
  .object({
    recipient: z.object({ chat_id: z.number().nullable().optional(), user_id: z.number().nullable().optional() }).passthrough(),
    body: z.object({ mid: z.string(), text: z.string().nullable().optional() }).passthrough(),
    sender: user.nullable().optional(),
    timestamp: z.number(),
  })
  .passthrough();

/** Валидация входящих событий MAX: неизвестные типы пропускаем, известные проверяем строго. */
export const updateSchema = z.discriminatedUnion('update_type', [
  z.object({ update_type: z.literal('message_created'), timestamp: z.number(), message }).passthrough(),
  z
    .object({
      update_type: z.literal('message_callback'),
      timestamp: z.number(),
      callback: z.object({ callback_id: z.string(), payload: z.string().optional(), user, timestamp: z.number() }).passthrough(),
      message: message.nullable().optional(),
    })
    .passthrough(),
  z.object({ update_type: z.literal('bot_started'), timestamp: z.number(), chat_id: z.number(), user, payload: z.string().nullable().optional() }).passthrough(),
]);

export const KNOWN_UPDATE_TYPES = ['message_created', 'message_callback', 'bot_started'];

export function parseUpdate(raw: unknown): { ok: true; update: MaxUpdate } | { ok: false; skip: boolean; error?: string } {
  const type = (raw as { update_type?: unknown })?.update_type;
  if (typeof type !== 'string') return { ok: false, skip: false, error: 'update_type отсутствует' };
  if (!KNOWN_UPDATE_TYPES.includes(type)) return { ok: false, skip: true };
  const res = updateSchema.safeParse(raw);
  if (!res.success) return { ok: false, skip: false, error: res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  return { ok: true, update: res.data as MaxUpdate };
}

/**
 * Ключ дедупликации. В MAX нет update_id, поэтому используем идентификаторы самих событий:
 * mid сообщения, callback_id нажатия, а для остальных — хэш содержимого.
 */
export function dedupKey(u: MaxUpdate): string {
  if (u.update_type === 'message_created' && 'message' in u) return `mc:${(u as { message: { body: { mid: string } } }).message.body.mid}`;
  if (u.update_type === 'message_callback' && 'callback' in u) return `cb:${(u as { callback: { callback_id: string } }).callback.callback_id}`;
  return `h:${crypto.createHash('sha256').update(JSON.stringify(u)).digest('hex').slice(0, 32)}`;
}

/** true — событие новое; false — повторная доставка (идемпотентность). */
export async function markUpdateSeen(redis: RedisClient, key: string, ttlSec = 86_400): Promise<boolean> {
  const res = await redis.set(`upd:${key}`, '1', 'EX', ttlSec, 'NX');
  return res === 'OK';
}
