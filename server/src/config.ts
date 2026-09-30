import path from 'node:path';
import { z } from 'zod';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const opt = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(emptyToUndefined, schema.optional());
const bool = (def: boolean) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? def : typeof v === 'string' ? ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()) : v),
    z.boolean(),
  );

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(8080),
  HOST: z.string().default('0.0.0.0'),
  /** Публичный HTTPS-адрес сервера (нужен для webhook и ссылок). */
  PUBLIC_BASE_URL: opt(z.string().url()),

  DATABASE_URL: z.string().default('postgres://supplier:supplier@localhost:5432/supplier'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  MAX_BOT_TOKEN: opt(z.string().min(10)),
  MAX_API_BASE: z.string().url().default('https://platform-api2.max.ru'),
  /** Username бота для deep link https://max.ru/<username>?startapp=... Если не задан — берётся из GET /me. */
  MAX_BOT_USERNAME: opt(z.string()),
  /** webhook — прод (нужен HTTPS), polling — локальная разработка, off — бот выключен. */
  MAX_UPDATES_MODE: z.enum(['webhook', 'polling', 'off']).default('polling'),
  MAX_WEBHOOK_SECRET: opt(z.string().regex(/^[a-zA-Z0-9_-]{5,256}$/, 'Разрешены A-Z, a-z, 0-9, _ и -, длина 5–256')),
  /** Как бот открывает mini-app: link — deep link https://max.ru/<bot>?startapp=..., open_app — кнопка open_app. */
  MAX_OPEN_APP_BUTTON: z.enum(['link', 'open_app']).default('link'),

  SEARCH_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(900),
  INIT_DATA_MAX_AGE_SEC: z.coerce.number().int().positive().default(86400),
  /** Разрешить работу mini-app в обычном браузере без MAX (демо-пользователь). В проде — false. */
  ALLOW_BROWSER_DEMO: bool(true),
  /** Считать ручную тестовую базу достаточной для фильтра «нужны документы» (только демо). */
  DEMO_TRUST_MANUAL_DATA: bool(true),
  /** Список id адаптеров через запятую, которые будут «недоступны» — для демонстрации частичного отказа. */
  SIMULATE_SOURCE_FAILURES: z.string().default(''),
  SEED_ON_START: bool(true),
  DATA_RETENTION_DAYS: z.coerce.number().int().positive().default(180),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(120),
  ADMIN_TOKEN: opt(z.string().min(16)),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Кэш архивов открытых данных (ФНС, ФАС). */
  OPENDATA_DIR: z.string().default('../opendata-cache'),
  /** Регионы импорта из реестра МСП: пусто — вся Россия, иначе коды через запятую. */
  OPENDATA_REGIONS: z.string().default(''),
  /** Какие данные участвуют в поиске: real — только официальные, test — ручная тестовая база, all — обе. */
  SEARCH_DATA: z.enum(['real', 'test', 'all']).default('real'),
  /** Доступ к витринам ГИСП (выдаётся по заявке организации). */
  GISP_API_BASE: opt(z.string().url()),
  GISP_JWT: opt(z.string().min(10)),
  /** Пути витрин из паспорта, выданного вместе с доступом; {inn} подставляется. */
  GISP_PRODUCTS_PATH: opt(z.string().includes('{inn}')),
  GISP_PP719_PATH: opt(z.string().includes('{inn}')),
  DATA_DIR: z.string().default('../data'),
  MIGRATIONS_DIR: z.string().default('./migrations'),
  WEBAPP_DIST: z.string().default('../webapp/dist'),
});

export type Config = z.infer<typeof schema> & {
  dataDir: string;
  migrationsDir: string;
  webappDist: string;
  simulatedFailures: Set<string>;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Некорректная конфигурация окружения: ${details}`);
  }
  const c = parsed.data;
  if (c.MAX_UPDATES_MODE === 'webhook' && !c.MAX_WEBHOOK_SECRET) {
    throw new Error('Для режима webhook задайте MAX_WEBHOOK_SECRET');
  }
  return {
    ...c,
    dataDir: path.resolve(c.DATA_DIR),
    migrationsDir: path.resolve(c.MIGRATIONS_DIR),
    webappDist: path.resolve(c.WEBAPP_DIST),
    simulatedFailures: new Set(
      c.SIMULATE_SOURCE_FAILURES.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  };
}
