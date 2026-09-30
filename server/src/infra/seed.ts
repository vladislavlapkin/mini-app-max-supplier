import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from '../logger';
import { type Db, withTransaction } from './db';

interface SeedFile {
  generated_at: string;
  suppliers: SeedSupplier[];
}

interface SeedSupplier {
  inn: string;
  ogrn: string;
  kpp: string | null;
  name: string;
  entity_type: string;
  legal_status: string;
  registration_date: string;
  region_code: string;
  region_name: string;
  city: string;
  address: string;
  okved_main: { code: string; name: string };
  okved_additional: { code: string; name: string }[];
  director: string;
  sme_status: string;
  supplier_type: string;
  supplier_type_confidence: number;
  supplier_type_basis: string;
  website: string | null;
  phone: string | null;
  email: string | null;
  checked_at: string;
  products: Record<string, unknown>[];
  documents: Record<string, unknown>[];
  verifications: Record<string, unknown>[];
  risks: Record<string, unknown>[];
  financials: Record<string, unknown>[];
}

/**
 * Загружает ручную тестовую базу (data/suppliers.json) в PostgreSQL.
 * Идемпотентно: поставщик обновляется по ИНН, дочерние записи пересоздаются.
 * Все записи помечаются is_manual_test_data = true и source_type = MANUAL_TEST_DATA.
 */
export async function seedTestData(db: Db, dataDir: string, log: Logger): Promise<number> {
  const file = path.join(dataDir, 'suppliers.json');
  if (!fs.existsSync(file)) {
    log.warn({ file }, 'seed file not found, skipping');
    return 0;
  }
  const seed = JSON.parse(fs.readFileSync(file, 'utf8')) as SeedFile;

  await withTransaction(db, async (c) => {
    for (const s of seed.suppliers) {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO suppliers (inn, ogrn, kpp, name, entity_type, legal_status, registration_date, region_code, region_name, city, address,
           okved_main, okved_additional, director, sme_status, supplier_type, supplier_type_confidence, supplier_type_basis,
           website, phone, email, source_type, is_manual_test_data, checked_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'MANUAL_TEST_DATA',true,$22)
         ON CONFLICT (inn) DO UPDATE SET
           ogrn = EXCLUDED.ogrn, kpp = EXCLUDED.kpp, name = EXCLUDED.name, entity_type = EXCLUDED.entity_type,
           legal_status = EXCLUDED.legal_status, registration_date = EXCLUDED.registration_date, region_code = EXCLUDED.region_code,
           region_name = EXCLUDED.region_name, city = EXCLUDED.city, address = EXCLUDED.address, okved_main = EXCLUDED.okved_main,
           okved_additional = EXCLUDED.okved_additional, director = EXCLUDED.director, sme_status = EXCLUDED.sme_status,
           supplier_type = EXCLUDED.supplier_type, supplier_type_confidence = EXCLUDED.supplier_type_confidence,
           supplier_type_basis = EXCLUDED.supplier_type_basis, website = EXCLUDED.website, phone = EXCLUDED.phone,
           email = EXCLUDED.email, checked_at = EXCLUDED.checked_at, updated_at = now()
         RETURNING id`,
        [
          s.inn, s.ogrn, s.kpp, s.name, s.entity_type, s.legal_status, s.registration_date, s.region_code, s.region_name, s.city,
          s.address, JSON.stringify(s.okved_main), JSON.stringify(s.okved_additional), s.director, s.sme_status, s.supplier_type,
          s.supplier_type_confidence, s.supplier_type_basis, s.website, s.phone, s.email, s.checked_at,
        ],
      );
      const id = rows[0].id;
      for (const table of ['compliance_documents', 'product_records', 'verification_records', 'risk_signals', 'financial_reports']) {
        await c.query(`DELETE FROM ${table} WHERE supplier_id = $1`, [id]);
      }

      const productIds = new Map<string, string>();
      for (const p of s.products) {
        const r = await c.query<{ id: string }>(
          `INSERT INTO product_records (supplier_id, category_id, product_id, title, normalized_category, brand, model, okpd2, origin,
             gisp_record_number, pp719_record_number, russian_origin_confirmed, characteristics, source, source_url, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
          [
            id, p.category_id, p.product_id, p.title, p.category_id, p.brand, p.model, p.okpd2, p.origin, p.gisp_record_number,
            p.pp719_record_number, p.russian_origin_confirmed, JSON.stringify(p.characteristics ?? {}), p.source, p.source_url || null,
            p.updated_at,
          ],
        );
        productIds.set(String(p.product_id), r.rows[0].id);
      }

      for (const d of s.documents) {
        await c.query(
          `INSERT INTO compliance_documents (supplier_id, product_record_id, product_id, document_type, number, status, manufacturer_inn,
             manufacturer_name, applicant, product_name, tech_regulation, certification_body, valid_from, valid_to, source, source_url, checked_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [
            id, d.product_id ? productIds.get(String(d.product_id)) ?? null : null, d.product_id, d.document_type, d.number, d.status,
            d.manufacturer_inn, d.manufacturer_name, d.applicant, d.product_name, d.tech_regulation, d.certification_body, d.valid_from,
            d.valid_to, d.source, d.source_url, d.checked_at,
          ],
        );
      }

      for (const v of s.verifications) {
        await c.query(
          `INSERT INTO verification_records (supplier_id, field, value, source, source_url, source_type, checked_at, fresh_until,
             confidence, is_official, is_manual_test_data, notes)
           VALUES ($1,$2,$3,$4,$5,'MANUAL_TEST_DATA',$6,$7,$8,false,true,$9)`,
          [id, v.field, v.value, v.source, v.source_url || null, v.checked_at, v.fresh_until, v.confidence, v.notes],
        );
      }

      for (const r of s.risks) {
        await c.query(
          `INSERT INTO risk_signals (supplier_id, kind, title, details, record_number, published_at, source, source_url, checked_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [id, r.kind, r.title, r.details, r.record_number, r.published_at, r.source, r.source_url, r.checked_at],
        );
      }

      for (const f of s.financials) {
        await c.query(
          `INSERT INTO financial_reports (supplier_id, period_year, revenue, assets, profit, liabilities, capital, source, source_url, checked_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [id, f.period_year, f.revenue, f.assets, f.profit, f.liabilities, f.capital, f.source, f.source_url, f.checked_at],
        );
      }
    }
  });

  log.info({ suppliers: seed.suppliers.length, generatedAt: seed.generated_at }, 'manual test data seeded');
  return seed.suppliers.length;
}
