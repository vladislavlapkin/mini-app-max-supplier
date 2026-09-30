/**
 * Служебные команды MAX Bot API.
 *   npm run max:me               — проверить токен (GET /me)
 *   npm run max:webhook:list     — текущие подписки
 *   npm run max:webhook:set      — подписать PUBLIC_BASE_URL/webhooks/max (нужен HTTPS на 443 порту)
 *   npm run max:webhook:delete   — удалить подписку (вернуться к long polling)
 */
import { loadConfig } from '../src/config';
import { createLogger } from '../src/logger';
import { MaxApi } from '../src/max/client';
import { KNOWN_UPDATE_TYPES } from '../src/max/updates';

async function main() {
  const config = loadConfig();
  if (!config.MAX_BOT_TOKEN) throw new Error('MAX_BOT_TOKEN не задан');
  const api = new MaxApi(config.MAX_BOT_TOKEN, config.MAX_API_BASE, createLogger('warn'));
  const cmd = process.argv[2];

  if (cmd === 'me') {
    const me = await api.getMe();
    console.log(JSON.stringify({ user_id: me.user_id, name: me.first_name, username: me.username, is_bot: me.is_bot }, null, 2));
    return;
  }
  if (cmd === 'webhook:list') {
    console.log(JSON.stringify(await api.getSubscriptions(), null, 2));
    return;
  }
  const url = config.PUBLIC_BASE_URL ? `${config.PUBLIC_BASE_URL.replace(/\/$/, '')}/webhooks/max` : null;
  if (!url) throw new Error('PUBLIC_BASE_URL не задан');
  if (cmd === 'webhook:set') {
    if (!url.startsWith('https://')) throw new Error('Webhook должен быть HTTPS');
    if (!config.MAX_WEBHOOK_SECRET) throw new Error('Задайте MAX_WEBHOOK_SECRET');
    console.log(JSON.stringify(await api.subscribe(url, config.MAX_WEBHOOK_SECRET, KNOWN_UPDATE_TYPES), null, 2));
    return;
  }
  if (cmd === 'webhook:delete') {
    console.log(JSON.stringify(await api.unsubscribe(url), null, 2));
    return;
  }
  throw new Error(`Неизвестная команда: ${cmd}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
