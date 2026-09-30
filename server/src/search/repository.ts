import type { Db } from '../infra/db';
import type { SupplierRow } from './model';

const SELECT = `
  SELECT s.id, s.inn, s.ogrn, s.kpp, s.name, s.entity_type, s.legal_status, s.registration_date, s.region_code, s.region_name,
         s.city, s.address, s.okved_main, s.okved_additional, s.director, s.sme_status, s.supplier_type,
         s.supplier_type_confidence::float AS supplier_type_confidence, s.supplier_type_basis, s.website, s.phone, s.email,
         s.source_type, s.is_manual_test_data, s.checked_at,
         (SELECT v.value FROM verification_records v WHERE v.supplier_id = s.id AND v.field = 'employees_count' ORDER BY v.checked_at DESC LIMIT 1) AS employees,
         (SELECT f.revenue FROM financial_reports f WHERE f.supplier_id = s.id ORDER BY f.period_year DESC LIMIT 1) AS last_revenue,
         COALESCE((SELECT json_agg(json_build_object('product_id', p.product_id, 'category_id', p.category_id, 'title', p.title, 'origin', p.origin) ORDER BY p.title)
                     FROM product_records p WHERE p.supplier_id = s.id), '[]'::json) AS products
    FROM suppliers s`;

function map(r: Record<string, unknown>): SupplierRow {
  return {
    ...(r as unknown as SupplierRow),
    checked_at: r.checked_at instanceof Date ? r.checked_at.toISOString() : (r.checked_at as string),
    employees: r.employees === null || r.employees === undefined ? null : Number(r.employees),
    last_revenue: r.last_revenue === null || r.last_revenue === undefined ? null : Number(r.last_revenue),
  };
}

/** Дедупликация по ИНН и ОГРН (одна компания — одна запись в выдаче). */
export function dedupeSuppliers(rows: SupplierRow[]): SupplierRow[] {
  const seenInn = new Set<string>();
  const seenOgrn = new Set<string>();
  const out: SupplierRow[] = [];
  for (const r of rows) {
    if (seenInn.has(r.inn) || seenOgrn.has(r.ogrn)) continue;
    seenInn.add(r.inn);
    seenOgrn.add(r.ogrn);
    out.push(r);
  }
  return out;
}

export type DataMode = 'real' | 'test' | 'all';

export interface CandidateOptions {
  categoryId: string;
  productId: string | null;
  dataMode: DataMode;
  regionCode: string | null;
  strictRegion: boolean;
  neighbors: string[];
  manufacturerOnly: boolean;
  limit?: number;
}

export class SupplierRepository {
  constructor(private readonly db: Db) {}

  /**
   * Кандидаты по категории. Дешёвые фильтры и предварительный порядок — в SQL, чтобы по всей России
   * адаптеры опрашивались не для тысяч компаний, а для ограниченного числа лучших совпадений.
   */
  async candidates(o: CandidateOptions): Promise<SupplierRow[]> {
    const region = o.regionCode && o.regionCode !== 'RU' ? o.regionCode : null;
    const { rows } = await this.db.query(
      `${SELECT}
        WHERE s.id IN (SELECT supplier_id FROM product_records WHERE category_id = $1)
          AND ($2 = 'all' OR ($2 = 'real' AND s.source_type = 'OFFICIAL') OR ($2 = 'test' AND s.source_type = 'MANUAL_TEST_DATA'))
          AND ($3::text IS NULL OR NOT $4 OR s.region_code = $3)
          AND (NOT $5 OR s.supplier_type IN ('MANUFACTURER', 'UNKNOWN'))
        ORDER BY (s.region_code = $3) DESC NULLS LAST,
                 (s.region_code = ANY($6::text[])) DESC,
                 EXISTS (SELECT 1 FROM product_records p WHERE p.supplier_id = s.id AND p.product_id = $7) DESC,
                 (s.supplier_type = 'MANUFACTURER') DESC,
                 (s.legal_status = 'ACTIVE') DESC,
                 -- полнота профиля: есть сведения о численности и отчётности
                 ((SELECT (v.value::numeric > 0) FROM verification_records v WHERE v.supplier_id = s.id AND v.field = 'employees_count' AND v.value ~ '^[0-9]+$' ORDER BY v.checked_at DESC LIMIT 1) IS TRUE) DESC,
                 ((SELECT f.revenue > 0 FROM financial_reports f WHERE f.supplier_id = s.id ORDER BY f.period_year DESC LIMIT 1) IS TRUE) DESC,
                 s.name
        LIMIT $8`,
      [o.categoryId, o.dataMode, region, o.strictRegion, o.manufacturerOnly, o.neighbors, o.productId, o.limit ?? 150],
    );
    return dedupeSuppliers(rows.map(map));
  }

  async countByCategory(o: Pick<CandidateOptions, 'categoryId' | 'dataMode' | 'regionCode' | 'strictRegion' | 'manufacturerOnly'>): Promise<number> {
    const region = o.regionCode && o.regionCode !== 'RU' ? o.regionCode : null;
    const { rows } = await this.db.query<{ n: string }>(
      `SELECT count(*) AS n FROM suppliers s
        WHERE s.id IN (SELECT supplier_id FROM product_records WHERE category_id = $1)
          AND ($2 = 'all' OR ($2 = 'real' AND s.source_type = 'OFFICIAL') OR ($2 = 'test' AND s.source_type = 'MANUAL_TEST_DATA'))
          AND ($3::text IS NULL OR NOT $4 OR s.region_code = $3)
          AND (NOT $5 OR s.supplier_type IN ('MANUFACTURER', 'UNKNOWN'))`,
      [o.categoryId, o.dataMode, region, o.strictRegion, o.manufacturerOnly],
    );
    return Number(rows[0].n);
  }

  /** Какие наборы открытых данных загружены и на какую дату. */
  async openDataImports(): Promise<{ dataset: string; source: string; title: string; dataDate: string; rowsMatched: number }[]> {
    const { rows } = await this.db.query(
      `SELECT dataset, source, title, to_char(data_date, 'YYYY-MM-DD') AS data_date, rows_matched FROM opendata_imports ORDER BY dataset`,
    );
    return rows.map((r) => ({ dataset: r.dataset, source: r.source, title: r.title, dataDate: r.data_date, rowsMatched: Number(r.rows_matched) }));
  }

  async byIds(ids: string[]): Promise<SupplierRow[]> {
    if (!ids.length) return [];
    const { rows } = await this.db.query(`${SELECT} WHERE s.id = ANY($1::uuid[])`, [ids]);
    const byId = new Map(rows.map((r) => [r.id as string, map(r)]));
    return ids.map((id) => byId.get(id)).filter((r): r is SupplierRow => !!r);
  }

  async count(): Promise<number> {
    const { rows } = await this.db.query<{ n: string }>('SELECT count(*) AS n FROM suppliers');
    return Number(rows[0].n);
  }
}
