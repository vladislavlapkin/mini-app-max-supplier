import { beforeEach, describe, expect, it } from 'vitest';
import { BotOrchestrator, type BotTransport } from '../src/bot/orchestrator';
import { SessionStore } from '../src/bot/session';
import type { MaxUpdate, NewMessageBody } from '../src/max/types';
import { catalog, FakeRedis, silentLog } from './helpers';

interface Sent {
  kind: 'send' | 'answer';
  text: string;
  buttons: { text: string; payload?: string; url?: string }[];
}

function setup(total = 4) {
  const sent: Sent[] = [];
  const transport: BotTransport = {
    async send(_to, body: NewMessageBody) {
      sent.push({ kind: 'send', text: body.text, buttons: (body.attachments?.[0]?.payload.buttons.flat() ?? []) as Sent['buttons'] });
    },
    async answer(_id, body) {
      sent.push({ kind: 'answer', text: body.message?.text ?? '', buttons: [] });
    },
  };
  const searches: unknown[] = [];
  const bot = new BotOrchestrator(
    {
      sessions: new SessionStore(new FakeRedis() as never),
      catalog,
      tokens: { create: async () => ({ token: 'st_testtoken' }) } as never,
      search: {
        search: async (q: unknown) => {
          searches.push(q);
          return {
            total,
            sources: [],
            empty: total ? null : { actions: [{ id: 'relax_type', label: 'Убрать фильтр «только производитель»', patch: {} }] },
          };
        },
      } as never,
      saved: { listSelections: async () => [] } as never,
      analytics: { track: () => undefined } as never,
      log: silentLog,
      openAppMode: 'link',
      botUsername: () => 'proveren_bot',
    },
    transport,
  );
  return { bot, sent, searches };
}

const msg = (text: string, mid = `m${Math.random()}`): MaxUpdate => ({
  update_type: 'message_created',
  timestamp: Date.now(),
  message: { sender: { user_id: 7 }, recipient: { chat_id: 100, chat_type: 'dialog', user_id: 1 }, timestamp: Date.now(), body: { mid, seq: 1, text } },
});

const press = (payload: string, text = 'предыдущее сообщение'): MaxUpdate => ({
  update_type: 'message_callback',
  timestamp: Date.now(),
  callback: { callback_id: `cb${Math.random()}`, payload, user: { user_id: 7 }, timestamp: Date.now() },
  message: { recipient: { chat_id: 100, chat_type: 'dialog', user_id: 1 }, timestamp: Date.now(), body: { mid: 'x', seq: 1, text } },
});

const lastSend = (sent: Sent[]) => sent.filter((s) => s.kind === 'send').at(-1)!;

describe('bot dialog', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('/start приветствует и предлагает начать поиск', async () => {
    await ctx.bot.handle(msg('/start'));
    const m = lastSend(ctx.sent);
    expect(m.text).toContain('Здравствуйте');
    expect(m.buttons.map((b) => b.text)).toContain('Найти поставщика');
  });

  it('сценарий из ТЗ: одно сообщение → вопрос о типе поставщика → кнопка «Открыть подборку»', async () => {
    await ctx.bot.handle(msg('Нужен производитель строительной краски в Московской области, оптом, до 2 тонн.'));
    let m = lastSend(ctx.sent);
    expect(m.text).toContain('Я понял запрос так:');
    expect(m.text).toContain('— товар: строительная краска;');
    expect(m.text).toContain('— регион: Московская область;');
    expect(m.text).toContain('— формат: опт;');
    expect(m.text).toContain('— объём: до 2 т.');
    expect(m.text).toContain('Ищем только производителя?');
    expect(m.buttons.map((b) => b.text)).toEqual(['Да, только производителя', 'Производителя или дистрибьютора', 'Любого поставщика', 'Изменить параметры']);
    await ctx.bot.handle(press('SET_SUPPLIER_TYPE:MANUFACTURER_ONLY', m.text));
    m = lastSend(ctx.sent);
    expect(m.text).toContain('Параметры готовы. Откройте подборку');
    const open = m.buttons.find((b) => b.text === 'Открыть подборку');
    expect(open?.url).toBe('https://max.ru/proveren_bot?startapp=st_testtoken');
    expect(m.buttons.map((b) => b.text)).toContain('Новый поиск');
  });

  it('уточняет только недостающее: регион и тип поставщика (не больше трёх вопросов)', async () => {
    await ctx.bot.handle(msg('нужна монтажная пена'));
    let m = lastSend(ctx.sent);
    expect(m.text).toContain('В каком регионе ищем?');
    await ctx.bot.handle(press('SET_REGION:77', m.text));
    m = lastSend(ctx.sent);
    expect(m.text).toContain('Ищем только производителя?');
    expect(m.buttons.map((b) => b.text)).toEqual(['Да, только производителя', 'Производителя или дистрибьютора', 'Любого поставщика', 'Изменить параметры']);
    await ctx.bot.handle(press('SET_SUPPLIER_TYPE:MANUFACTURER_ONLY', m.text));
    m = lastSend(ctx.sent);
    expect(m.text).toContain('Параметры готовы');
    const questions = ctx.sent.filter((s) => s.kind === 'send' && /\?$/.test(s.text.trim()));
    expect(questions.length).toBeLessThanOrEqual(3);
    expect(ctx.searches.at(-1)).toMatchObject({ productId: 'mounting_foam', regionCode: '77', supplierType: 'MANUFACTURER_ONLY' });
  });

  it('текстовый ответ на вопрос о регионе тоже принимается', async () => {
    await ctx.bot.handle(msg('саморезы'));
    await ctx.bot.handle(msg('в Тульской области'));
    expect(lastSend(ctx.sent).text).toContain('— регион: Тульская область');
  });

  it('нераспознанный товар — предлагает категории', async () => {
    await ctx.bot.handle(msg('нужны пластиковые окна'));
    const m = lastSend(ctx.sent);
    expect(m.text).toContain('Не нашёл такой товар');
    expect(m.buttons.length).toBe(catalog.data.categories.length);
  });

  it('явный тип поставщика не переспрашивается, сразу подтверждение', async () => {
    await ctx.bot.handle(msg('саморезы только от производителя в Москве'));
    const m = lastSend(ctx.sent);
    expect(m.text).toContain('— тип поставщика: только производитель.');
    expect(m.buttons.map((b) => b.text)).toEqual(['Подтвердить', 'Изменить параметры']);
  });

  it('каждый параметр можно изменить', async () => {
    await ctx.bot.handle(msg('саморезы в Москве, любой поставщик'));
    await ctx.bot.handle(press('CHANGE_QUERY'));
    const m = lastSend(ctx.sent);
    expect(m.buttons.map((b) => b.text)).toEqual(['Товар', 'Регион', 'Тип поставщика', 'Объём', 'Документы', 'Готово']);
    await ctx.bot.handle(press('SET_CERTIFICATE:REQUIRED'));
    expect(lastSend(ctx.sent).text).toContain('документы обязательны');
  });

  it('пустая выдача — альтернативные действия прямо в чате', async () => {
    const empty = setup(0);
    await empty.bot.handle(msg('производитель PIR плит в Москве'));
    await empty.bot.handle(press('SET_SUPPLIER_TYPE:MANUFACTURER_ONLY'));
    const m = lastSend(empty.sent);
    expect(m.text).toContain('ничего не найдено');
    expect(m.buttons.map((b) => b.text)).toEqual(expect.arrayContaining(['Убрать фильтр «только производитель»', 'Изменить параметры', 'Новый поиск']));
  });

  it('/cancel сбрасывает поиск, /saved без подборок подсказывает, как сохранить', async () => {
    await ctx.bot.handle(msg('краска'));
    await ctx.bot.handle(msg('/cancel'));
    expect(lastSend(ctx.sent).text).toContain('Поиск отменён');
    await ctx.bot.handle(msg('/saved'));
    expect(lastSend(ctx.sent).text).toContain('Сохранённых подборок пока нет');
  });

  it('нажатие кнопки подтверждается ответом на callback', async () => {
    await ctx.bot.handle(msg('саморезы'));
    await ctx.bot.handle(press('SET_REGION:50', 'В каком регионе ищем?'));
    const answer = ctx.sent.find((s) => s.kind === 'answer');
    expect(answer?.text).toContain('→ Московская область');
  });
});
