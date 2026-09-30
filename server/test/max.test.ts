import { describe, expect, it } from 'vitest';
import { signInitData, validateInitData } from '../src/max/initData';
import { dedupKey, markUpdateSeen, parseUpdate } from '../src/max/updates';
import { FakeRedis } from './helpers';

const TOKEN = 'test-bot-token-1234567890';
const now = 1_790_000_000;
const fields = {
  auth_date: String(now - 60),
  query_id: 'q-1',
  user: JSON.stringify({ id: 42, first_name: 'Анна' }),
  start_param: 'st_abc',
};

describe('initData', () => {
  it('принимает корректно подписанную строку', () => {
    const res = validateInitData(signInitData(fields, TOKEN), TOKEN, 86400, now);
    expect(res).toMatchObject({ ok: true, user: { id: 42 }, startParam: 'st_abc' });
  });

  it('отклоняет подделанные данные', () => {
    const tampered = signInitData(fields, TOKEN).replace('%22id%22%3A42', '%22id%22%3A43');
    expect(validateInitData(tampered, TOKEN, 86400, now)).toEqual({ ok: false, reason: 'bad_hash' });
  });

  it('отклоняет подпись чужим токеном', () => {
    expect(validateInitData(signInitData(fields, 'other-token-000000'), TOKEN, 86400, now)).toEqual({ ok: false, reason: 'bad_hash' });
  });

  it('отклоняет устаревшие данные', () => {
    expect(validateInitData(signInitData({ ...fields, auth_date: String(now - 90000) }, TOKEN), TOKEN, 86400, now)).toEqual({ ok: false, reason: 'expired' });
  });

  it('отклоняет пустую строку', () => {
    expect(validateInitData('', TOKEN, 86400, now)).toEqual({ ok: false, reason: 'missing' });
  });
});

describe('updates', () => {
  const message = {
    update_type: 'message_created',
    timestamp: 1,
    message: { sender: { user_id: 7, name: 'Иван' }, recipient: { chat_id: 100, chat_type: 'dialog', user_id: 1 }, timestamp: 1, body: { mid: 'mid.1', seq: 1, text: 'краска' } },
  };

  it('валидирует известные события и пропускает неизвестные', () => {
    expect(parseUpdate(message).ok).toBe(true);
    expect(parseUpdate({ update_type: 'dialog_muted', timestamp: 1 })).toEqual({ ok: false, skip: true });
    const bad = parseUpdate({ update_type: 'message_created', timestamp: 1 });
    expect(bad.ok).toBe(false);
  });

  it('повторная доставка того же события распознаётся как дубликат', async () => {
    const redis = new FakeRedis();
    const parsed = parseUpdate(message);
    if (!parsed.ok) throw new Error('parse failed');
    const key = dedupKey(parsed.update);
    expect(key).toBe('mc:mid.1');
    expect(await markUpdateSeen(redis as never, key)).toBe(true);
    expect(await markUpdateSeen(redis as never, key)).toBe(false);
  });

  it('для нажатий используется callback_id', () => {
    const cb = parseUpdate({ update_type: 'message_callback', timestamp: 2, callback: { callback_id: 'cb.9', payload: 'NEW_SEARCH', user: { user_id: 7 }, timestamp: 2 } });
    if (!cb.ok) throw new Error('parse failed');
    expect(dedupKey(cb.update)).toBe('cb:cb.9');
  });
});
