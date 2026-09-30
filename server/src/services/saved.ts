import type { Db } from '../infra/db';
import type { SearchQuery } from '../domain/types';

export const MAX_SELECTIONS_PER_USER = 50;
export const MAX_SAVED_SUPPLIERS_PER_USER = 200;

export class LimitError extends Error {}

export interface SelectionListItem {
  id: string;
  title: string;
  note: string | null;
  createdAt: string;
  lastCheckedAt: string | null;
  query: SearchQuery;
  supplierCount: number;
  supplierIds: string[];
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));

/** Сохранение по MAX ID: поставщики, подборки, поисковые запросы и заметки. Без личного кабинета. */
export class SavedService {
  constructor(private readonly db: Db) {}

  async listSelections(userId: string): Promise<SelectionListItem[]> {
    const { rows } = await this.db.query(
      `SELECT s.id, s.title, s.note, s.created_at, s.last_checked_at, s.query,
              COALESCE(array_agg(i.supplier_id ORDER BY i.position) FILTER (WHERE i.supplier_id IS NOT NULL), '{}') AS supplier_ids
         FROM saved_selections s LEFT JOIN saved_selection_items i ON i.selection_id = s.id
        WHERE s.max_user_id = $1
        GROUP BY s.id ORDER BY s.created_at DESC LIMIT 100`,
      [userId],
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      note: r.note,
      createdAt: iso(r.created_at)!,
      lastCheckedAt: iso(r.last_checked_at),
      query: r.query,
      supplierIds: r.supplier_ids,
      supplierCount: r.supplier_ids.length,
    }));
  }

  async getSelection(userId: string, id: string): Promise<SelectionListItem | null> {
    const all = await this.listSelections(userId);
    return all.find((s) => s.id === id) ?? null;
  }

  async createSelection(userId: string, input: { title: string; query: SearchQuery; supplierIds: string[]; note?: string | null }): Promise<string> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const { rows: cnt } = await client.query<{ n: string }>('SELECT count(*) AS n FROM saved_selections WHERE max_user_id = $1', [userId]);
      if (Number(cnt[0].n) >= MAX_SELECTIONS_PER_USER) throw new LimitError(`Можно сохранить не больше ${MAX_SELECTIONS_PER_USER} подборок. Удалите ненужные.`);
      const { rows } = await client.query<{ id: string }>(
        'INSERT INTO saved_selections (max_user_id, title, query, note, last_checked_at) VALUES ($1, $2, $3, $4, now()) RETURNING id',
        [userId, input.title.slice(0, 120), JSON.stringify(input.query), input.note?.slice(0, 1000) ?? null],
      );
      const id = rows[0].id;
      const unique = [...new Set(input.supplierIds)].slice(0, 10);
      for (let i = 0; i < unique.length; i++) {
        await client.query(
          `INSERT INTO saved_selection_items (selection_id, supplier_id, position)
           SELECT $1, id, $3 FROM suppliers WHERE id = $2::uuid ON CONFLICT DO NOTHING`,
          [id, unique[i], i],
        );
      }
      await client.query('COMMIT');
      return id;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async updateSelection(userId: string, id: string, patch: { title?: string; note?: string | null }): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE saved_selections SET title = COALESCE($3, title), note = CASE WHEN $4::boolean THEN $5 ELSE note END, updated_at = now()
        WHERE id = $1 AND max_user_id = $2`,
      [id, userId, patch.title?.slice(0, 120) ?? null, patch.note !== undefined, patch.note?.slice(0, 1000) ?? null],
    );
    return (rowCount ?? 0) > 0;
  }

  async touchSelection(id: string): Promise<void> {
    await this.db.query('UPDATE saved_selections SET last_checked_at = now() WHERE id = $1', [id]);
  }

  async deleteSelection(userId: string, id: string): Promise<boolean> {
    const { rowCount } = await this.db.query('DELETE FROM saved_selections WHERE id = $1 AND max_user_id = $2', [id, userId]);
    return (rowCount ?? 0) > 0;
  }

  async listSuppliers(userId: string) {
    const { rows } = await this.db.query(
      `SELECT ss.id, ss.supplier_id, ss.note, ss.query, ss.created_at, s.name, s.inn, s.region_name, s.city, s.supplier_type, s.checked_at
         FROM saved_suppliers ss JOIN suppliers s ON s.id = ss.supplier_id
        WHERE ss.max_user_id = $1 ORDER BY ss.created_at DESC LIMIT 200`,
      [userId],
    );
    return rows.map((r) => ({
      id: r.id,
      supplierId: r.supplier_id,
      note: r.note,
      query: r.query,
      createdAt: iso(r.created_at),
      name: r.name,
      inn: r.inn,
      region: r.region_name,
      city: r.city,
      supplierType: r.supplier_type,
      checkedAt: iso(r.checked_at),
    }));
  }

  async saveSupplier(userId: string, supplierId: string, input: { note?: string | null; query?: SearchQuery | null }): Promise<void> {
    const { rows } = await this.db.query<{ n: string }>('SELECT count(*) AS n FROM saved_suppliers WHERE max_user_id = $1', [userId]);
    if (Number(rows[0].n) >= MAX_SAVED_SUPPLIERS_PER_USER) throw new LimitError('Достигнут лимит сохранённых поставщиков.');
    await this.db.query(
      `INSERT INTO saved_suppliers (max_user_id, supplier_id, note, query)
       VALUES ($1, $2::uuid, $3, $4)
       ON CONFLICT (max_user_id, supplier_id) DO UPDATE SET note = COALESCE(EXCLUDED.note, saved_suppliers.note), updated_at = now()`,
      [userId, supplierId, input.note?.slice(0, 1000) ?? null, input.query ? JSON.stringify(input.query) : null],
    );
  }

  async updateSupplierNote(userId: string, supplierId: string, note: string | null): Promise<boolean> {
    const { rowCount } = await this.db.query('UPDATE saved_suppliers SET note = $3, updated_at = now() WHERE max_user_id = $1 AND supplier_id = $2::uuid', [
      userId,
      supplierId,
      note?.slice(0, 1000) ?? null,
    ]);
    return (rowCount ?? 0) > 0;
  }

  async removeSupplier(userId: string, supplierId: string): Promise<boolean> {
    const { rowCount } = await this.db.query('DELETE FROM saved_suppliers WHERE max_user_id = $1 AND supplier_id = $2::uuid', [userId, supplierId]);
    return (rowCount ?? 0) > 0;
  }

  async recentSearches(userId: string, limit = 5): Promise<{ query: SearchQuery; resultsCount: number; createdAt: string }[]> {
    const { rows } = await this.db.query(
      `SELECT DISTINCT ON (query->>'categoryId', query->>'productId', query->>'regionCode') query, results_count, created_at
         FROM search_history WHERE max_user_id = $1
        ORDER BY query->>'categoryId', query->>'productId', query->>'regionCode', created_at DESC`,
      [userId],
    );
    return rows
      .map((r) => ({ query: r.query, resultsCount: r.results_count, createdAt: iso(r.created_at)! }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
}
