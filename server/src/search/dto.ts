import type { Fact, LegalStatus, Provenance, SearchQuery, SmeStatus, SupplierType } from '../domain/types';
import type { SourceStatus } from '../sources/registry';
import type { ProductMatchLevel, Reason, RegionMatch } from './model';

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
  regionMatch: RegionMatch;
  product: { titles: string[]; match: ProductMatchLevel };
  legalStatus: Fact<LegalStatus> & { label: string; refreshed: boolean };
  sme: Fact<SmeStatus> & { label: string; refreshed: boolean };
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
  /** Источники без разрешённого доступа для этой компании (ЕГРЮЛ, ГИСП, Росаккредитация, РНП…). */
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
  /** Загруженные наборы официальных открытых данных и их даты. */
  dataSources: { dataset: string; source: string; title: string; dataDate: string; rowsMatched: number }[];
}

export interface SourceRefDto {
  source: string;
  name: string;
  url: string | null;
  checkedAt: string | null;
  sourceType: 'OFFICIAL' | 'MANUAL_TEST_DATA';
  isOfficial: boolean;
  fields: string[];
  status: 'ok' | 'failed' | 'not_configured' | 'link_only';
}

export interface SupplierCardDto {
  summary: SupplierSummary;
  general: {
    name: string;
    inn: string;
    ogrn: string;
    kpp: string | null;
    entityType: 'LEGAL_ENTITY' | 'IP';
    legalStatus: Fact<LegalStatus> & { label: string; refreshed: boolean };
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
  sme: { status: Fact<SmeStatus> & { label: string }; includedAt: Fact<string | null> };
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
  sources: SourceRefDto[];
  externalLinks: { source: string; name: string; url: string }[];
  limitations: string[];
  discrepancies: string[];
  sourceStatuses: SourceStatus[];
  financialsAvailable: boolean;
}

export interface FinancialsDto {
  status: 'ok' | 'not_found' | 'unavailable';
  message: string | null;
  periods: {
    year: number;
    /** RUB — открытые данные ФНС (рубли), THOUSAND_RUB — бухотчётность (тыс. руб.). */
    unit: 'RUB' | 'THOUSAND_RUB';
    revenue: number | null;
    expenses: number | null;
    assets: number | null;
    profit: number | null;
    liabilities: number | null;
    capital: number | null;
    provenance: Provenance;
  }[];
  link: string | null;
}
