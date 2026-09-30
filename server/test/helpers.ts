import path from 'node:path';
import pino from 'pino';
import { Catalog } from '../src/catalog/catalog';
import type { Evidence, SupplierRow } from '../src/search/model';

export const DATA_DIR = path.resolve(__dirname, '../../data');
export const catalog = Catalog.load(DATA_DIR);
export const silentLog = pino({ level: 'silent' });
export const NOW = new Date('2026-09-29T12:00:00Z');

/** Минимальная in-memory замена Redis для модульных тестов. */
export class FakeRedis {
  store = new Map<string, string>();
  async get(k: string) {
    return this.store.get(k) ?? null;
  }
  async set(k: string, v: string, ...args: unknown[]) {
    if (args.includes('NX') && this.store.has(k)) return null;
    this.store.set(k, v);
    return 'OK';
  }
  async incr(k: string) {
    const n = Number(this.store.get(k) ?? 0) + 1;
    this.store.set(k, String(n));
    return n;
  }
  async expire() {
    return 1;
  }
}

export function supplier(over: Partial<SupplierRow> = {}): SupplierRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    inn: '0012345678',
    ogrn: '1120012345678',
    kpp: null,
    name: 'ООО «Тест-Краска»',
    entity_type: 'LEGAL_ENTITY',
    legal_status: 'ACTIVE',
    registration_date: '2015-01-01',
    region_code: '50',
    region_name: 'Московская область',
    city: 'Ногинск',
    address: 'Московская область, г. Ногинск',
    okved_main: { code: '20.30', name: 'Производство красок' },
    okved_additional: [],
    director: 'Иванов Иван Иванович',
    sme_status: 'SMALL',
    supplier_type: 'MANUFACTURER',
    supplier_type_confidence: 0.9,
    supplier_type_basis: 'указан изготовителем в декларации',
    website: 'https://test.example',
    phone: '+7 (000) 000-00-00',
    email: null,
    source_type: 'MANUAL_TEST_DATA',
    is_manual_test_data: true,
    checked_at: '2026-09-25T10:00:00Z',
    products: [{ product_id: 'paint_construction', category_id: 'paints', title: 'Строительная краска' }],
    ...over,
  };
}

export function evidence(over: Partial<Evidence> = {}): Evidence {
  const v = (field: string, value: string, source = 'FNS_EGRUL') => ({
    inn: '0012345678',
    field,
    value,
    source,
    source_url: 'https://egrul.nalog.ru/',
    source_type: 'MANUAL_TEST_DATA' as const,
    checked_at: '2026-09-25T10:00:00Z',
    fresh_until: '2026-10-09T10:00:00Z',
    confidence: 0.99,
    is_official: false,
    is_manual_test_data: true,
    notes: null,
  });
  return {
    fns: { rows: [v('legal_status', 'ACTIVE'), v('okved_main', '20.30'), v('region', '50')], risks: [] },
    pb: null,
    sme: [v('sme_status', 'SMALL', 'SME_REGISTRY')],
    gisp: [],
    pp719: [],
    certs: [],
    decls: [
      {
        inn: '0012345678',
        id: 'd1',
        product_id: 'paint_construction',
        document_type: 'DECLARATION',
        number: 'ЕАЭС N RU Д-RU.РА01.В.00001/26',
        status: 'ACTIVE',
        manufacturer_inn: '0012345678',
        manufacturer_name: 'ООО «Тест-Краска»',
        applicant: 'ООО «Тест-Краска»',
        product_name: 'Строительная краска',
        tech_regulation: null,
        certification_body: null,
        valid_from: '2026-01-01',
        valid_to: '2031-01-01',
        source: 'FSA_DECL',
        source_url: 'https://pub.fsa.gov.ru/rds/declaration',
        is_manual_test_data: true,
        checked_at: '2026-09-25T10:00:00Z',
      },
    ],
    rnp: [],
    fedresurs: [],
    manual: [],
    ...over,
  };
}
