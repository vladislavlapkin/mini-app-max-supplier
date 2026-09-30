import crypto from 'node:crypto';

export interface InitDataUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export type InitDataResult =
  | { ok: true; user: InitDataUser; startParam: string | null; authDate: number; queryId: string | null; chat: unknown }
  | { ok: false; reason: 'missing' | 'malformed' | 'bad_hash' | 'expired' | 'no_user' };

/**
 * Проверка подписи initData мини-приложения MAX (https://dev.max.ru/docs/webapps/validation):
 *   secret_key = HMAC_SHA256(key = "WebAppData", data = BOT_TOKEN)
 *   hash       = hex(HMAC_SHA256(key = secret_key, data = data_check_string))
 * data_check_string — пары key=value (кроме hash), отсортированные по ключу и соединённые \n.
 * initDataUnsafe на клиенте для проверки не используется.
 */
export function validateInitData(initData: string | undefined | null, botToken: string, maxAgeSec: number, nowSec = Math.floor(Date.now() / 1000)): InitDataResult {
  if (!initData) return { ok: false, reason: 'missing' };
  let params: URLSearchParams;
  try {
    // На случай, если передан весь фрагмент "WebAppData=..."
    const raw = initData.startsWith('WebAppData=') ? decodeURIComponent(initData.slice('WebAppData='.length)) : initData;
    params = new URLSearchParams(raw);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return { ok: false, reason: 'malformed' };

  const pairs: string[] = [];
  params.forEach((value, key) => {
    if (key !== 'hash') pairs.push(`${key}=${value}`);
  });
  pairs.sort((a, b) => a.split('=')[0].localeCompare(b.split('=')[0]));
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(hash.toLowerCase(), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad_hash' };

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || nowSec - authDate > maxAgeSec) return { ok: false, reason: 'expired' };

  let user: InitDataUser | null = null;
  try {
    user = params.get('user') ? (JSON.parse(params.get('user')!) as InitDataUser) : null;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!user || typeof user.id !== 'number') return { ok: false, reason: 'no_user' };

  let chat: unknown = null;
  try {
    chat = params.get('chat') ? JSON.parse(params.get('chat')!) : null;
  } catch {
    chat = null;
  }
  return { ok: true, user, startParam: params.get('start_param'), authDate, queryId: params.get('query_id'), chat };
}

/** Для тестов: формирует корректно подписанную строку initData. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const pairs = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort((a, b) => a.split('=')[0].localeCompare(b.split('=')[0]));
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(pairs.join('\n')).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}
