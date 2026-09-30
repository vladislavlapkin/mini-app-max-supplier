import Redis from 'ioredis';

export type RedisClient = Redis;

export function createRedis(url: string): RedisClient {
  return new Redis(url, {
    maxRetriesPerRequest: 3,
    enableAutoPipelining: true,
  });
}

/** Отдельное соединение для блокирующих команд (XREADGROUP BLOCK), чтобы не задерживать обычные запросы. */
export function createBlockingRedis(url: string): RedisClient {
  return new Redis(url, { maxRetriesPerRequest: null });
}
