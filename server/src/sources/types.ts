export type SourceId =
  | 'FNS_EGRUL'
  | 'FNS_PB'
  | 'SME_REGISTRY'
  | 'GIR_BO'
  | 'GISP'
  | 'GISP_PP719'
  | 'FSA_CERT'
  | 'FSA_DECL'
  | 'FAS_RNP'
  | 'FEDRESURS'
  | 'KND';

/**
 * snapshot — локальный снимок в PostgreSQL: импортированные официальные открытые данные и ручная тестовая база;
 * official — официальный API/выгрузка (нужны договор, ключ или JWT);
 * link_only — автоматизированного доступа нет, показываем только ссылку на источник.
 */
export type SourceMode = 'snapshot' | 'official' | 'link_only';

export type HealthState = 'UP' | 'DEGRADED' | 'DOWN' | 'NOT_CONFIGURED';

export interface HealthStatus {
  state: HealthState;
  mode: SourceMode;
  checkedAt: string;
  details?: string;
}

export interface FreshnessPolicy {
  /** Сколько держать ответ в кэше. */
  ttlSeconds: number;
  /** Через сколько после checked_at запись считается устаревшей. */
  staleAfterSeconds: number;
}

export interface SourceAdapter<TQuery, TResult> {
  readonly id: SourceId;
  readonly name: string;
  readonly mode: SourceMode;
  search(query: TQuery): Promise<TResult>;
  healthcheck(): Promise<HealthStatus>;
  getFreshnessPolicy(): FreshnessPolicy;
  /** Ссылка на официальный источник для самостоятельной проверки пользователем. */
  externalLink(q: { inn?: string; name?: string }): string | null;
}

export class SourceUnavailableError extends Error {
  constructor(
    readonly sourceId: SourceId,
    message: string,
  ) {
    super(message);
    this.name = 'SourceUnavailableError';
  }
}

export class SourceNotConfiguredError extends Error {
  constructor(
    readonly sourceId: SourceId,
    message: string,
  ) {
    super(message);
    this.name = 'SourceNotConfiguredError';
  }
}

export interface InnQuery {
  inns: string[];
}

export type ByInn<T> = Record<string, T[]>;

// Строки ручной тестовой базы в формате моделей ТЗ (раздел 10)

export interface VerificationRow {
  inn: string;
  field: string;
  value: string;
  source: string;
  source_url: string | null;
  source_type: 'OFFICIAL' | 'MANUAL_TEST_DATA';
  checked_at: string;
  fresh_until: string | null;
  confidence: number;
  is_official: boolean;
  is_manual_test_data: boolean;
  notes: string | null;
}

export interface ProductRow {
  inn: string;
  id: string;
  category_id: string;
  product_id: string | null;
  title: string;
  brand: string | null;
  model: string | null;
  okpd2: string | null;
  origin: 'GISP' | 'MANUAL_TEST_DATA' | 'SME_DECLARED' | 'OKVED';
  gisp_record_number: string | null;
  pp719_record_number: string | null;
  russian_origin_confirmed: boolean;
  characteristics: Record<string, string>;
  source: string;
  source_url: string | null;
  is_manual_test_data: boolean;
  updated_at: string;
}

export interface DocumentRow {
  inn: string;
  id: string;
  product_id: string | null;
  document_type: 'CERTIFICATE' | 'DECLARATION';
  number: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'TERMINATED' | 'ARCHIVED' | 'UNKNOWN';
  manufacturer_inn: string | null;
  manufacturer_name: string | null;
  applicant: string | null;
  product_name: string | null;
  tech_regulation: string | null;
  certification_body: string | null;
  valid_from: string | null;
  valid_to: string | null;
  source: string;
  source_url: string;
  is_manual_test_data: boolean;
  checked_at: string;
}

export interface RiskRow {
  inn: string;
  kind: 'RNP' | 'BANKRUPTCY' | 'BANKRUPTCY_INTENT' | 'UNRELIABLE_INFO';
  title: string;
  details: string | null;
  record_number: string | null;
  published_at: string | null;
  source: string;
  source_url: string;
  is_manual_test_data: boolean;
  checked_at: string;
}

export interface FinancialRow {
  inn: string;
  period_year: number;
  revenue: string | null;
  assets: string | null;
  profit: string | null;
  liabilities: string | null;
  capital: string | null;
  expenses?: string | null;
  unit?: 'RUB' | 'THOUSAND_RUB';
  source: string;
  source_url: string;
  is_manual_test_data: boolean;
  checked_at: string;
}
