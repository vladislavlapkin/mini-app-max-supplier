import crypto from 'node:crypto';
import pino from 'pino';

/** Поля, которые никогда не попадают в логи (токены, initData, секреты webhook). */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-max-init-data"]',
  'req.headers["x-max-bot-api-secret"]',
  'req.headers["x-admin-token"]',
  'headers.authorization',
  'headers.Authorization',
  'token',
  'access_token',
  'initData',
  '*.token',
  '*.access_token',
  '*.initData',
  '*.phone',
  '*.email',
];

export type Logger = pino.Logger;

export function createLogger(level: string): Logger {
  return pino({
    level,
    base: { service: 'proveren-postavshik' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    formatters: { level: (label) => ({ level: label }) },
  });
}

/** Псевдонимизированный идентификатор пользователя для логов и аналитики. */
export function hashUserId(id: string | number | null | undefined): string | null {
  if (id === null || id === undefined || id === '') return null;
  return crypto.createHash('sha256').update(`uid:${id}`).digest('hex').slice(0, 16);
}

/** Маскирует возможные токены в произвольной строке (на случай ошибок сторонних библиотек). */
export function maskSecrets(text: string, secrets: (string | undefined)[]): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 6) out = out.split(s).join('[REDACTED]');
  }
  return out;
}
