import type { Db } from '../infra/db';
import type { ByInn, DocumentRow, FinancialRow, ProductRow, RiskRow, VerificationRow } from './types';

function group<T extends { inn: string }>(rows: T[]): ByInn<T> {
  const out: ByInn<T> = {};
  for (const r of rows) (out[r.inn] ??= []).push(r);
  return out;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));
const dateOnly = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v as string | null));

/**
 * Доступ к ручной тестовой базе (MANUAL_TEST_DATA).
 * Адаптеры источников в режиме test_data читают только «свои» записи по полю source.
 */
export class TestDataStore {
  constructor(private readonly db: Db) {}

  async ping(): Promise<void> {
    await this.db.query('SELECT 1');
  }

  async verifications(inns: string[], sources: string[]): Promise<ByInn<VerificationRow>> {
    if (!inns.length) return {};
    const { rows } = await this.db.query(
      `SELECT s.inn, v.field, v.value, v.source, v.source_url, v.source_type, v.checked_at, v.fresh_until,
              v.confidence::float AS confidence, v.is_official, v.is_manual_test_data, v.notes
         FROM verification_records v JOIN suppliers s ON s.id = v.supplier_id
        WHERE s.inn = ANY($1) AND v.source = ANY($2)`,
      [inns, sources],
    );
    return group(rows.map((r) => ({ ...r, checked_at: iso(r.checked_at)!, fresh_until: iso(r.fresh_until) })) as VerificationRow[]);
  }

  async products(inns: string[], opts: { gispOnly?: boolean; pp719Only?: boolean } = {}): Promise<ByInn<ProductRow>> {
    if (!inns.length) return {};
    const cond = [opts.gispOnly ? `p.origin = 'GISP'` : 'true', opts.pp719Only ? 'p.pp719_record_number IS NOT NULL' : 'true'].join(' AND ');
    const { rows } = await this.db.query(
      `SELECT s.inn, p.id, p.category_id, p.product_id, p.title, p.brand, p.model, p.okpd2, p.origin, p.gisp_record_number,
              p.pp719_record_number, p.russian_origin_confirmed, p.characteristics, p.source, p.source_url, p.is_manual_test_data, p.updated_at
         FROM product_records p JOIN suppliers s ON s.id = p.supplier_id
        WHERE s.inn = ANY($1) AND ${cond}`,
      [inns],
    );
    return group(rows.map((r) => ({ ...r, updated_at: iso(r.updated_at)! })) as ProductRow[]);
  }

  async documents(inns: string[], type: 'CERTIFICATE' | 'DECLARATION'): Promise<ByInn<DocumentRow>> {
    if (!inns.length) return {};
    const { rows } = await this.db.query(
      `SELECT s.inn, d.id, d.product_id, d.document_type, d.number, d.status, d.manufacturer_inn, d.manufacturer_name, d.applicant,
              d.product_name, d.tech_regulation, d.certification_body, d.valid_from, d.valid_to, d.source, d.source_url,
              d.is_manual_test_data, d.checked_at
         FROM compliance_documents d JOIN suppliers s ON s.id = d.supplier_id
        WHERE s.inn = ANY($1) AND d.document_type = $2`,
      [inns, type],
    );
    return group(
      rows.map((r) => ({ ...r, valid_from: dateOnly(r.valid_from), valid_to: dateOnly(r.valid_to), checked_at: iso(r.checked_at)! })) as DocumentRow[],
    );
  }

  async risks(inns: string[], sources: string[]): Promise<ByInn<RiskRow>> {
    if (!inns.length) return {};
    const { rows } = await this.db.query(
      `SELECT s.inn, r.kind, r.title, r.details, r.record_number, r.published_at, r.source, r.source_url, r.is_manual_test_data, r.checked_at
         FROM risk_signals r JOIN suppliers s ON s.id = r.supplier_id
        WHERE s.inn = ANY($1) AND r.source = ANY($2)`,
      [inns, sources],
    );
    return group(rows.map((r) => ({ ...r, published_at: dateOnly(r.published_at), checked_at: iso(r.checked_at)! })) as RiskRow[]);
  }

  async financials(inns: string[]): Promise<ByInn<FinancialRow>> {
    if (!inns.length) return {};
    const { rows } = await this.db.query(
      `SELECT s.inn, f.period_year, f.revenue, f.expenses, f.unit, f.assets, f.profit, f.liabilities, f.capital, f.source, f.source_url,
              f.is_manual_test_data, f.checked_at
         FROM financial_reports f JOIN suppliers s ON s.id = f.supplier_id
        WHERE s.inn = ANY($1) ORDER BY f.period_year DESC`,
      [inns],
    );
    return group(rows.map((r) => ({ ...r, checked_at: iso(r.checked_at)! })) as FinancialRow[]);
  }
}
