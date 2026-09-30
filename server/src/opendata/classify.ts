import type { Catalog } from '../catalog/catalog';

/**
 * Сопоставление основного ОКВЭД с категориями справочника.
 * ОКВЭД даёт только совпадение по категории и «профильный вид деятельности».
 * Статус производителя по одному ОКВЭД не присваивается (раздел 16 ТЗ).
 */
interface OkvedRule {
  prefix: string;
  category: string;
  /** Для широких группировок уточняем по наименованию кода из реестра. */
  name?: RegExp;
}

const OKVED_RULES: OkvedRule[] = [
  { prefix: '20.30', category: 'paints' },
  { prefix: '20.52', category: 'sealants' },
  { prefix: '23.64', category: 'dry_mixes' },
  { prefix: '23.52', category: 'dry_mixes' },
  { prefix: '23.99', category: 'insulation', name: /тепло|звукоизол|минеральн\S*\s+ват/i },
  { prefix: '23.99', category: 'roofing', name: /асфальт|кровел|рулонн|битум/i },
  { prefix: '25.94', category: 'fasteners' },
];

export function categoriesForOkved(code: string | undefined, name: string | undefined): string[] {
  if (!code) return [];
  const out = new Set<string>();
  for (const r of OKVED_RULES) {
    if (code !== r.prefix && !code.startsWith(`${r.prefix}.`)) continue;
    if (r.name && !r.name.test(name ?? '')) continue;
    out.add(r.category);
  }
  return [...out];
}

/** Быстрая проверка до полного разбора документа реестра. */
export function okvedMayMatch(code: string): boolean {
  return OKVED_RULES.some((r) => code === r.prefix || code.startsWith(`${r.prefix}.`));
}

/** Заявленная в реестре МСП продукция (ОКПД2) → конкретные товары справочника. */
export function productsForOkpd2(code: string | undefined, catalog: Catalog): { productId: string; categoryId: string }[] {
  if (!code) return [];
  const out: { productId: string; categoryId: string }[] = [];
  for (const c of catalog.data.categories) {
    for (const p of c.products) {
      if (p.okpd2 && (code === p.okpd2 || code.startsWith(`${p.okpd2}.`))) out.push({ productId: p.id, categoryId: c.id });
    }
  }
  return out;
}

/** «НОГИНСК» → «Ногинск», «ОРЕХОВО-ЗУЕВО» → «Орехово-Зуево». */
export function titleCase(s: string | undefined | null): string | null {
  if (!s) return null;
  return s
    .toLowerCase()
    .replace(/(^|[\s\-(«"])([а-яёa-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
    .trim();
}

/**
 * Короткое наименование из реестра: прямые кавычки → «ёлочки», вложенные → „лапки“.
 * Кавычка открывающая, если стоит в начале, после пробела или после другой открывающей кавычки.
 */
export function prettyName(short: string | undefined, full: string | undefined): string {
  const raw = (short || full || '').trim().replace(/\s+/g, ' ');
  let depth = 0;
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '"') {
      out += ch;
      continue;
    }
    const prev = out.at(-1) ?? ' ';
    const next = raw[i + 1] ?? ' ';
    const opening = (prev === ' ' || prev === '«' || prev === '„' || /[А-ЯA-Z]$/.test(out) && depth === 0) && next !== ' ' && next !== '"';
    if (opening && depth < 2) {
      out += depth === 0 ? '«' : '„';
      depth += 1;
    } else if (depth > 0) {
      out += depth === 2 ? '“' : '»';
      depth -= 1;
    }
  }
  while (depth > 0) {
    out += depth === 2 ? '“' : '»';
    depth -= 1;
  }
  // «ЗАО«ИМЯ»» → «ЗАО «ИМЯ»»
  return out.replace(/^(ООО|АО|ЗАО|ОАО|ПАО|НАО|ТОО)«/u, '$1 «');
}
