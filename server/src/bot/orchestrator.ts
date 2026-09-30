import type { Catalog } from '../catalog/catalog';
import { plural } from '../catalog/text';
import { type CertificateRequirement, type SearchQuery, SUPPLIER_TYPE_PREFS, type SupplierTypePref, CERTIFICATE_REQUIREMENTS } from '../domain/types';
import { botUpdates } from '../infra/metrics';
import { hashUserId, type Logger } from '../logger';
import type { MaxUpdate, NewMessageBody } from '../max/types';
import {
  leftoverProductText,
  matchProduct,
  matchRegion,
  matchSupplierType,
  matchVolume,
  PRODUCT_CONFIDENCE_THRESHOLD,
  parseQuery,
  type ProductMatch,
  SUPPLIER_TYPE_CONFIDENCE_THRESHOLD,
} from '../parser/queryParser';
import type { SearchService } from '../search/service';
import type { AnalyticsService } from '../services/analytics';
import type { SavedService } from '../services/saved';
import type { SearchTokenService } from '../services/searchToken';
import {
  CB,
  categoriesKeyboard,
  cb,
  certificateKeyboard,
  changeKeyboard,
  confirmKeyboard,
  keyboard,
  mainMenu,
  openAppButton,
  readyKeyboard,
  regionKeyboard,
  supplierTypeKeyboard,
  volumeKeyboard,
} from './keyboards';
import type { BotSession, SessionStore } from './session';
import { querySummary, T } from './texts';

export interface BotTransport {
  send(to: { userId?: number; chatId?: number }, body: NewMessageBody): Promise<void>;
  answer(callbackId: string, body: { message?: NewMessageBody; notification?: string }): Promise<void>;
}

export interface BotDeps {
  sessions: SessionStore;
  catalog: Catalog;
  tokens: SearchTokenService;
  search: SearchService;
  saved: SavedService;
  analytics: AnalyticsService;
  log: Logger;
  openAppMode: 'link' | 'open_app';
  botUsername: () => string | null;
}

interface Ctx {
  userId: number;
  chatId: number | null;
  callbackId?: string;
  originalText?: string | null;
}

const MAX_CLARIFICATIONS = 3;

/** Dialog Orchestrator: свободный запрос → короткое уточнение → открытие mini-app. */
export class BotOrchestrator {
  constructor(
    private readonly d: BotDeps,
    private readonly transport: BotTransport,
  ) {}

  async handle(update: MaxUpdate): Promise<void> {
    try {
      if (update.update_type === 'bot_started' && 'user' in update) {
        const u = update as Extract<MaxUpdate, { update_type: 'bot_started' }>;
        await this.onStart({ userId: u.user.user_id, chatId: u.chat_id });
      } else if (update.update_type === 'message_created' && 'message' in update) {
        const u = update as Extract<MaxUpdate, { update_type: 'message_created' }>;
        const sender = u.message.sender;
        if (!sender || sender.is_bot) return;
        await this.onMessage({ userId: sender.user_id, chatId: u.message.recipient.chat_id ?? null }, u.message.body.text ?? '');
      } else if (update.update_type === 'message_callback' && 'callback' in update) {
        const u = update as Extract<MaxUpdate, { update_type: 'message_callback' }>;
        await this.onCallback(
          {
            userId: u.callback.user.user_id,
            chatId: u.message?.recipient.chat_id ?? null,
            callbackId: u.callback.callback_id,
            originalText: u.message?.body.text ?? null,
          },
          u.callback.payload ?? '',
        );
      }
      botUpdates.inc({ type: update.update_type, outcome: 'ok' });
    } catch (err) {
      botUpdates.inc({ type: update.update_type, outcome: 'error' });
      this.d.log.error({ err: (err as Error).message, type: update.update_type }, 'bot update handling failed');
      throw err;
    }
  }

  // ── Отправка ────────────────────────────────────────────────────────────────

  private async send(ctx: Ctx, text: string, kb?: ReturnType<typeof keyboard>): Promise<void> {
    const to = ctx.chatId ? { chatId: ctx.chatId } : { userId: ctx.userId };
    await this.transport.send(to, { text, attachments: kb ? [kb] : undefined });
  }

  /** Подтверждаем нажатие: убираем клавиатуру у исходного сообщения и фиксируем выбор. */
  private async ack(ctx: Ctx, chosen: string): Promise<void> {
    if (!ctx.callbackId) return;
    const text = ctx.originalText ? `${ctx.originalText}\n\n→ ${chosen}` : `→ ${chosen}`;
    try {
      await this.transport.answer(ctx.callbackId, { message: { text, attachments: [] } });
    } catch (err) {
      this.d.log.warn({ err: (err as Error).message }, 'callback answer failed');
    }
  }

  private open(startParam?: string) {
    return openAppButton(startParam ? 'Открыть подборку' : 'Открыть приложение', {
      mode: this.d.openAppMode,
      botUsername: this.d.botUsername(),
      startParam,
    });
  }

  // ── События ─────────────────────────────────────────────────────────────────

  private async onStart(ctx: Ctx): Promise<void> {
    await this.d.sessions.reset(String(ctx.userId), ctx.chatId ? String(ctx.chatId) : null);
    const notice = this.d.search.dataMode === 'test' ? T.demoNotice : T.realNotice;
    await this.send(ctx, `${T.greeting}\n\n${notice}`, mainMenu(this.open()));
  }

  private async onMessage(ctx: Ctx, rawText: string): Promise<void> {
    const text = rawText.trim();
    if (!text) {
      await this.send(ctx, 'Пока я понимаю только текст. Напишите, какой товар ищете.');
      return;
    }
    if (text.startsWith('/')) {
      const command = text.split(/\s+/)[0].split('@')[0].toLowerCase();
      switch (command) {
        case '/start':
          return this.onStart(ctx);
        case '/find':
          return this.startSearch(ctx);
        case '/saved':
          return this.showSaved(ctx);
        case '/help':
          return this.send(ctx, T.help, mainMenu(this.open()));
        case '/cancel': {
          await this.d.sessions.reset(String(ctx.userId), ctx.chatId ? String(ctx.chatId) : null);
          return this.send(ctx, T.cancelled);
        }
        default:
          return this.send(ctx, 'Не знаю такой команды. Список команд — /help');
      }
    }

    const s = await this.session(ctx);
    switch (s.state) {
      case 'WAITING_REGION': {
        const r = matchRegion(text, this.d.catalog);
        if (r) {
          s.region = { code: r.code, name: r.name };
          return this.next(ctx, s);
        }
        if (this.looksLikeNewQuery(text)) return this.newQuery(ctx, text);
        await this.d.sessions.save(s);
        return this.send(ctx, T.regionNotRecognized, regionKeyboard(this.d.catalog));
      }
      case 'WAITING_VOLUME': {
        const v = matchVolume(text, this.d.catalog);
        if (v) {
          s.volume = { value: v.value, unit: v.unit, mode: v.operator === 'gte' ? 'from' : v.operator === 'eq' ? 'exact' : 'up_to' };
          return this.next(ctx, s);
        }
        return this.send(ctx, T.volumeNotRecognized, volumeKeyboard());
      }
      case 'WAITING_SUPPLIER_TYPE': {
        const t = matchSupplierType(text)?.value ?? this.yesNoSupplierType(text);
        if (t) {
          s.supplier_type = t;
          return s.editing ? this.askConfirm(ctx, s) : this.confirm(ctx, s);
        }
        if (this.looksLikeNewQuery(text)) return this.newQuery(ctx, text);
        return this.send(ctx, T.askSupplierType, supplierTypeKeyboard());
      }
      case 'WAITING_PRODUCT': {
        const parsed = parseQuery(text, this.d.catalog);
        if (parsed.product && parsed.product.confidence >= PRODUCT_CONFIDENCE_THRESHOLD) {
          this.applyParsed(s, parsed, text, false);
          return this.next(ctx, s);
        }
        return this.askProduct(ctx, s, parsed.productCandidates);
      }
      default:
        return this.newQuery(ctx, text);
    }
  }

  private async onCallback(ctx: Ctx, payload: string): Promise<void> {
    const [action, arg] = payload.split(/:(.*)/s, 2) as [string, string | undefined];
    const s = await this.session(ctx);

    switch (action) {
      case CB.NEW_SEARCH:
        await this.ack(ctx, 'Новый поиск');
        return this.startSearch(ctx);
      case CB.VIEW_SAVED:
        await this.ack(ctx, 'Сохранённые подборки');
        return this.showSaved(ctx);
      case CB.CHANGE_QUERY:
        await this.ack(ctx, 'Изменить параметры');
        s.editing = true;
        s.state = 'QUERY_CONFIRMATION';
        await this.d.sessions.save(s);
        return this.send(ctx, `${querySummary(s, this.d.catalog)}\n\n${T.changeWhat}`, changeKeyboard());
      case CB.CHANGE_PRODUCT:
        await this.ack(ctx, 'Товар');
        s.state = 'WAITING_PRODUCT';
        s.editing = true;
        await this.d.sessions.save(s);
        return this.send(ctx, T.askProduct, categoriesKeyboard(this.d.catalog));
      case CB.SET_PRODUCT: {
        if (!arg) return this.askProduct(ctx, s, []);
        const product = arg.startsWith('cat.') ? null : this.d.catalog.product(arg);
        const category = arg.startsWith('cat.') ? this.d.catalog.category(arg.slice(4)) : this.d.catalog.category(product?.categoryId);
        if (!category) return this.askProduct(ctx, s, []);
        await this.ack(ctx, product?.name ?? category.name);
        s.product = {
          raw: product?.name ?? category.name,
          normalized: product?.normalized ?? category.name,
          name: product?.name ?? category.name,
          product_id: product?.id ?? null,
          category_id: category.id,
          confidence: 1,
        };
        return s.editing ? this.askConfirm(ctx, s) : this.next(ctx, s);
      }
      case CB.SET_REGION: {
        if (!arg) {
          await this.ack(ctx, 'Регион');
          s.state = 'WAITING_REGION';
          await this.d.sessions.save(s);
          return this.send(ctx, T.askRegion, regionKeyboard(this.d.catalog));
        }
        const region = this.d.catalog.region(arg);
        if (!region) return this.send(ctx, T.regionNotRecognized, regionKeyboard(this.d.catalog));
        await this.ack(ctx, region.name);
        s.region = { code: region.code, name: region.name };
        return s.editing ? this.askConfirm(ctx, s) : this.next(ctx, s);
      }
      case CB.SET_SUPPLIER_TYPE: {
        if (!arg || !SUPPLIER_TYPE_PREFS.includes(arg as SupplierTypePref)) {
          await this.ack(ctx, 'Тип поставщика');
          s.state = 'WAITING_SUPPLIER_TYPE';
          await this.d.sessions.save(s);
          return this.send(ctx, T.askSupplierType, supplierTypeKeyboard());
        }
        const labels: Record<SupplierTypePref, string> = {
          MANUFACTURER_ONLY: 'Да, только производителя',
          MANUFACTURER_OR_DISTRIBUTOR: 'Производителя или дистрибьютора',
          ANY: 'Любого поставщика',
        };
        await this.ack(ctx, labels[arg as SupplierTypePref]);
        s.supplier_type = arg as SupplierTypePref;
        return s.editing ? this.askConfirm(ctx, s) : this.confirm(ctx, s);
      }
      case CB.SET_VOLUME: {
        if (arg === 'none') {
          await this.ack(ctx, 'Не важно');
          s.volume = null;
          return this.askConfirm(ctx, s);
        }
        await this.ack(ctx, 'Объём');
        s.state = 'WAITING_VOLUME';
        await this.d.sessions.save(s);
        return this.send(ctx, T.askVolume, volumeKeyboard());
      }
      case CB.SET_CERTIFICATE: {
        if (!arg || !CERTIFICATE_REQUIREMENTS.includes(arg as CertificateRequirement)) {
          await this.ack(ctx, 'Документы');
          s.state = 'WAITING_CERTIFICATE';
          await this.d.sessions.save(s);
          return this.send(ctx, T.askCertificate, certificateKeyboard());
        }
        await this.ack(ctx, { REQUIRED: 'Обязательно', PREFERRED: 'Желательно', NOT_REQUIRED: 'Не важно' }[arg as CertificateRequirement]);
        s.certificate_requirement = arg as CertificateRequirement;
        return this.askConfirm(ctx, s);
      }
      case CB.APPLY_PATCH: {
        const patches: Record<string, [string, (x: BotSession) => void]> = {
          relax_type: ['Убрать фильтр «только производитель»', (x) => (x.supplier_type = 'MANUFACTURER_OR_DISTRIBUTOR')],
          relax_type_any: ['Показать любых поставщиков', (x) => (x.supplier_type = 'ANY')],
          all_russia: ['Искать по всей России', (x) => (x.region = { code: 'RU', name: 'Вся Россия' })],
          relax_docs: ['Без обязательных документов', (x) => (x.certificate_requirement = 'PREFERRED')],
        };
        const p = arg ? patches[arg] : undefined;
        if (!p) return this.askConfirm(ctx, s);
        await this.ack(ctx, p[0]);
        p[1](s);
        return this.confirm(ctx, s);
      }
      case CB.CONFIRM_QUERY:
        await this.ack(ctx, 'Подтвердить');
        return this.confirm(ctx, s);
      case CB.OPEN_APP: {
        await this.ack(ctx, 'Открыть приложение');
        const open = this.open(s.last_search_token ?? undefined);
        return this.send(ctx, open ? 'Откройте мини-приложение:' : T.readyNoUsername, open ? keyboard([[open]]) : undefined);
      }
      default:
        this.d.log.warn({ action }, 'unknown callback');
        return this.send(ctx, T.askProduct);
    }
  }

  // ── Шаги диалога ───────────────────────────────────────────────────────────

  private async session(ctx: Ctx): Promise<BotSession> {
    return this.d.sessions.get(String(ctx.userId), ctx.chatId ? String(ctx.chatId) : null);
  }

  private async startSearch(ctx: Ctx): Promise<void> {
    const s = await this.d.sessions.reset(String(ctx.userId), ctx.chatId ? String(ctx.chatId) : null);
    s.state = 'WAITING_PRODUCT';
    await this.d.sessions.save(s);
    await this.send(ctx, T.askProduct, categoriesKeyboard(this.d.catalog));
  }

  private looksLikeNewQuery(text: string): boolean {
    const m = matchProduct(text, this.d.catalog)[0];
    return !!m && m.confidence >= 0.85;
  }

  private yesNoSupplierType(text: string): SupplierTypePref | null {
    const t = text.toLowerCase().trim();
    if (/^(да|ага|только производ)/.test(t)) return 'MANUFACTURER_ONLY';
    if (/^(нет|любой|любого|не важно|неважно)/.test(t)) return 'ANY';
    return null;
  }

  private applyParsed(s: BotSession, p: ReturnType<typeof parseQuery>, text: string, replace: boolean): void {
    if (replace) {
      s.product = null;
      s.region = null;
      s.volume = null;
      s.supplier_type = null;
      s.certificate_requirement = null;
      s.wholesale = null;
      s.clarifications_asked = 0;
      s.editing = false;
      s.query_text = text;
    }
    if (p.product) {
      s.product = {
        raw: p.product.raw,
        normalized: p.product.normalized,
        name: p.product.name,
        product_id: p.product.productId,
        category_id: p.product.categoryId,
        confidence: p.product.confidence,
      };
    }
    if (p.region) s.region = { code: p.region.code, name: p.region.name };
    if (p.volume) s.volume = { value: p.volume.value, unit: p.volume.unit, mode: p.volume.operator === 'gte' ? 'from' : p.volume.operator === 'eq' ? 'exact' : 'up_to' };
    // Неоднозначный тип («производитель») не фиксируем — бот уточнит его отдельным вопросом
    if (p.supplierType && p.supplierTypeConfidence >= SUPPLIER_TYPE_CONFIDENCE_THRESHOLD) s.supplier_type = p.supplierType;
    if (p.certificate) s.certificate_requirement = p.certificate;
    if (p.wholesale !== null) s.wholesale = p.wholesale;
  }

  private async newQuery(ctx: Ctx, text: string): Promise<void> {
    const s = await this.session(ctx);
    const parsed = parseQuery(text, this.d.catalog);
    this.applyParsed(s, parsed, text, true);
    this.d.analytics.track('bot_query_parsed', {
      userId: String(ctx.userId),
      props: { missing: parsed.missing, productConfidence: parsed.product?.confidence ?? 0 },
    });
    if (!parsed.product || parsed.product.confidence < PRODUCT_CONFIDENCE_THRESHOLD) return this.askProduct(ctx, s, parsed.productCandidates);
    return this.next(ctx, s);
  }

  /** Спрашиваем только недостающие обязательные параметры: товар, регион, тип поставщика (не больше трёх). */
  private async next(ctx: Ctx, s: BotSession): Promise<void> {
    if (!s.product || s.product.confidence < PRODUCT_CONFIDENCE_THRESHOLD) return this.askProduct(ctx, s, []);
    if (!s.region) {
      if (s.clarifications_asked >= MAX_CLARIFICATIONS) s.region = { code: 'RU', name: 'Вся Россия' };
      else {
        s.clarifications_asked += 1;
        s.state = 'WAITING_REGION';
        await this.d.sessions.save(s);
        return this.send(ctx, `${querySummary(s, this.d.catalog)}\n\n${T.askRegion}`, regionKeyboard(this.d.catalog));
      }
    }
    if (!s.supplier_type) {
      if (s.clarifications_asked >= MAX_CLARIFICATIONS) s.supplier_type = 'ANY';
      else {
        s.clarifications_asked += 1;
        s.state = 'WAITING_SUPPLIER_TYPE';
        await this.d.sessions.save(s);
        return this.send(ctx, `${querySummary(s, this.d.catalog)}\n\n${T.askSupplierType}`, supplierTypeKeyboard());
      }
    }
    return this.askConfirm(ctx, s);
  }

  private async askProduct(ctx: Ctx, s: BotSession, candidates: ProductMatch[]): Promise<void> {
    if (s.state !== 'WAITING_PRODUCT') s.clarifications_asked += 1;
    s.state = 'WAITING_PRODUCT';
    await this.d.sessions.save(s);
    const options = candidates.filter((c) => c.confidence >= 0.5).slice(0, 4);
    if (options.length) {
      const rows = options.map((c) => [cb(c.name, CB.SET_PRODUCT, c.productId ?? `cat.${c.categoryId}`)]);
      return this.send(ctx, T.askProductCandidates, keyboard(rows));
    }
    const cats = this.d.catalog.data.categories.map((c) => `— ${c.name}`).join('\n');
    const leftover = leftoverProductText(s.query_text);
    const text = leftover ? T.askProductUnknown(cats) : `${T.askProduct}\n\nДоступные категории:\n${cats}`;
    return this.send(ctx, text, categoriesKeyboard(this.d.catalog));
  }

  private async askConfirm(ctx: Ctx, s: BotSession): Promise<void> {
    s.state = 'QUERY_CONFIRMATION';
    await this.d.sessions.save(s);
    await this.send(ctx, querySummary(s, this.d.catalog), confirmKeyboard());
  }

  toSearchQuery(s: BotSession): SearchQuery {
    return {
      text: s.product?.name.toLowerCase() ?? '',
      productId: s.product?.product_id ?? null,
      categoryId: s.product?.category_id ?? null,
      regionCode: s.region?.code ?? null,
      strictRegion: false,
      supplierType: s.supplier_type ?? 'ANY',
      volume: s.volume ? { value: s.volume.value, unit: s.volume.unit, operator: s.volume.mode === 'from' ? 'gte' : s.volume.mode === 'exact' ? 'eq' : 'lte' } : null,
      certificate: s.certificate_requirement ?? 'PREFERRED',
      russianOnly: false,
    };
  }

  /** Подтверждение: создаём search_token, делаем предпросмотр выдачи и отправляем кнопку «Открыть подборку». */
  private async confirm(ctx: Ctx, s: BotSession): Promise<void> {
    if (!s.product) return this.askProduct(ctx, s, []);
    if (!s.region) s.region = { code: 'RU', name: 'Вся Россия' };
    if (!s.supplier_type) s.supplier_type = 'ANY';
    s.editing = false;
    s.state = 'SEARCHING';
    const query = this.toSearchQuery(s);
    const userId = String(ctx.userId);

    const preview = await this.d.search.search(query, { userId, origin: 'bot', track: false });
    this.d.analytics.track('bot_query_confirmed', { userId, props: { total: preview.total } });

    if (!preview.total) {
      s.state = 'SHOWING_RESULTS';
      await this.d.sessions.save(s);
      const patchable = (preview.empty?.actions ?? []).filter((a) => a.patch && ['relax_type', 'relax_type_any', 'all_russia', 'relax_docs'].includes(a.id));
      const rows = patchable.map((a) => [cb(a.label, CB.APPLY_PATCH, a.id)]);
      rows.push([cb('Изменить параметры', CB.CHANGE_QUERY)], [cb('Новый поиск', CB.NEW_SEARCH)]);
      return this.send(ctx, `${querySummary(s, this.d.catalog)}\n\n${T.emptyResults}`, keyboard(rows));
    }

    const token = await this.d.tokens.create(userId, query);
    s.last_search_token = token.token;
    s.state = 'APP_OPENING';
    await this.d.sessions.save(s);

    const open = this.open(token.token);
    const lines = [T.found(preview.total, plural(preview.total, ['поставщик', 'поставщика', 'поставщиков']))];
    if (preview.sources.some((x) => x.status === 'failed')) lines.push(T.sourcesDown);
    lines.push(open ? T.ready : T.readyNoUsername);
    this.d.log.info({ user: hashUserId(userId), total: preview.total }, 'search token issued');
    await this.send(ctx, lines.join('\n\n'), readyKeyboard(open));
  }

  private async showSaved(ctx: Ctx): Promise<void> {
    const list = await this.d.saved.listSelections(String(ctx.userId));
    if (!list.length) return this.send(ctx, T.noSaved, mainMenu(this.open()));
    const rows = list.slice(0, 5).map((sel) => {
      const btn = openAppButton(`${sel.title} (${sel.supplierCount})`, { mode: this.d.openAppMode, botUsername: this.d.botUsername(), startParam: `sv_${sel.id}` });
      return btn ? [btn] : [];
    });
    this.d.analytics.track('saved_opened', { userId: String(ctx.userId), props: { from: 'bot', count: list.length } });
    return this.send(ctx, T.savedList(list.length), keyboard([...rows.filter((r) => r.length), [cb('Новый поиск', CB.NEW_SEARCH)]]));
  }
}
