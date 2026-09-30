import type { Catalog, SynonymEntry } from '../catalog/catalog';
import { levenshtein, normalize, soften, stem, tokenize } from '../catalog/text';
import type { CertificateRequirement, SearchQuery, SupplierTypePref, Volume } from '../domain/types';

export interface ProductMatch {
  productId: string | null;
  categoryId: string;
  name: string;
  normalized: string;
  raw: string;
  confidence: number;
}

export interface ParsedQuery {
  text: string;
  product: ProductMatch | null;
  productCandidates: ProductMatch[];
  region: { code: string; name: string; confidence: number } | null;
  volume: Volume | null;
  supplierType: SupplierTypePref | null;
  supplierTypeConfidence: number;
  certificate: CertificateRequirement | null;
  wholesale: boolean | null;
  missing: ('product' | 'region' | 'supplier_type' | 'volume' | 'certificate_requirement')[];
}

/** Порог уверенности, ниже которого бот переспрашивает товар. */
export const PRODUCT_CONFIDENCE_THRESHOLD = 0.7;

const STOP_WORDS = new Set(
  'нужен нужна нужно нужны ищу ищем найти найдите купить закупить закупка требуется интересует хочу подберите подобрать для в во на до от по и или с со у из к под около примерно не более менее оптом опт розница партия партией объем объемом производитель производителя производители поставщик поставщика поставщики дистрибьютор дистрибьютора завод завода компания компанию'.split(
    ' ',
  ),
);

function stemsMatch(synStem: string, queryStem: string): 'exact' | 'fuzzy' | null {
  if (synStem === queryStem) return 'exact';
  if (synStem.length >= 4 && queryStem.startsWith(synStem) && queryStem.length - synStem.length <= 3) return 'exact';
  if (synStem.length >= 5 && queryStem.length >= 5 && levenshtein(synStem, queryStem, 1) <= 1) return 'fuzzy';
  return null;
}

/** Ищет товар/категорию по таблице синонимов. Fuzzy — только вспомогательный механизм. */
export function matchProduct(text: string, catalog: Catalog): ProductMatch[] {
  const tokens = tokenize(text);
  const stems = tokens.map(stem);
  const scored: { entry: SynonymEntry; score: number; fuzzy: boolean; used: number[] }[] = [];

  for (const entry of catalog.synonyms) {
    const used: number[] = [];
    let fuzzy = false;
    let ok = true;
    for (const s of entry.stems) {
      let found = -1;
      for (let i = 0; i < stems.length; i++) {
        if (used.includes(i)) continue;
        const m = stemsMatch(s, stems[i]);
        if (m) {
          found = i;
          if (m === 'fuzzy') fuzzy = true;
          break;
        }
      }
      if (found < 0) {
        ok = false;
        break;
      }
      used.push(found);
    }
    if (!ok) continue;
    const score = entry.stems.length * 10 + (entry.productId ? 3 : 0) - (fuzzy ? 5 : 0);
    scored.push({ entry, score, fuzzy, used });
  }

  scored.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const result: ProductMatch[] = [];
  for (const s of scored) {
    const key = `${s.entry.categoryId}:${s.entry.productId ?? '*'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cat = catalog.category(s.entry.categoryId)!;
    const prod = catalog.product(s.entry.productId);
    let confidence: number;
    if (!prod) confidence = s.fuzzy ? 0.55 : 0.72;
    else if (s.fuzzy) confidence = 0.62;
    else confidence = s.entry.stems.length > 1 ? 0.95 : 0.86;
    result.push({
      productId: prod?.id ?? null,
      categoryId: cat.id,
      name: prod?.name ?? cat.name,
      normalized: prod?.normalized ?? cat.name,
      raw: s.used
        .sort((a, b) => a - b)
        .map((i) => tokens[i])
        .join(' '),
      confidence,
    });
    if (result.length >= 5) break;
  }
  return result;
}

export function matchRegion(text: string, catalog: Catalog): ParsedQuery['region'] {
  const t = soften(text);
  let best: { code: string; name: string; len: number } | null = null;
  for (const { region, re } of catalog.regionPatterns) {
    for (const r of re) {
      const m = r.exec(t);
      if (m && (!best || m[0].length > best.len)) best = { code: region.code, name: region.name, len: m[0].length };
    }
  }
  return best ? { code: best.code, name: best.name, confidence: best.len > 3 ? 0.95 : 0.75 } : null;
}

export function matchVolume(text: string, catalog: Catalog): Volume | null {
  const t = soften(text);
  const units = catalog.unitPatterns.map((u) => `(?<u_${u.unit.id}_${catalog.unitPatterns.indexOf(u)}>${u.source.replace(/\\w/g, '[\\p{L}]')})`);
  const re = new RegExp(
    `(?:(?<op>до|не более|не больше|максимум|от|не менее|минимум|около|примерно)\\s+)?(?<num>\\d+(?:[.,]\\d+)?)\\s*(?:${units.join('|')})(?![\\p{L}\\p{N}])`,
    'iu',
  );
  const m = re.exec(t);
  if (!m?.groups) return null;
  const unitKey = Object.entries(m.groups).find(([k, v]) => k.startsWith('u_') && v !== undefined)?.[0];
  if (!unitKey) return null;
  const unitId = unitKey.split('_').slice(1, -1).join('_');
  const value = Number(m.groups.num.replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return null;
  const op = m.groups.op;
  const operator: Volume['operator'] = !op ? 'eq' : ['от', 'не менее', 'минимум'].includes(op) ? 'gte' : ['около', 'примерно'].includes(op) ? 'eq' : 'lte';
  return { value, unit: unitId, operator };
}

/** Порог уверенности для типа поставщика: ниже — бот переспрашивает. */
export const SUPPLIER_TYPE_CONFIDENCE_THRESHOLD = 0.8;

/**
 * Тип поставщика. Слово «производитель» само по себе неоднозначно (часто подходит и дистрибьютор),
 * поэтому даёт низкую уверенность и бот уточняет: «Ищем только производителя?».
 */
export function matchSupplierType(text: string): { value: SupplierTypePref; confidence: number } | null {
  const t = normalize(text);
  if (/производител\p{L}*\s+(или|либо)\s+(дистрибьютор|дилер|официальн)/u.test(t)) return { value: 'MANUFACTURER_OR_DISTRIBUTOR', confidence: 0.95 };
  if (/(дистрибьютор|дилер|официальн\p{L}*\s+представител)/u.test(t)) return { value: 'MANUFACTURER_OR_DISTRIBUTOR', confidence: 0.85 };
  if (/(любо\p{L}*\s+поставщик|не\s+важно\s+кто|кто\s+угодно|перепродав|посредник)/u.test(t)) return { value: 'ANY', confidence: 0.9 };
  if (/(только\s+(от\s+)?(производител|завод|изготовител)|напрямую\s+(с|от)\s+(завод|производ)|без\s+посредник)/u.test(t)) return { value: 'MANUFACTURER_ONLY', confidence: 0.95 };
  if (/(производител|изготовител|завод|фабрик|с\s+производства)/u.test(t)) return { value: 'MANUFACTURER_ONLY', confidence: 0.6 };
  return null;
}

export function matchCertificate(text: string): CertificateRequirement | null {
  const t = normalize(text);
  if (/(без\s+(сертификат|декларац|документ)|документы\s+не\s+(нужны|важны))/u.test(t)) return 'NOT_REQUIRED';
  if (/((с|со|нужн\p{L}*|обязательн\p{L}*|есть)\s+(сертификат|декларац|документ))|сертифицированн/u.test(t)) return 'REQUIRED';
  return null;
}

/** Разбор свободного запроса. Не требует ОКВЭД и отрасль пользователя. */
export function parseQuery(text: string, catalog: Catalog): ParsedQuery {
  const candidates = matchProduct(text, catalog);
  const product = candidates[0] ?? null;
  const region = matchRegion(text, catalog);
  const volume = matchVolume(text, catalog);
  const st = matchSupplierType(text);
  const certificate = matchCertificate(text);
  const t = normalize(text);
  const wholesale = /(^|\s)опт/u.test(t) ? true : /розниц/u.test(t) ? false : null;

  const missing: ParsedQuery['missing'] = [];
  if (!product || product.confidence < PRODUCT_CONFIDENCE_THRESHOLD) missing.push('product');
  if (!region) missing.push('region');
  if (!st || st.confidence < SUPPLIER_TYPE_CONFIDENCE_THRESHOLD) missing.push('supplier_type');
  if (!volume) missing.push('volume');
  if (!certificate) missing.push('certificate_requirement');

  return {
    text: text.trim(),
    product,
    productCandidates: candidates,
    region,
    volume,
    supplierType: st?.value ?? null,
    supplierTypeConfidence: st?.confidence ?? 0,
    certificate,
    wholesale,
    missing,
  };
}

/** Остаток текста без стоп-слов — используется, если товар не распознан по справочнику. */
export function leftoverProductText(text: string): string {
  return tokenize(text)
    .filter((t) => !STOP_WORDS.has(t) && !/^\d/.test(t))
    .slice(0, 6)
    .join(' ');
}

export function toSearchQuery(p: ParsedQuery, defaults: Partial<SearchQuery> = {}): SearchQuery {
  return {
    text: p.product?.name.toLowerCase() ?? leftoverProductText(p.text),
    productId: p.product?.productId ?? null,
    categoryId: p.product?.categoryId ?? null,
    regionCode: p.region?.code ?? null,
    strictRegion: false,
    supplierType: p.supplierType ?? 'ANY',
    volume: p.volume,
    certificate: p.certificate ?? 'PREFERRED',
    russianOnly: false,
    ...defaults,
  };
}
