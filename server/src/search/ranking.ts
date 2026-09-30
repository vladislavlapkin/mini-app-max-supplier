import type { Catalog } from '../catalog/catalog';
import { formatDateRu } from '../catalog/text';
import { SUPPLIER_TYPE_LABEL, type SearchQuery, type SupplierType } from '../domain/types';
import type { DerivedFacts } from './facts';
import type { Reason, SupplierRow } from './model';

/** Веса из раздела 11.2 ТЗ. */
export const WEIGHTS = {
  productMatch: 0.35,
  regionMatch: 0.2,
  supplierTypeMatch: 0.15,
  legalVerification: 0.1,
  documentMatch: 0.1,
  profileCompleteness: 0.05,
  dataFreshness: 0.05,
} as const;

export type ScoreComponents = Record<keyof typeof WEIGHTS, number>;

export interface HardFilterResult {
  excluded: boolean;
  reason?: string;
}

/** Hard filters (11.1). Недоступность источника никогда не исключает компанию. */
export function hardFilter(s: SupplierRow, f: DerivedFacts, q: SearchQuery, catalog: Catalog): HardFilterResult {
  if (f.legalStatus.value === 'INACTIVE') return { excluded: true, reason: 'деятельность прекращена' };
  if (f.productMatch === 'none') return { excluded: true, reason: 'нет совпадения по товарной категории' };
  if (q.strictRegion && f.regionMatch !== 'same' && f.regionMatch !== 'any') return { excluded: true, reason: 'вне региона' };

  // «Только производитель» исключает дистрибьюторов и посредников. Тип «не определён» с производственным ОКВЭД остаётся
  // ниже в выдаче с предупреждением: производителем его не называем, но и не отбрасываем (ТЗ 11.1).
  if (q.supplierType === 'MANUFACTURER_ONLY') {
    if (s.supplier_type === 'DISTRIBUTOR' || s.supplier_type === 'SUPPLIER') return { excluded: true, reason: 'не производитель' };
    if (s.supplier_type === 'UNKNOWN' && !f.okvedMatch) return { excluded: true, reason: 'не подтверждён как производитель' };
  }
  if (q.supplierType === 'MANUFACTURER_OR_DISTRIBUTOR' && s.supplier_type === 'SUPPLIER') {
    return { excluded: true, reason: 'торговый посредник' };
  }

  if (q.certificate === 'REQUIRED') {
    const unavailable = (src: string) => f.sourcesFailed.includes(src) || f.uncovered.includes(src);
    const docsUnavailable = unavailable('FSA_CERT') && unavailable('FSA_DECL');
    const hasDoc = f.documents.some((d) => d.countsAsActive && d.match !== 'other');
    if (!hasDoc && !docsUnavailable) return { excluded: true, reason: 'нет действующего документа на товар' };
  }

  const category = catalog.category(q.categoryId);
  if (q.russianOnly && category?.industrial) {
    const unavailable = f.sourcesFailed.includes('GISP_PP719') || f.uncovered.includes('GISP_PP719');
    if (!f.pp719Records.length && !unavailable) return { excluded: true, reason: 'нет записи в реестре ПП РФ №719' };
  }
  return { excluded: false };
}

function supplierTypeScore(type: SupplierType, pref: SearchQuery['supplierType']): number {
  const table: Record<SearchQuery['supplierType'], Record<SupplierType, number>> = {
    MANUFACTURER_ONLY: { MANUFACTURER: 1, DISTRIBUTOR: 0, SUPPLIER: 0, UNKNOWN: 0.35 },
    MANUFACTURER_OR_DISTRIBUTOR: { MANUFACTURER: 1, DISTRIBUTOR: 0.85, SUPPLIER: 0, UNKNOWN: 0.3 },
    ANY: { MANUFACTURER: 1, DISTRIBUTOR: 0.9, SUPPLIER: 0.75, UNKNOWN: 0.5 },
  };
  return table[pref][type];
}

export function scoreSupplier(s: SupplierRow, f: DerivedFacts, q: SearchQuery, now: Date): { score: number; components: ScoreComponents } {
  const productMatch = f.productMatch === 'product' ? 1 : f.productMatch === 'category' ? (q.productId ? 0.6 : 0.85) : 0;
  const regionMatch = { same: 1, any: 1, neighbor: 0.6, other: 0.2 }[f.regionMatch];
  const supplierTypeMatch = supplierTypeScore(s.supplier_type, q.supplierType);
  const legalVerification = f.legalStatus.value === 'ACTIVE' ? (f.legalStatus.refreshed ? 1 : 0.5) : 0.3;

  const relevant = f.documents.filter((d) => d.match !== 'other');
  const documentMatch = relevant.some((d) => d.countsAsActive && d.match === 'product')
    ? 1
    : relevant.some((d) => d.countsAsActive)
      ? 0.6
      : relevant.length
        ? 0.25
        : 0;

  // Полнота профиля — наличие сведений, а не оценка надёжности
  const completenessChecks = [
    !!s.website,
    !!s.phone,
    !!s.okved_main,
    f.sme.value !== 'NOT_FOUND' && f.sme.value !== 'UNKNOWN',
    f.gispRecords.length > 0,
    f.documents.length > 0,
    !!s.address,
    (s.employees ?? 0) > 0,
    (s.last_revenue ?? 0) > 0,
  ];
  const profileCompleteness = completenessChecks.filter(Boolean).length / completenessChecks.length;

  const ageDays = (now.getTime() - new Date(f.checkedAt).getTime()) / 86_400_000;
  const dataFreshness = ageDays <= 30 ? 1 : ageDays <= 90 ? 0.7 : ageDays <= 180 ? 0.4 : 0.1;

  const components: ScoreComponents = {
    productMatch,
    regionMatch,
    supplierTypeMatch,
    legalVerification,
    documentMatch,
    profileCompleteness,
    dataFreshness,
  };
  const score = (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).reduce((acc, k) => acc + WEIGHTS[k] * components[k], 0);
  return { score: Math.round(score * 1000) / 1000, components };
}

const TEST_MARK = ' (тестовые данные)';

/** Объяснение выдачи (11.3): только проверяемые факты, без оценок «надёжный/ненадёжный». */
export function buildReasons(s: SupplierRow, f: DerivedFacts, q: SearchQuery, catalog: Catalog): Reason[] {
  const reasons: Reason[] = [];
  const product = catalog.product(q.productId);
  const category = catalog.category(q.categoryId);

  if (f.productBasis === 'okved') {
    reasons.push({ kind: 'ok', text: `совпадает категория «${category?.name}» по основному ОКВЭД` });
    reasons.push({ kind: 'warn', text: product ? `конкретный товар «${product.name.toLowerCase()}» в источниках не подтверждён` : 'конкретная продукция в источниках не подтверждена' });
  } else if (f.productMatch === 'product') {
    const tail = f.productBasis === 'declared' ? ' — заявлено компанией в реестре МСП' : '';
    reasons.push({ kind: 'ok', text: product ? `есть товар «${product.name.toLowerCase()}»${tail}` : `совпадает товарная категория${tail}` });
  } else if (f.productMatch === 'category')
    reasons.push({
      kind: product ? 'warn' : 'ok',
      text: product ? `совпадает категория «${category?.name}», но «${product.name.toLowerCase()}» не указан` : 'совпадает товарная категория',
    });

  const region = catalog.region(s.region_code);
  if (f.regionMatch === 'same') reasons.push({ kind: 'ok', text: 'подходит регион' });
  else if (f.regionMatch === 'neighbor') reasons.push({ kind: 'warn', text: `соседний регион: ${region?.name ?? s.region_name}` });
  else if (f.regionMatch === 'other') reasons.push({ kind: 'warn', text: `другой регион: ${region?.name ?? s.region_name}` });

  if (s.supplier_type === 'UNKNOWN') reasons.push({ kind: 'warn', text: 'тип поставщика не определён: одного ОКВЭД недостаточно' });
  else if (f.productBasis === 'declared') reasons.push({ kind: 'warn', text: 'производитель по заявлению компании в реестре МСП — документами не подтверждено' });
  else reasons.push({ kind: 'ok', text: `тип поставщика: ${SUPPLIER_TYPE_LABEL[s.supplier_type].toLowerCase()}` });

  const mark = (manual: boolean | undefined) => (manual ? TEST_MARK : '');
  const legalSource = f.legalStatus.provenance?.source;
  if (f.legalStatus.refreshed && f.legalStatus.value === 'ACTIVE' && legalSource === 'SME_REGISTRY') {
    reasons.push({ kind: 'ok', text: `компания в реестре МСП на ${formatDateRu(f.legalStatus.provenance?.checkedAt)}: в нём только действующие субъекты` });
  } else if (f.legalStatus.refreshed && f.legalStatus.value === 'ACTIVE') {
    reasons.push({ kind: 'ok', text: `компания найдена в ${s.entity_type === 'IP' ? 'ЕГРИП' : 'ЕГРЮЛ'}, статус «действует»${mark(f.legalStatus.provenance?.isManualTestData)}` });
  } else if (s.source_type === 'OFFICIAL' && f.legalStatus.value === 'UNKNOWN') {
    reasons.push({ kind: 'warn', text: 'компания исключена из реестра МСП — статус деятельности не подтверждён' });
  } else if (!f.legalStatus.refreshed) {
    reasons.push({ kind: 'warn', text: `ЕГРЮЛ сейчас недоступен — статус на ${formatDateRu(f.legalStatus.provenance?.checkedAt)}` });
  }

  if (f.okvedMatch) reasons.push({ kind: 'ok', text: 'есть профильный ОКВЭД' });
  if (f.gispRecords.length) reasons.push({ kind: 'ok', text: `найдена запись ГИСП${mark(f.gispRecords[0].is_manual_test_data)}` });
  if (f.pp719Records.length) reasons.push({ kind: 'ok', text: 'продукция в реестре ПП РФ №719' });

  const relevant = f.documents.filter((d) => d.match !== 'other');
  const active = relevant.filter((d) => d.countsAsActive);
  if (active.length) {
    const d = active[0];
    const kind = d.row.document_type === 'DECLARATION' ? 'декларация' : 'сертификат';
    reasons.push({
      kind: d.isOfficiallyVerified ? 'ok' : 'warn',
      text: d.isOfficiallyVerified ? `действующая ${kind} на товар` : `${kind} на товар — по данным тестовой базы, требует проверки в реестре Росаккредитации`,
    });
  } else if (relevant.length) {
    reasons.push({ kind: 'warn', text: `документ на товар найден, но ${relevant[0].statusLabel.toLowerCase()}` });
  } else if (f.documents.length) {
    reasons.push({ kind: 'warn', text: 'найден документ на другой товар — не совпадает с запросом' });
  }

  for (const r of f.risks) reasons.push({ kind: 'warn', text: `официальный факт: ${r.title.toLowerCase()}` });
  for (const d of f.discrepancies) reasons.push({ kind: 'warn', text: `расхождение данных: ${d.toLowerCase()}` });
  if (f.uncovered.length) {
    const names: Record<string, string> = { FNS_EGRUL: 'ЕГРЮЛ', GISP: 'ГИСП', FSA_DECL: 'Росаккредитация', FAS_RNP: 'РНП', FEDRESURS: 'ЕФРСБ' };
    const list = [...new Set(f.uncovered.map((u) => names[u]).filter(Boolean))].join(', ');
    reasons.push({ kind: 'warn', text: `не проверялось: ${list} — нет доступа к API, проверьте по ссылкам в карточке` });
  }

  if (q.volume) reasons.push({ kind: 'warn', text: 'объём поставки не проверяется — уточните у поставщика' });
  reasons.push({ kind: 'warn', text: 'минимальная партия, цена и наличие не подтверждены' });
  return reasons;
}
