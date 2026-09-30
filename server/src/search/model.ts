import type { SupplierType } from '../domain/types';
import type { DocumentRow, ProductRow, RiskRow, VerificationRow } from '../sources/types';

/** Запись поставщика из собственной (ручной) базы — индекс для поиска. */
export interface SupplierRow {
  id: string;
  inn: string;
  ogrn: string;
  kpp: string | null;
  name: string;
  entity_type: 'LEGAL_ENTITY' | 'IP';
  legal_status: 'ACTIVE' | 'INACTIVE' | 'UNKNOWN';
  registration_date: string | null;
  region_code: string;
  region_name: string;
  city: string | null;
  address: string | null;
  okved_main: { code: string; name: string } | null;
  okved_additional: { code: string; name: string }[];
  director: string | null;
  sme_status: string;
  supplier_type: SupplierType;
  supplier_type_confidence: number;
  supplier_type_basis: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  source_type: 'OFFICIAL' | 'MANUAL_TEST_DATA';
  is_manual_test_data: boolean;
  checked_at: string;
  /** Среднесписочная численность (ФНС/реестр МСП) — для полноты профиля. */
  employees?: number | null;
  /** Доходы за последний год по бухотчётности — для полноты профиля. */
  last_revenue?: number | null;
  products: { product_id: string | null; category_id: string; title: string; origin?: string }[];
}

/**
 * Какие источники реально подключены для компании. Для ручной тестовой базы — все,
 * для реальных компаний — только импортированные официальные наборы (ФНС, при наличии — ФАС).
 */
export type Coverage = Set<string> | null;

/** Источники, для которых у реальных компаний нет разрешённого автоматизированного доступа. */
export const OFFICIAL_ONLY_BY_ACCESS = ['FNS_EGRUL', 'GISP', 'GISP_PP719', 'FSA_CERT', 'FSA_DECL', 'FAS_RNP', 'FEDRESURS', 'GIR_BO'];

/** Сведения из адаптеров. null — источник не ответил или не подключён. */
export interface Evidence {
  fns: { rows: VerificationRow[]; risks: RiskRow[] } | null;
  pb: VerificationRow[] | null;
  sme: VerificationRow[] | null;
  gisp: ProductRow[] | null;
  pp719: ProductRow[] | null;
  certs: DocumentRow[] | null;
  decls: DocumentRow[] | null;
  rnp: RiskRow[] | null;
  fedresurs: RiskRow[] | null;
  manual: VerificationRow[];
}

export type RegionMatch = 'same' | 'neighbor' | 'other' | 'any';
export type ProductMatchLevel = 'product' | 'category' | 'none';

export interface Reason {
  kind: 'ok' | 'warn' | 'info';
  text: string;
}
