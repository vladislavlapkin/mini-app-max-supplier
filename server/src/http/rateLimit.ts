import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RedisClient } from '../infra/redis';

/** Rate limiting фиксированным окном в Redis: общий для всех инстансов. */
export function rateLimit(redis: RedisClient, opts: { perMinute: number; prefix: string; key?: (req: FastifyRequest) => string }) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const who = opts.key ? opts.key(req) : req.user?.id ?? req.ip;
    const window = Math.floor(Date.now() / 60_000);
    const key = `rl:${opts.prefix}:${who}:${window}`;
    try {
      const n = await redis.incr(key);
      if (n === 1) await redis.expire(key, 70);
      reply.header('x-ratelimit-limit', opts.perMinute);
      reply.header('x-ratelimit-remaining', Math.max(0, opts.perMinute - n));
      if (n > opts.perMinute) {
        return reply.code(429).send({ error: 'rate_limited', message: 'Слишком много запросов. Подождите минуту и попробуйте снова.' });
      }
    } catch {
      // Redis недоступен — не блокируем пользователя
    }
  };
}
