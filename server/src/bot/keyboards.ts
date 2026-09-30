import type { Catalog } from '../catalog/catalog';
import type { Button, InlineKeyboard } from '../max/types';

/** Callback payload: ACTION или ACTION:аргумент (раздел 5.4 ТЗ). */
export const CB = {
  OPEN_APP: 'OPEN_APP',
  CONFIRM_QUERY: 'CONFIRM_QUERY',
  CHANGE_QUERY: 'CHANGE_QUERY',
  SET_REGION: 'SET_REGION',
  SET_SUPPLIER_TYPE: 'SET_SUPPLIER_TYPE',
  SET_VOLUME: 'SET_VOLUME',
  SET_CERTIFICATE: 'SET_CERTIFICATE',
  SET_PRODUCT: 'SET_PRODUCT',
  CHANGE_PRODUCT: 'CHANGE_PRODUCT',
  VIEW_SAVED: 'VIEW_SAVED',
  NEW_SEARCH: 'NEW_SEARCH',
  APPLY_PATCH: 'APPLY_PATCH',
} as const;

export const cb = (text: string, action: string, arg?: string, intent?: 'default' | 'positive' | 'negative'): Button => ({
  type: 'callback',
  text,
  payload: arg ? `${action}:${arg}` : action,
  ...(intent ? { intent } : {}),
});

export const keyboard = (rows: Button[][]): InlineKeyboard => ({ type: 'inline_keyboard', payload: { buttons: rows } });

export function openAppButton(text: string, opts: { mode: 'link' | 'open_app'; botUsername: string | null; startParam?: string }): Button | null {
  if (!opts.botUsername) return null;
  if (opts.mode === 'open_app') return { type: 'open_app', text, web_app: opts.botUsername, ...(opts.startParam ? { payload: opts.startParam } : {}) };
  const url = `https://max.ru/${opts.botUsername}${opts.startParam ? `?startapp=${opts.startParam}` : ''}`;
  return { type: 'link', text, url };
}

export function mainMenu(open: Button | null): InlineKeyboard {
  const rows: Button[][] = [[cb('Найти поставщика', CB.NEW_SEARCH, undefined, 'positive')], [cb('Сохранённые подборки', CB.VIEW_SAVED)]];
  if (open) rows.push([open]);
  return keyboard(rows);
}

export function supplierTypeKeyboard(): InlineKeyboard {
  return keyboard([
    [cb('Да, только производителя', CB.SET_SUPPLIER_TYPE, 'MANUFACTURER_ONLY', 'positive')],
    [cb('Производителя или дистрибьютора', CB.SET_SUPPLIER_TYPE, 'MANUFACTURER_OR_DISTRIBUTOR')],
    [cb('Любого поставщика', CB.SET_SUPPLIER_TYPE, 'ANY')],
    [cb('Изменить параметры', CB.CHANGE_QUERY)],
  ]);
}

export function regionKeyboard(catalog: Catalog): InlineKeyboard {
  const pilot = catalog.data.pilotRegions.map((code) => catalog.region(code)!).filter(Boolean);
  const neighbors = ['71', '40'].map((code) => catalog.region(code)!).filter(Boolean);
  return keyboard([
    pilot.map((r) => cb(r.name, CB.SET_REGION, r.code)),
    neighbors.map((r) => cb(r.name, CB.SET_REGION, r.code)),
    [cb('Вся Россия', CB.SET_REGION, 'RU')],
  ]);
}

export function categoriesKeyboard(catalog: Catalog): InlineKeyboard {
  const cats = catalog.data.categories;
  const rows: Button[][] = [];
  for (let i = 0; i < cats.length; i += 2) rows.push(cats.slice(i, i + 2).map((c) => cb(c.name, CB.SET_PRODUCT, `cat.${c.id}`)));
  return keyboard(rows);
}

export function confirmKeyboard(): InlineKeyboard {
  return keyboard([[cb('Подтвердить', CB.CONFIRM_QUERY, undefined, 'positive')], [cb('Изменить параметры', CB.CHANGE_QUERY)]]);
}

export function changeKeyboard(): InlineKeyboard {
  return keyboard([
    [cb('Товар', CB.CHANGE_PRODUCT), cb('Регион', CB.SET_REGION)],
    [cb('Тип поставщика', CB.SET_SUPPLIER_TYPE), cb('Объём', CB.SET_VOLUME)],
    [cb('Документы', CB.SET_CERTIFICATE)],
    [cb('Готово', CB.CONFIRM_QUERY, undefined, 'positive')],
  ]);
}

export function certificateKeyboard(): InlineKeyboard {
  return keyboard([
    [cb('Обязательно', CB.SET_CERTIFICATE, 'REQUIRED')],
    [cb('Желательно', CB.SET_CERTIFICATE, 'PREFERRED')],
    [cb('Не важно', CB.SET_CERTIFICATE, 'NOT_REQUIRED')],
  ]);
}

export function volumeKeyboard(): InlineKeyboard {
  return keyboard([[cb('Не важно', CB.SET_VOLUME, 'none')]]);
}

export function readyKeyboard(open: Button | null): InlineKeyboard {
  const rows: Button[][] = [];
  if (open) rows.push([open]);
  rows.push([cb('Новый поиск', CB.NEW_SEARCH)]);
  return keyboard(rows);
}
