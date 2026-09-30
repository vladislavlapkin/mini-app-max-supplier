// Типы ответа API. Совпадают с server/src/search/dto.ts и server/src/domain/types.ts.

export type SupplierTypePref = 'MANUFACTURER_ONLY' | 'MANUFACTURER_OR_DISTRIBUTOR' | 'ANY';
export type CertificateRequirement = 'REQUIRED' | 'PREFERRED' | 'NOT_REQUIRED';
export type SupplierType = 'MANUFACTURER' | 'DISTRIBUTOR' | 'SUPPLIER' | 'UNKNOWN';

export interface Volume {
  value: number;
  unit: string;
  operator: 'lte' | 'gte' | 'eq';
}

export interface SearchQuery {
  text: string;
  productId: string | null;
  categoryId: string | null;
  regionCode: string | null;
  strictRegion: boolean;
  supplierType: SupplierTypePref;
  volume: Volume | null;
  certificate: CertificateRequirement;
  russianOnly: boolean;
}

export interface Provenance {
  source: string;
  sourceName: string;
  sourceUrl: string | null;
  sourceType: 'OFFICIAL' | 'MANUAL_TEST_DATA';
  checkedAt: string | null;
  freshUntil: string | null;
  confidence: number;
  isOfficial: boolean;
  isManualTestData: boolean;
  stale: boolean;
}

export interface Fact<T> {
  value: T;
  provenance: Provenance | null;
}

export interface Reason {
  kind: 'ok' | 'warn' | 'info';
  text: string;
}

export interface DocumentDto {
  type: 'CERTIFICATE' | 'DECLARATION';
  number: string;
  status: string;
  statusLabel: string;
  isActive: boolean;
  isOfficiallyVerified: boolean;
  match: 'product' | 'category' | 'other';
  productName: string | null;
  manufacturer: string | null;
  manufacturerInn: string | null;
  applicant: string | null;
  techRegulation: string | null;
  certificationBody: string | null;
  validFrom: string | null;
  validTo: string | null;
  provenance: Provenance;
}

export interface RiskDto {
  kind: string;
  title: string;
  details: string | null;
  recordNumber: string | null;
  publishedAt: string | null;
  provenance: Provenance;
}

export interface SourceStatus {
  id: string;
  name: string;
  status: 'ok' | 'failed' | 'not_configured';
  mode: string;
  message?: string;
}

export interface SupplierSummary {
  id: string;
  inn: string;
  ogrn: string;
  name: string;
  entityType: 'LEGAL_ENTITY' | 'IP';
  supplierType: SupplierType;
  supplierTypeLabel: string;
  supplierTypeBasis: string | null;
  supplierTypeConfidence: number;
  region: { code: string; name: string };
  city: string | null;
  regionMatch: 'same' | 'neighbor' | 'other' | 'any';
  product: { titles: string[]; match: 'product' | 'category' | 'none' };
  legalStatus: Fact<'ACTIVE' | 'INACTIVE' | 'UNKNOWN'> & { label: string; refreshed: boolean };
  sme: Fact<string> & { label: string; refreshed: boolean };
  gisp: { found: boolean; records: number; pp719: boolean; provenance: Provenance | null };
  documents: { total: number; active: number; relevantActive: number; items: DocumentDto[] };
  risks: RiskDto[];
  discrepancies: string[];
  checkedAt: string;
  score: number;
  scoreComponents: Record<string, number>;
  reasons: Reason[];
  isManualTestData: boolean;
  sourcesFailed: string[];
  uncovered: string[];
}

export interface EmptyAction {
  id: string;
  label: string;
  patch?: Partial<SearchQuery>;
  categories?: { id: string; name: string }[];
}

export interface SearchResponse {
  searchId: string;
  query: SearchQuery;
  queryLabel: { product: string; region: string; supplierType: string; volume: string | null; certificate: string };
  activeFilters: { key: string; label: string }[];
  total: number;
  results: SupplierSummary[];
  dataDate: string | null;
  sources: SourceStatus[];
  warnings: string[];
  empty: null | { reason: 'product_not_recognized' | 'no_results'; message: string; actions: EmptyAction[] };
  demo: boolean;
  dataSources: OpenDataImport[];
}

export interface OpenDataImport {
  dataset: string;
  source: string;
  title: string;
  dataDate: string;
  rowsMatched: number;
}

export interface SourceRef {
  source: string;
  name: string;
  url: string | null;
  checkedAt: string | null;
  sourceType: 'OFFICIAL' | 'MANUAL_TEST_DATA';
  isOfficial: boolean;
  fields: string[];
  status: string;
}

export interface SupplierCard {
  summary: SupplierSummary;
  general: {
    name: string;
    inn: string;
    ogrn: string;
    kpp: string | null;
    entityType: 'LEGAL_ENTITY' | 'IP';
    legalStatus: SupplierSummary['legalStatus'];
    registrationDate: Fact<string | null>;
    region: string;
    address: Fact<string | null>;
    director: Fact<string | null>;
    checkedAt: string;
  };
  activity: {
    okvedMain: Fact<{ code: string; name: string } | null>;
    okvedAdditional: Fact<{ code: string; name: string }[]>;
    matchesQuery: boolean;
    note: string;
  };
  sme: { status: Fact<string> & { label: string }; includedAt: Fact<string | null> };
  products: {
    title: string;
    categoryName: string;
    brand: string | null;
    model: string | null;
    okpd2: string | null;
    characteristics: Record<string, string>;
    gispRecordNumber: string | null;
    pp719RecordNumber: string | null;
    russianOriginConfirmed: boolean;
    matchesQuery: boolean;
    provenance: Provenance | null;
  }[];
  documents: DocumentDto[];
  transparency: { employees: Fact<string | null>; taxRegime: Fact<string | null>; taxDebt: Fact<string | null> } | null;
  risks: RiskDto[];
  riskSourcesChecked: { source: string; name: string; status: string }[];
  requirements: { categoryName: string; documents: { title: string; hint: string }[]; sourceName: string; sourceUrl: string } | null;
  contacts: { website: string | null; phone: string | null; email: string | null; isManualTestData: boolean };
  sources: SourceRef[];
  externalLinks: { source: string; name: string; url: string }[];
  limitations: string[];
  discrepancies: string[];
  sourceStatuses: SourceStatus[];
  financialsAvailable: boolean;
  saved: { note: string | null } | null;
}

export interface Financials {
  status: 'ok' | 'not_found' | 'unavailable';
  message: string | null;
  periods: { year: number; unit: 'RUB' | 'THOUSAND_RUB'; revenue: number | null; expenses: number | null; assets: number | null; profit: number | null; liabilities: number | null; capital: number | null; provenance: Provenance }[];
  link: string | null;
}

export type CompareSupplier = SupplierSummary & { okvedMain: { code: string; name: string } | null; okvedMatch: boolean; sources: string[] };

export interface CompareResponse {
  suppliers: CompareSupplier[];
  sources: SourceStatus[];
  warnings: string[];
}

export interface Catalog {
  version: string;
  vertical: string;
  pilotRegions: string[];
  units: { id: string; short: string; name: string }[];
  regions: { code: string; name: string; neighbors: string[] }[];
  categories: { id: string; name: string; icon: string; industrial: boolean; defaultUnit: string; products: { id: string; name: string }[] }[];
}

export interface SessionInfo {
  user: { id: string | null; firstName: string | null; demo: boolean };
  launch: null | { type: 'search'; query: SearchQuery; expiresAt: string } | { type: 'search_expired' } | { type: 'selection'; id: string };
  botUsername: string | null;
  data: { mode: 'real' | 'test' | 'all'; imports: OpenDataImport[] };
  demoData: boolean;
  catalogVersion: string;
}

export interface SelectionItem {
  id: string;
  title: string;
  note: string | null;
  createdAt: string;
  lastCheckedAt: string | null;
  query: SearchQuery;
  queryLabel: SearchResponse['queryLabel'];
  supplierCount: number;
  supplierIds: string[];
}

export interface SavedSupplierItem {
  id: string;
  supplierId: string;
  note: string | null;
  createdAt: string;
  name: string;
  inn: string;
  region: string;
  city: string | null;
  supplierType: SupplierType;
  checkedAt: string;
}

export interface HistoryItem {
  query: SearchQuery;
  queryLabel: SearchResponse['queryLabel'];
  resultsCount: number;
  createdAt: string;
}

export const EMPTY_QUERY: SearchQuery = {
  text: '',
  productId: null,
  categoryId: null,
  regionCode: null,
  strictRegion: false,
  supplierType: 'ANY',
  volume: null,
  certificate: 'PREFERRED',
  russianOnly: false,
};
