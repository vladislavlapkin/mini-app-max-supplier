import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Container } from '../container';
import { type SearchQuery, searchQuerySchema } from '../domain/types';
import { hashUserId } from '../logger';
import { matchProduct } from '../parser/queryParser';
import { CLIENT_EVENTS } from '../services/analytics';
import { LimitError } from '../services/saved';
import { START_PARAM_RE } from '../services/searchToken';
import { authenticate } from './auth';
import { rateLimit } from './rateLimit';

const uuid = z.string().uuid();

function parseCtx(raw: unknown): SearchQuery | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const res = searchQuerySchema.safeParse(JSON.parse(raw));
    return res.success ? res.data : null;
  } catch {
    return null;
  }
}

function bad(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: 'bad_request', message });
}

export async function apiRoutes(app: FastifyInstance, c: Container) {
  app.addHook('onRequest', authenticate(c.config));
  app.addHook('onRequest', rateLimit(c.redis, { perMinute: c.config.RATE_LIMIT_PER_MIN, prefix: 'api' }));
  const userId = (req: FastifyRequest) => req.user!.id;

  /** Контекст запуска: пользователь и расшифровка параметра startapp. */
  app.get('/api/session', async (req) => {
    const user = req.user!;
    const sp = user.startParam && START_PARAM_RE.test(user.startParam) ? user.startParam : null;
    let launch: unknown = null;
    if (sp?.startsWith('st_')) {
      const rec = await c.tokens.get(sp);
      if (rec && rec.max_user_id === user.id) launch = { type: 'search', query: rec.query, expiresAt: rec.expires_at };
      else if (rec && user.demo) launch = { type: 'search', query: rec.query, expiresAt: rec.expires_at };
      else launch = { type: 'search_expired' };
    } else if (sp?.startsWith('sv_') && uuid.safeParse(sp.slice(3)).success) {
      launch = { type: 'selection', id: sp.slice(3) };
    }
    c.analytics.track('miniapp_opened', { userId: user.id, props: { launch: (launch as { type?: string } | null)?.type ?? 'direct', demo: user.demo } });
    const imports = await c.search.imports();
    return {
      user: { id: user.demo ? null : user.id, firstName: user.firstName, demo: user.demo },
      launch,
      botUsername: c.botUsername.value,
      data: { mode: c.search.dataMode, imports },
      demoData: c.search.dataMode !== 'real' || !imports.length,
      catalogVersion: c.catalog.data.version,
    };
  });

  app.get('/api/catalog', async () => c.catalog.toPublic());

  app.get('/api/suggest', async (req) => {
    const q = String((req.query as { q?: string }).q ?? '').slice(0, 100);
    if (q.trim().length < 2) return { items: [] };
    const matches = matchProduct(q, c.catalog);
    const items = matches.map((m) => ({ productId: m.productId, categoryId: m.categoryId, name: m.name, categoryName: c.catalog.category(m.categoryId)?.name, confidence: m.confidence }));
    // Дополняем подсказками по подстроке названия
    const lower = q.toLowerCase().replace(/ё/g, 'е');
    for (const cat of c.catalog.data.categories) {
      for (const p of cat.products) {
        if (items.length >= 8) break;
        if (p.name.toLowerCase().replace(/ё/g, 'е').includes(lower) && !items.some((i) => i.productId === p.id)) {
          items.push({ productId: p.id, categoryId: cat.id, name: p.name, categoryName: cat.name, confidence: 0.6 });
        }
      }
    }
    return { items: items.slice(0, 8) };
  });

  app.get('/api/search-token/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const rec = await c.tokens.get(token);
    if (!rec || (rec.max_user_id !== req.user!.id && !req.user!.demo)) return reply.code(404).send({ error: 'expired', message: 'Ссылка на подборку устарела. Задайте поиск заново.' });
    return { query: rec.query, expiresAt: rec.expires_at };
  });

  app.post('/api/search', async (req, reply) => {
    const parsed = searchQuerySchema.safeParse(req.body ?? {});
    if (!parsed.success) return bad(reply, 'Некорректные параметры поиска');
    if (!parsed.data.text && !parsed.data.productId && !parsed.data.categoryId) return bad(reply, 'Укажите товар');
    return c.search.search(parsed.data, { userId: userId(req), origin: 'miniapp', requestId: req.id });
  });

  app.get('/api/suppliers/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!uuid.safeParse(id).success) return bad(reply, 'Некорректный идентификатор');
    const card = await c.search.card(id, parseCtx((req.query as { ctx?: string }).ctx), { userId: userId(req), origin: 'miniapp', requestId: req.id });
    if (!card) return reply.code(404).send({ error: 'not_found', message: 'Поставщик не найден' });
    const savedRows = await c.saved.listSuppliers(userId(req));
    const saved = savedRows.find((r) => r.supplierId === id);
    return { ...card, saved: saved ? { note: saved.note } : null };
  });

  app.get('/api/suppliers/:id/financials', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!uuid.safeParse(id).success) return bad(reply, 'Некорректный идентификатор');
    const res = await c.search.financials(id);
    return res ?? reply.code(404).send({ error: 'not_found', message: 'Поставщик не найден' });
  });

  app.get('/api/compare', async (req, reply) => {
    const q = req.query as { ids?: string; ctx?: string };
    const ids = String(q.ids ?? '')
      .split(',')
      .filter((x) => uuid.safeParse(x).success)
      .slice(0, 3);
    if (!ids.length) return bad(reply, 'Выберите от одного до трёх поставщиков');
    return c.search.compare(ids, parseCtx(q.ctx), { userId: userId(req), origin: 'miniapp', requestId: req.id });
  });

  // ── Сохранённые подборки ──────────────────────────────────────────────────

  app.get('/api/saved/selections', async (req) => {
    const list = await c.saved.listSelections(userId(req));
    return { items: list.map((s) => ({ ...s, queryLabel: c.search.describe(s.query) })) };
  });

  const createSelection = z.object({
    title: z.string().trim().max(120).optional(),
    query: searchQuerySchema,
    supplierIds: z.array(uuid).min(1).max(10),
    note: z.string().max(1000).nullable().optional(),
  });

  app.post('/api/saved/selections', async (req, reply) => {
    const parsed = createSelection.safeParse(req.body);
    if (!parsed.success) return bad(reply, 'Некорректная подборка');
    const label = c.search.describe(parsed.data.query);
    const title = parsed.data.title || `${label.product}, ${label.region}`;
    try {
      const id = await c.saved.createSelection(userId(req), { title, query: parsed.data.query, supplierIds: parsed.data.supplierIds, note: parsed.data.note });
      c.analytics.track('selection_saved', { userId: userId(req), searchId: (req.headers['x-search-id'] as string) ?? null, props: { count: parsed.data.supplierIds.length } });
      const botNotified = await c.notifier.selectionSaved(userId(req));
      return reply.code(201).send({ id, title, botNotified });
    } catch (err) {
      if (err instanceof LimitError) return reply.code(409).send({ error: 'limit', message: err.message });
      throw err;
    }
  });

  app.get('/api/saved/selections/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!uuid.safeParse(id).success) return bad(reply, 'Некорректный идентификатор');
    const sel = await c.saved.getSelection(userId(req), id);
    if (!sel) return reply.code(404).send({ error: 'not_found', message: 'Подборка не найдена или удалена' });
    const compared = await c.search.compare(sel.supplierIds.slice(0, 3), sel.query, { userId: userId(req), origin: 'miniapp', requestId: req.id });
    const rest = sel.supplierIds.length > 3 ? await c.search.compare(sel.supplierIds.slice(3, 6), sel.query, { userId: userId(req), origin: 'miniapp' }) : null;
    await c.saved.touchSelection(id);
    c.analytics.track('saved_opened', { userId: userId(req), props: { from: 'miniapp' } });
    return {
      selection: { ...sel, queryLabel: c.search.describe(sel.query) },
      suppliers: [...compared.suppliers, ...(rest?.suppliers ?? [])],
      warnings: compared.warnings,
      checkedAt: new Date().toISOString(),
    };
  });

  app.patch('/api/saved/selections/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ title: z.string().trim().min(1).max(120).optional(), note: z.string().max(1000).nullable().optional() }).safeParse(req.body);
    if (!uuid.safeParse(id).success || !body.success) return bad(reply, 'Некорректные данные');
    const ok = await c.saved.updateSelection(userId(req), id, body.data);
    return ok ? { ok } : reply.code(404).send({ error: 'not_found', message: 'Подборка не найдена' });
  });

  app.delete('/api/saved/selections/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!uuid.safeParse(id).success) return bad(reply, 'Некорректный идентификатор');
    const ok = await c.saved.deleteSelection(userId(req), id);
    return ok ? { ok } : reply.code(404).send({ error: 'not_found', message: 'Подборка не найдена' });
  });

  // ── Сохранённые поставщики и заметки ───────────────────────────────────────

  app.get('/api/saved/suppliers', async (req) => ({ items: await c.saved.listSuppliers(userId(req)) }));

  app.put('/api/saved/suppliers/:supplierId', async (req, reply) => {
    const { supplierId } = req.params as { supplierId: string };
    const body = z.object({ note: z.string().max(1000).nullable().optional(), query: searchQuerySchema.nullable().optional() }).safeParse(req.body ?? {});
    if (!uuid.safeParse(supplierId).success || !body.success) return bad(reply, 'Некорректные данные');
    try {
      await c.saved.saveSupplier(userId(req), supplierId, { note: body.data.note ?? null, query: body.data.query ?? null });
    } catch (err) {
      if (err instanceof LimitError) return reply.code(409).send({ error: 'limit', message: err.message });
      throw err;
    }
    c.analytics.track('supplier_saved', { userId: userId(req), searchId: (req.headers['x-search-id'] as string) ?? null });
    return { ok: true };
  });

  app.patch('/api/saved/suppliers/:supplierId', async (req, reply) => {
    const { supplierId } = req.params as { supplierId: string };
    const body = z.object({ note: z.string().max(1000).nullable() }).safeParse(req.body);
    if (!uuid.safeParse(supplierId).success || !body.success) return bad(reply, 'Некорректные данные');
    const ok = await c.saved.updateSupplierNote(userId(req), supplierId, body.data.note);
    return ok ? { ok } : reply.code(404).send({ error: 'not_found', message: 'Поставщик не сохранён' });
  });

  app.delete('/api/saved/suppliers/:supplierId', async (req, reply) => {
    const { supplierId } = req.params as { supplierId: string };
    if (!uuid.safeParse(supplierId).success) return bad(reply, 'Некорректный идентификатор');
    await c.saved.removeSupplier(userId(req), supplierId);
    return { ok: true };
  });

  app.get('/api/history', async (req) => {
    const items = await c.saved.recentSearches(userId(req), 5);
    return { items: items.map((i) => ({ ...i, queryLabel: c.search.describe(i.query) })) };
  });

  // ── События и обратная связь ───────────────────────────────────────────────

  app.post('/api/events', async (req, reply) => {
    const body = z
      .object({ name: z.enum(CLIENT_EVENTS), searchId: z.string().uuid().nullable().optional(), props: z.record(z.unknown()).optional() })
      .safeParse(req.body);
    if (!body.success) return bad(reply, 'Некорректное событие');
    const props = JSON.stringify(body.data.props ?? {}).length > 2000 ? {} : body.data.props;
    c.analytics.track(body.data.name, { userId: userId(req), searchId: body.data.searchId ?? null, props });
    return reply.code(202).send({ ok: true });
  });

  app.post('/api/feedback/category', async (req, reply) => {
    const body = z.object({ text: z.string().trim().min(2).max(300) }).safeParse(req.body);
    if (!body.success) return bad(reply, 'Опишите товар (от 2 до 300 символов)');
    await c.db.query('INSERT INTO category_requests (user_hash, text) VALUES ($1, $2)', [hashUserId(userId(req)), body.data.text]);
    return reply.code(201).send({ ok: true });
  });

  app.get('/api/sources/health', async () => ({ sources: await c.sources.health() }));
}
