import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Container } from '../container';
import { rateLimit } from './rateLimit';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * POST /webhooks/max — отвечаем 200 максимально быстро: валидация, дедупликация и постановка в очередь.
 * Обработка (парсинг запроса, поиск, ответы) выполняется воркером очереди.
 */
export async function webhookRoutes(app: FastifyInstance, c: Container) {
  app.post(
    '/webhooks/max',
    { onRequest: rateLimit(c.redis, { perMinute: 3000, prefix: 'wh', key: () => 'max' }), bodyLimit: 256 * 1024 },
    async (req, reply) => {
      const secret = c.config.MAX_WEBHOOK_SECRET;
      if (secret) {
        const header = req.headers['x-max-bot-api-secret'];
        if (typeof header !== 'string' || !safeEqual(header, secret)) return reply.code(401).send({ ok: false });
      }
      try {
        const result = await c.ingestor.ingest(req.body);
        return reply.code(200).send({ ok: true, result });
      } catch (err) {
        req.log.error({ err: (err as Error).message }, 'webhook ingest failed');
        // 503 — MAX повторит доставку, дубликаты отсечёт дедупликация
        return reply.code(503).send({ ok: false });
      }
    },
  );
}
