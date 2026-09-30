import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config';
import { validateInitData } from '../max/initData';

export interface AuthUser {
  id: string;
  firstName: string | null;
  demo: boolean;
  startParam: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

const DEMO_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;

/**
 * Идентификация пользователя mini-app:
 * 1) X-Max-Init-Data — строка WebApp.initData, подпись проверяется на сервере токеном бота;
 * 2) X-Demo-User — только если разрешён демо-режим в браузере (ALLOW_BROWSER_DEMO).
 */
export function authenticate(config: Config) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const initData = req.headers['x-max-init-data'];
    if (typeof initData === 'string' && initData.length > 0) {
      if (!config.MAX_BOT_TOKEN) return reply.code(503).send({ error: 'bot_not_configured', message: 'Сервер не настроен: нет токена бота' });
      const res = validateInitData(initData, config.MAX_BOT_TOKEN, config.INIT_DATA_MAX_AGE_SEC);
      if (!res.ok) return reply.code(401).send({ error: 'invalid_init_data', message: 'Не удалось подтвердить запуск из MAX. Откройте приложение заново.', reason: res.reason });
      req.user = { id: String(res.user.id), firstName: res.user.first_name ?? null, demo: false, startParam: res.startParam };
      return;
    }
    const demo = req.headers['x-demo-user'];
    if (config.ALLOW_BROWSER_DEMO && typeof demo === 'string' && DEMO_ID_RE.test(demo)) {
      const sp = req.headers['x-start-param'];
      req.user = { id: `demo:${demo}`, firstName: null, demo: true, startParam: typeof sp === 'string' ? sp : null };
      return;
    }
    return reply.code(401).send({ error: 'unauthorized', message: 'Откройте приложение из чат-бота в MAX.' });
  };
}
