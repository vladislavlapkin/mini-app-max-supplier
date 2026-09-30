import type { Db } from '../infra/db';
import type { Logger } from '../logger';

export interface AuditField {
  field: string;
  source: string;
  sourceType: string;
  checkedAt: string | null;
}

export interface AuditEntry {
  requestId?: string;
  userHash: string | null;
  supplierId: string;
  context: 'search' | 'card' | 'compare' | 'bot';
  fields: AuditField[];
}

/** Audit trail по каждому показанному полю: что, из какого источника и на какую дату видел пользователь. */
export class AuditService {
  constructor(
    private readonly db: Db,
    private readonly log: Logger,
  ) {}

  record(entries: AuditEntry[]): void {
    if (!entries.length) return;
    const values: unknown[] = [];
    const placeholders = entries.map((e, i) => {
      values.push(e.requestId ?? null, e.userHash, e.supplierId, e.context, JSON.stringify(e.fields));
      const b = i * 5;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`;
    });
    this.db
      .query(`INSERT INTO audit_log (request_id, user_hash, supplier_id, context, fields) VALUES ${placeholders.join(', ')}`, values)
      .catch((err) => this.log.warn({ err: err.message }, 'audit insert failed'));
  }
}
