import { describe, expect, it } from 'vitest';
import { matchProduct, matchRegion, matchVolume, parseQuery, toSearchQuery } from '../src/parser/queryParser';
import { stem } from '../src/catalog/text';
import { catalog } from './helpers';

describe('queryParser', () => {
  it('разбирает пример из ТЗ одним сообщением', () => {
    const p = parseQuery('Нужен производитель строительной краски в Московской области, оптом, до 2 тонн.', catalog);
    expect(p.product?.productId).toBe('paint_construction');
    expect(p.product?.confidence).toBeGreaterThanOrEqual(0.9);
    expect(p.region?.code).toBe('50');
    expect(p.volume).toEqual({ value: 2, unit: 't', operator: 'lte' });
    expect(p.supplierType).toBe('MANUFACTURER_ONLY');
    // «производитель» неоднозначен — как в примере ТЗ, бот уточнит «Ищем только производителя?»
    expect(p.supplierTypeConfidence).toBeLessThan(0.8);
    expect(p.wholesale).toBe(true);
    expect(p.missing).toEqual(['supplier_type', 'certificate_requirement']);
  });

  it('явное «только от производителя» не требует уточнения', () => {
    const p = parseQuery('анкеры только от производителя', catalog);
    expect(p.supplierType).toBe('MANUFACTURER_ONLY');
    expect(p.missing).not.toContain('supplier_type');
  });

  it('не требует ОКВЭД и отрасль пользователя, отмечает недостающие параметры', () => {
    const p = parseQuery('саморезы', catalog);
    expect(p.product?.productId).toBe('screws');
    expect(p.missing).toContain('region');
    expect(p.missing).toContain('supplier_type');
    expect(p.missing).not.toContain('product');
  });

  it('различает Москву и Московскую область', () => {
    expect(matchRegion('краска в Москве', catalog)?.code).toBe('77');
    expect(matchRegion('краска в Московской области', catalog)?.code).toBe('50');
    expect(matchRegion('по всей России', catalog)?.code).toBe('RU');
    expect(matchRegion('город Тула', catalog)?.code).toBe('71');
  });

  it('распознаёт объём с разными единицами и операторами', () => {
    expect(matchVolume('от 500 кг', catalog)).toEqual({ value: 500, unit: 'kg', operator: 'gte' });
    expect(matchVolume('нужно 100 м2 утеплителя', catalog)).toEqual({ value: 100, unit: 'm2', operator: 'eq' });
    expect(matchVolume('до 1,5 т', catalog)).toEqual({ value: 1.5, unit: 't', operator: 'lte' });
    expect(matchVolume('краска белая', catalog)).toBeNull();
  });

  it('распознаёт тип поставщика', () => {
    expect(parseQuery('производителя или дистрибьютора монтажной пены', catalog).supplierType).toBe('MANUFACTURER_OR_DISTRIBUTOR');
    expect(parseQuery('любой поставщик минваты', catalog).supplierType).toBe('ANY');
  });

  it('понимает падежи и опечатки как вспомогательный механизм', () => {
    expect(matchProduct('ищу анкеров', catalog)[0]?.productId).toBe('anchors');
    expect(matchProduct('монтажную пену', catalog)[0]?.productId).toBe('mounting_foam');
    expect(matchProduct('шпаклёвку финишную', catalog)[0]?.productId).toBe('putty');
    const typo = matchProduct('штукатрка', catalog)[0];
    expect(typo?.productId).toBe('plaster');
    expect(typo!.confidence).toBeLessThan(0.7);
  });

  it('категория без конкретного товара распознаётся с уверенностью ниже товара', () => {
    const m = matchProduct('сухие смеси', catalog)[0];
    expect(m.categoryId).toBe('dry_mixes');
    expect(m.productId).toBeNull();
  });

  it('незнакомый товар не распознаётся', () => {
    const p = parseQuery('нужны пластиковые окна', catalog);
    expect(p.product).toBeNull();
    expect(p.missing).toContain('product');
  });

  it('формирует итоговый поисковый запрос для mini-app', () => {
    const q = toSearchQuery(parseQuery('фасадная краска в Туле с сертификатом', catalog));
    expect(q).toMatchObject({ productId: 'paint_facade', categoryId: 'paints', regionCode: '71', certificate: 'REQUIRED', supplierType: 'ANY' });
  });

  it('стеммер сводит формы слова к одной основе', () => {
    expect(stem('краски')).toBe(stem('краской'));
    expect(stem('саморезов')).toBe(stem('саморезы'));
  });
});
