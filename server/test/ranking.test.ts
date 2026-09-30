import { describe, expect, it } from 'vitest';
import type { SearchQuery } from '../src/domain/types';
import { deriveFacts } from '../src/search/facts';
import { buildReasons, hardFilter, scoreSupplier, WEIGHTS } from '../src/search/ranking';
import { dedupeSuppliers } from '../src/search/repository';
import { catalog, evidence, NOW, supplier } from './helpers';

const q = (over: Partial<SearchQuery> = {}): SearchQuery => ({
  text: 'строительная краска',
  productId: 'paint_construction',
  categoryId: 'paints',
  regionCode: '50',
  strictRegion: false,
  supplierType: 'ANY',
  volume: null,
  certificate: 'PREFERRED',
  russianOnly: false,
  ...over,
});

const facts = (s = supplier(), ev = evidence(), query = q()) => deriveFacts(s, ev, query, catalog, NOW, true);

describe('ranking', () => {
  it('веса формулы из ТЗ дают в сумме 1', () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it('идеальное совпадение даёт высокий балл, компоненты считаются по формуле', () => {
    const s = supplier();
    const { score, components } = scoreSupplier(s, facts(s), q(), NOW);
    expect(components.productMatch).toBe(1);
    expect(components.regionMatch).toBe(1);
    expect(components.supplierTypeMatch).toBe(1);
    expect(components.legalVerification).toBe(1);
    expect(components.documentMatch).toBe(1);
    expect(components.dataFreshness).toBe(1);
    expect(score).toBeGreaterThan(0.9);
  });

  it('исключает компании с подтверждённым прекращением деятельности', () => {
    const ev = evidence();
    ev.fns!.rows[0].value = 'INACTIVE';
    expect(hardFilter(supplier(), facts(supplier(), ev), q(), catalog).excluded).toBe(true);
  });

  it('исключает дистрибьюторов при фильтре «только производитель»', () => {
    const s = supplier({ supplier_type: 'DISTRIBUTOR' });
    expect(hardFilter(s, facts(s), q({ supplierType: 'MANUFACTURER_ONLY' }), catalog)).toMatchObject({ excluded: true });
    expect(hardFilter(s, facts(s), q({ supplierType: 'MANUFACTURER_OR_DISTRIBUTOR' }), catalog).excluded).toBe(false);
  });

  it('исключает компании вне региона только при строгом фильтре', () => {
    const s = supplier({ region_code: '71' });
    expect(hardFilter(s, facts(s, evidence(), q({ strictRegion: true })), q({ strictRegion: true }), catalog).excluded).toBe(true);
    const f = facts(s);
    expect(hardFilter(s, f, q(), catalog).excluded).toBe(false);
    expect(f.regionMatch).toBe('neighbor');
  });

  it('при строгом фильтре документов исключает компанию без действующего документа', () => {
    const ev = evidence({ decls: [] });
    expect(hardFilter(supplier(), facts(supplier(), ev), q({ certificate: 'REQUIRED' }), catalog).excluded).toBe(true);
  });

  it('не исключает компанию, если источник документов временно недоступен', () => {
    const ev = evidence({ decls: null, certs: null });
    const f = facts(supplier(), ev);
    expect(f.sourcesFailed).toEqual(expect.arrayContaining(['FSA_DECL', 'FSA_CERT']));
    expect(hardFilter(supplier(), f, q({ certificate: 'REQUIRED' }), catalog).excluded).toBe(false);
  });

  it('не исключает компанию без статуса МСП и без ГИСП', () => {
    const ev = evidence({ sme: [], gisp: [] });
    expect(hardFilter(supplier(), facts(supplier(), ev), q(), catalog).excluded).toBe(false);
  });

  it('при недоступности ФНС показывает последний известный статус с отметкой', () => {
    const f = facts(supplier(), evidence({ fns: null }));
    expect(f.legalStatus.refreshed).toBe(false);
    expect(f.legalStatus.provenance?.stale).toBe(true);
    const reasons = buildReasons(supplier(), f, q(), catalog);
    expect(reasons.some((r) => r.text.includes('ЕГРЮЛ сейчас недоступен'))).toBe(true);
  });

  it('документ из ручной базы не считается официально проверенным', () => {
    const f = facts();
    expect(f.documents[0].isActive).toBe(true);
    expect(f.documents[0].isOfficiallyVerified).toBe(false);
    const strict = deriveFacts(supplier(), evidence(), q(), catalog, NOW, false);
    expect(strict.documents[0].countsAsActive).toBe(false);
  });

  it('просроченный документ не считается действующим', () => {
    const ev = evidence();
    ev.decls![0].valid_to = '2026-05-01';
    const f = facts(supplier(), ev);
    expect(f.documents[0].isActive).toBe(false);
    expect(f.documents[0].statusLabel).toBe('Срок действия истёк');
  });

  it('объяснение выдачи содержит проверяемые факты и оговорку про цену и наличие', () => {
    const texts = buildReasons(supplier(), facts(), q(), catalog).map((r) => r.text);
    expect(texts).toEqual(expect.arrayContaining(['подходит регион', 'тип поставщика: производитель', 'есть профильный ОКВЭД']));
    expect(texts.at(-1)).toBe('минимальная партия, цена и наличие не подтверждены');
    expect(texts.join(' ')).not.toMatch(/надёжн|ненадёжн/);
  });

  it('тип поставщика «не определён» при наличии только ОКВЭД', () => {
    const s = supplier({ supplier_type: 'UNKNOWN' });
    const reasons = buildReasons(s, facts(s), q(), catalog);
    expect(reasons.some((r) => r.kind === 'warn' && r.text.includes('одного ОКВЭД недостаточно'))).toBe(true);
  });

  it('дедуплицирует компании по ИНН и ОГРН', () => {
    const a = supplier();
    const b = supplier({ id: 'x', name: 'Дубль' });
    const c = supplier({ id: 'y', inn: '0099999999', ogrn: a.ogrn });
    expect(dedupeSuppliers([a, b, c])).toHaveLength(1);
  });
});
