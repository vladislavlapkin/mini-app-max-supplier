import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATA_DIR, catalog } from './helpers';

const seed = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'suppliers.json'), 'utf8'));
const suppliers: Record<string, any>[] = seed.suppliers;

function innValid(inn: string): boolean {
  const d = inn.split('').map(Number);
  const c = (w: number[]) => (w.reduce((a, k, i) => a + k * d[i], 0) % 11) % 10;
  if (inn.length === 10) return c([2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9];
  if (inn.length === 12) return c([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10] && c([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11];
  return false;
}

function ogrnValid(ogrn: string): boolean {
  const mod = ogrn.length === 15 ? 13n : 11n;
  return String((BigInt(ogrn.slice(0, -1)) % mod) % 10n) === ogrn.at(-1);
}

describe('ручная тестовая база', () => {
  it('содержит 50–100 поставщиков', () => {
    expect(suppliers.length).toBeGreaterThanOrEqual(50);
    expect(suppliers.length).toBeLessThanOrEqual(100);
  });

  it('ИНН и ОГРН с корректными контрольными цифрами и несуществующим кодом региона 00', () => {
    for (const s of suppliers) {
      expect(s.inn.startsWith('00'), s.name).toBe(true);
      expect(innValid(s.inn), `${s.name} ИНН ${s.inn}`).toBe(true);
      expect(ogrnValid(s.ogrn), `${s.name} ОГРН ${s.ogrn}`).toBe(true);
    }
  });

  it('ИНН и ОГРН уникальны', () => {
    expect(new Set(suppliers.map((s) => s.inn)).size).toBe(suppliers.length);
    expect(new Set(suppliers.map((s) => s.ogrn)).size).toBe(suppliers.length);
  });

  it('у каждой записи указаны источник и дата проверки', () => {
    for (const s of suppliers) {
      expect(s.checked_at).toMatch(/^2026-/);
      for (const v of s.verifications) {
        expect(v.source).toBeTruthy();
        expect(v.checked_at).toBeTruthy();
      }
      for (const d of s.documents) expect(d.source_url).toMatch(/^https:\/\//);
    }
  });

  it('статус производителя имеет основание не только по ОКВЭД', () => {
    for (const s of suppliers.filter((x) => x.supplier_type === 'MANUFACTURER')) {
      expect(s.supplier_type_basis, s.name).toMatch(/декларации|сертификате|ГИСП/);
    }
  });

  it('товары ссылаются на существующие позиции справочника', () => {
    for (const s of suppliers) for (const p of s.products) expect(catalog.product(p.product_id), `${s.name}: ${p.product_id}`).toBeTruthy();
  });

  it('покрывает пилотные регионы', () => {
    const regions = new Set(suppliers.map((s) => s.region_code));
    for (const code of catalog.data.pilotRegions) expect(regions.has(code)).toBe(true);
  });
});
