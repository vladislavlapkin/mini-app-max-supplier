import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { Container } from './container';
import { apiRoutes } from './http/api';
import { webhookRoutes } from './http/webhook';
import { httpRequests, registry } from './infra/metrics';

export async function buildApp(c: Container): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: c.log as unknown as FastifyBaseLogger,
    trustProxy: true,
    bodyLimit: 64 * 1024,
    genReqId: () => crypto.randomUUID(),
  });

  app.addHook('onResponse', async (req, reply) => {
    httpRequests.inc({ route: req.routeOptions.url ?? 'unknown', method: req.method, status: String(reply.statusCode) });
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    return payload;
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err: err.message, stack: err.stack }, 'unhandled error');
    reply.code(status).send({ error: status >= 500 ? 'internal' : 'bad_request', message: status >= 500 ? 'Что-то пошло не так. Попробуйте через минуту.' : err.message });
  });

  app.get('/healthz', async () => ({ ok: true }));

  app.get('/readyz', async (_req, reply) => {
    try {
      await Promise.all([c.db.query('SELECT 1'), c.redis.ping()]);
      return { ok: true };
    } catch (err) {
      return reply.code(503).send({ ok: false, error: (err as Error).message });
    }
  });

  app.get('/metrics', async (req, reply) => {
    if (c.config.ADMIN_TOKEN && req.headers['x-admin-token'] !== c.config.ADMIN_TOKEN) return reply.code(401).send();
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  });

  app.get('/admin/metrics', async (req, reply) => {
    if (!c.config.ADMIN_TOKEN || req.headers['x-admin-token'] !== c.config.ADMIN_TOKEN) return reply.code(401).send({ error: 'unauthorized' });
    const days = Math.min(365, Math.max(1, Number((req.query as { days?: string }).days ?? 30)));
    return c.analytics.metrics(days);
  });

  await app.register(async (scope) => webhookRoutes(scope, c));
  await app.register(async (scope) => apiRoutes(scope, c));

  // Статика mini-app и SPA-fallback
  const dist = c.config.webappDist;
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: dist,
      prefix: '/',
      wildcard: false,
      // Кэш задаём сами: index.html не кэшируется, чтобы после деплоя сразу подхватывалась новая сборка
      cacheControl: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) res.setHeader('cache-control', 'no-cache');
        else if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('cache-control', 'public, max-age=31536000, immutable');
        else res.setHeader('cache-control', 'public, max-age=3600');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/webhooks/')) return reply.type('text/html').sendFile('index.html');
      return reply.code(404).send({ error: 'not_found', message: 'Не найдено' });
    });
  } else {
    c.log.warn({ dist }, 'webapp dist not found — only API is served');
  }

  return app;
}
