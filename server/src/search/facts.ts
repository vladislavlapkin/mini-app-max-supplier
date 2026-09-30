import type { Catalog } from '../catalog/catalog';
import type { Fact, LegalStatus, Provenance, SearchQuery, SmeStatus } from '../domain/types';
import type { DocumentRow, ProductRow, RiskRow, VerificationRow } from '../sources/types';
import { type Coverage, type Evidence, OFFICIAL_ONLY_BY_ACCESS, type ProductMatchLevel, type RegionMatch, type SupplierRow } from './model';

export interface DerivedFacts {
  legalStatus: Fact<LegalStatus> & { refreshed: boolean };
  sme: Fact<SmeStatus> & { refreshed: boolean };
  productMatch: ProductMatchLevel;
  /** declared — продукция заявлена в реестре МСП; okved — только по основному ОКВЭД; catalog — ручная база/ГИСП. */
  productBasis: 'declared' | 'okved' | 'catalog';
  matchedProductTitles: string[];
  /** Источники, не подключённые для этой компании (нет разрешённого доступа). */
  uncovered: string[];
  regionMatch: RegionMatch;
  okvedMatch: boolean;
  gispRecords: ProductRow[];
  pp719Records: ProductRow[];
  documents: DerivedDocument[];
  risks: RiskRow[];
  discrepancies: string[];
  sourcesFailed: string[];
  checkedAt: string;
}

export interface DerivedDocument {
  row: DocumentRow;
  isActive: boolean;
  isOfficiallyVerified: boolean;
  countsAsActive: boolean;
  match: 'product' | 'category' | 'other';
  statusLabel: string;
}

const PSEUDO_SOURCES: Record<string, string> = { MANUAL: 'Ручная тестовая база' };

export function provenanceOf(
  row: Pick<VerificationRow, 'source' | 'source_url' | 'checked_at'> &
    Partial<Pick<VerificationRow, 'source_type' | 'fresh_until' | 'confidence' | 'is_official' | 'is_manual_test_data'>>,
  catalog: Catalog,
  now: Date,
): Provenance {
  const src = catalog.source(row.source);
  const isManual = row.is_manual_test_data ?? true;
  const freshUntil = row.fresh_until ?? null;
  return {
    source: row.source,
    sourceName: PSEUDO_SOURCES[row.source] ?? src.name,
    sourceUrl: row.source_url || src.url || null,
    sourceType: row.source_type ?? (isManual ? 'MANUAL_TEST_DATA' : 'OFFICIAL'),
    checkedAt: row.checked_at,
    freshUntil,
    confidence: row.confidence ?? 0.9,
    isOfficial: row.is_official ?? !isManual,
    isManualTestData: isManual,
    stale: freshUntil ? new Date(freshUntil).getTime() < now.getTime() : false,
  };
}

export function fieldValue(rows: VerificationRow[] | null | undefined, field: string): VerificationRow | undefined {
  return rows?.find((r) => r.field === field);
}

function matchesOkved(code: string | undefined, prefixes: string[]): boolean {
  return !!code && prefixes.some((p) => code === p || code.startsWith(p + '.'));
}

export function regionMatchOf(supplierRegion: string, queryRegion: string | null, catalog: Catalog): RegionMatch {
  if (!queryRegion || queryRegion === 'RU') return 'any';
  if (supplierRegion === queryRegion) return 'same';
  if (catalog.neighbors(queryRegion).includes(supplierRegion)) return 'neighbor';
  return 'other';
}

const DOC_STATUS_LABEL: Record<DocumentRow['status'], string> = {
  ACTIVE: 'Действует',
  SUSPENDED: 'Приостановлен',
  TERMINATED: 'Прекращён',
  ARCHIVED: 'Архивный (срок истёк)',
  UNKNOWN: 'Статус не определён',
};

export function deriveFacts(
  s: SupplierRow,
  ev: Evidence,
  query: SearchQuery | null,
  catalog: Catalog,
  now: Date,
  demoTrustManual: boolean,
  coverage: Coverage = null,
): DerivedFacts {
  const sourcesFailed: string[] = [];
  const today = now.toISOString().slice(0, 10);
  const uncovered = s.source_type === 'OFFICIAL' && coverage ? OFFICIAL_ONLY_BY_ACCESS.filter((src) => !coverage.has(src)) : [];

  // Статус деятельности: ЕГРЮЛ → реестр МСП (в нём только действующие субъекты) → последний известный с отметкой
  const legalRow = fieldValue(ev.fns?.rows, 'legal_status');
  const smeLegalRow = fieldValue(ev.sme, 'legal_status');
  let legalStatus: DerivedFacts['legalStatus'];
  if (legalRow) {
    legalStatus = { value: legalRow.value as LegalStatus, provenance: provenanceOf(legalRow, catalog, now), refreshed: true };
  } else if (smeLegalRow && s.legal_status !== 'UNKNOWN') {
    legalStatus = { value: smeLegalRow.value as LegalStatus, provenance: provenanceOf(smeLegalRow, catalog, now), refreshed: true };
  } else if (s.source_type === 'OFFICIAL') {
    legalStatus = {
      value: 'UNKNOWN',
      provenance: smeLegalRow ? { ...provenanceOf(smeLegalRow, catalog, now), stale: true } : null,
      refreshed: false,
    };
  } else {
    if (!ev.fns) sourcesFailed.push('FNS_EGRUL');
    legalStatus = {
      value: s.legal_status,
      provenance: { ...provenanceOf({ source: 'FNS_EGRUL', source_url: null, checked_at: s.checked_at }, catalog, now), stale: true },
      refreshed: false,
    };
  }

  const smeRow = fieldValue(ev.sme, 'sme_status');
  let sme: DerivedFacts['sme'];
  if (smeRow) sme = { value: smeRow.value as SmeStatus, provenance: provenanceOf(smeRow, catalog, now), refreshed: true };
  else {
    if (!ev.sme) sourcesFailed.push('SME_REGISTRY');
    sme = { value: 'UNKNOWN', provenance: null, refreshed: false };
  }

  const category = catalog.category(query?.categoryId ?? null);
  const inCategory = s.products.filter((p) => !category || p.category_id === category.id);
  let productMatch: ProductMatchLevel = 'none';
  let matchedProductTitles: string[] = [];
  if (query?.productId) {
    const exact = inCategory.filter((p) => p.product_id === query.productId);
    if (exact.length) {
      productMatch = 'product';
      matchedProductTitles = exact.map((p) => p.title);
    } else if (inCategory.length) {
      productMatch = 'category';
      matchedProductTitles = inCategory.map((p) => p.title);
    }
  } else if (category && inCategory.length) {
    productMatch = 'category';
    matchedProductTitles = inCategory.map((p) => p.title);
  }
  const matchedRecords = inCategory.filter((p) => productMatch !== 'product' || p.product_id === query?.productId);
  const productBasis: DerivedFacts['productBasis'] = matchedRecords.some((p) => p.origin === 'SME_DECLARED')
    ? 'declared'
    : matchedRecords.length && matchedRecords.every((p) => p.origin === 'OKVED')
      ? 'okved'
      : 'catalog';

  const okvedMain = fieldValue(ev.fns?.rows, 'okved_main')?.value ?? s.okved_main?.code;
  const okvedAdd = (fieldValue(ev.fns?.rows, 'okved_additional')?.value.split(',') ?? s.okved_additional.map((o) => o.code)).filter(Boolean);
  const okvedMatch = category ? [okvedMain, ...okvedAdd].some((c) => matchesOkved(c, category.okved)) : false;

  const inScope = (p: { category_id: string; product_id: string | null }) => !category || p.category_id === category.id;
  if (!ev.gisp) sourcesFailed.push('GISP');
  if (!ev.pp719) sourcesFailed.push('GISP_PP719');
  const gispRecords = (ev.gisp ?? []).filter(inScope);
  const pp719Records = (ev.pp719 ?? []).filter((p) => inScope(p) && p.russian_origin_confirmed);

  if (!ev.certs) sourcesFailed.push('FSA_CERT');
  if (!ev.decls) sourcesFailed.push('FSA_DECL');
  const documents: DerivedDocument[] = [...(ev.decls ?? []), ...(ev.certs ?? [])].map((row) => {
    const notExpired = !row.valid_to || row.valid_to >= today;
    const isActive = row.status === 'ACTIVE' && notExpired;
    const isOfficiallyVerified = isActive && !row.is_manual_test_data;
    const productCategory = catalog.product(row.product_id)?.categoryId;
    const match: DerivedDocument['match'] =
      query?.productId && row.product_id === query.productId
        ? 'product'
        : row.product_id && (!category || productCategory === category.id)
          ? query?.productId
            ? 'category'
            : 'product'
          : 'other';
    let statusLabel = DOC_STATUS_LABEL[row.status];
    if (row.status === 'ACTIVE' && !notExpired) statusLabel = 'Срок действия истёк';
    return { row, isActive, isOfficiallyVerified, countsAsActive: isOfficiallyVerified || (isActive && demoTrustManual), match, statusLabel };
  });

  if (!ev.rnp) sourcesFailed.push('FAS_RNP');
  if (!ev.fedresurs) sourcesFailed.push('FEDRESURS');
  const risks = [...(ev.fns?.risks ?? []), ...(ev.rnp ?? []), ...(ev.fedresurs ?? [])];

  const discrepancies: string[] = [];
  const claim = fieldValue(ev.manual, 'supplier_type_claim');
  if (claim && claim.value !== s.supplier_type) {
    discrepancies.push(claim.notes ?? 'Сведения о типе поставщика в разных источниках расходятся');
  }
  const fnsRegion = fieldValue(ev.fns?.rows, 'region')?.value;
  if (fnsRegion && fnsRegion !== s.region_code) {
    discrepancies.push('Регион в карточке компании отличается от региона регистрации в ЕГРЮЛ');
  }

  const dates = [s.checked_at, legalRow?.checked_at, smeRow?.checked_at].filter(Boolean) as string[];
  const checkedAt = dates.sort().at(-1) ?? s.checked_at;

  return {
    legalStatus,
    sme,
    productMatch,
    productBasis,
    matchedProductTitles,
    uncovered,
    regionMatch: regionMatchOf(s.region_code, query?.regionCode ?? null, catalog),
    okvedMatch,
    gispRecords,
    pp719Records,
    documents,
    risks,
    discrepancies,
    sourcesFailed: [...new Set(sourcesFailed)],
    checkedAt,
  };
}
