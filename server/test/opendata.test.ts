import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { categoriesForOkved, prettyName, productsForOkpd2, titleCase } from '../src/opendata/classify';
import { parseRsmpDoc, supplierType } from '../src/opendata/importer';
import { parseAttrs, streamElements, tagAttrs } from '../src/opendata/xmlStream';
import { catalog } from './helpers';

// Фрагменты в формате реального набора ФНС 7707329152-rsmp (структура 12.05.2026)
const PAINT_ORG = `<Документ ИдДок="1" ДатаСост="10.09.2026" ДатаВклМСП="10.08.2016" ВидСубМСП="1" КатСубМСП="2" ПризНовМСП="2" СведСоцПред="2">
<ОргВклМСП НаимОрг="АКЦИОНЕРНОЕ ОБЩЕСТВО &quot;ТЕСТХИМ&quot;" НаимОргСокр="АО &quot;ТЕСТХИМ&quot;" ИННЮЛ="5031000000"/>
<СведМН КодРегион="50"><Регион Тип="область" Наим="Московская"/><Город Тип="г." Наим="СТАРАЯ КУПАВНА"/></СведМН>
<СвОКВЭД><СвОКВЭДОсн КодОКВЭД="20.30.2" НаимОКВЭД="Производство прочих красок, лаков, эмалей" ВерсОКВЭД="2014"/>
<СвОКВЭДДоп КодОКВЭД="46.75" НаимОКВЭД="Торговля оптовая химическими продуктами" ВерсОКВЭД="2014"/></СвОКВЭД></Документ>`;

const AD_AGENCY_IP = `<Документ ИдДок="2" ДатаСост="10.09.2026" ДатаВклМСП="10.02.2018" ВидСубМСП="2" КатСубМСП="1"><ИПВклМСП ИННФЛ="253910730844" ОГРНИП="318253600000105"><ФИОИП Фамилия="ИВАНОВА" Имя="ОЛЬГА" Отчество="ПЕТРОВНА"/></ИПВклМСП><СведМН КодРегион="25"><Регион Тип="край" Наим="Приморский"/></СведМН><СвОКВЭД><СвОКВЭДОсн КодОКВЭД="73.11" НаимОКВЭД="Деятельность рекламных агентств" ВерсОКВЭД="2014"/></СвОКВЭД></Документ>`;

const DECLARED = `<Документ ИдДок="3" ДатаСост="10.09.2026" ДатаВклМСП="10.08.2019" ВидСубМСП="1" КатСубМСП="1"><ОргВклМСП НаимОрг="ООО &quot;КРЕП&quot;" НаимОргСокр="ООО &quot;КРЕП&quot;" ИННЮЛ="7100000000"/><СведМН КодРегион="71"/><СвОКВЭД><СвОКВЭДОсн КодОКВЭД="46.74" НаимОКВЭД="Торговля оптовая скобяными изделиями" ВерсОКВЭД="2014"/></СвОКВЭД><СвПрод КодПрод="25.94.11.110" НаимПрод="Болты и винты из черных металлов" ПрОтнПрод="0"/></Документ>`;

const INSULATION_WIDE = `<Документ ИдДок="4" ДатаСост="10.09.2026" КатСубМСП="3"><ОргВклМСП НаимОрг="ООО &quot;МИН&quot;" ИННЮЛ="5000000001"/><СведМН КодРегион="50"/><СвОКВЭД><СвОКВЭДОсн КодОКВЭД="23.99" НаимОКВЭД="Производство прочей неметаллической минеральной продукции, не включенной в другие группировки"/></СвОКВЭД></Документ>`;

describe('xml', () => {
  it('разбирает атрибуты и сущности', () => {
    expect(parseAttrs(' НаимОрг="ООО &quot;А&amp;Б&quot;" ИННЮЛ="1"')).toEqual({ НаимОрг: 'ООО "А&Б"', ИННЮЛ: '1' });
    expect(tagAttrs(PAINT_ORG, 'СвОКВЭДОсн')?.КодОКВЭД).toBe('20.30.2');
    expect(tagAttrs(PAINT_ORG, 'СвОКВЭД')).toEqual({});
  });

  it('потоково выделяет документы, разрезанные по границам чанков', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><Файл>${PAINT_ORG}${AD_AGENCY_IP}${DECLARED}</Файл>`;
    const buf = Buffer.from(xml, 'utf8');
    const chunks = [buf.subarray(0, 37), buf.subarray(37, 500), buf.subarray(500)];
    const docs: string[] = [];
    const n = await streamElements(Readable.from(chunks), 'Документ', (d) => {
      docs.push(d);
    });
    expect(n).toBe(3);
    expect(docs[1]).toContain('ИННФЛ="253910730844"');
  });
});

describe('реестр МСП → поставщики', () => {
  it('производитель красок по основному ОКВЭД попадает в категорию, но тип не определён', () => {
    const c = parseRsmpDoc(PAINT_ORG, catalog, null)!;
    expect(c).toMatchObject({ inn: '5031000000', name: 'АО «ТЕСТХИМ»', entityType: 'LEGAL_ENTITY', sme: 'SMALL', regionCode: '50', regionName: 'Московская область', city: 'Старая Купавна' });
    expect(c.categories).toEqual(['paints']);
    expect(supplierType(c).type).toBe('UNKNOWN');
    expect(supplierType(c).basis).toContain('Одного ОКВЭД недостаточно');
  });

  it('компании вне товарной вертикали отбрасываются', () => {
    expect(parseRsmpDoc(AD_AGENCY_IP, catalog, null)).toBeNull();
  });

  it('заявленная продукция (ОКПД2) даёт совпадение по товару и статус «производитель по заявлению»', () => {
    const c = parseRsmpDoc(DECLARED, catalog, null)!;
    expect(c.categories).toEqual(['fasteners']);
    expect(c.products.map((p) => p.productId)).toEqual(expect.arrayContaining(['screws', 'bolts_nuts', 'anchors']));
    const t = supplierType(c);
    expect(t.type).toBe('MANUFACTURER');
    expect(t.basis).toContain('заявлены самой компанией');
  });

  it('широкий ОКВЭД 23.99 без уточнения в названии не относится к категории', () => {
    expect(parseRsmpDoc(INSULATION_WIDE, catalog, null)).toBeNull();
  });

  it('фильтр регионов', () => {
    expect(parseRsmpDoc(PAINT_ORG, catalog, new Set(['77']))).toBeNull();
    expect(parseRsmpDoc(PAINT_ORG, catalog, new Set(['50']))).not.toBeNull();
  });

  it('классификация ОКВЭД по коду и наименованию', () => {
    expect(categoriesForOkved('23.99.6', 'Производство минеральных тепло- и звукоизоляционных материалов и изделий')).toEqual(['insulation']);
    expect(categoriesForOkved('23.64', 'Производство сухих бетонных смесей')).toEqual(['dry_mixes']);
    expect(categoriesForOkved('25.94', 'Производство крепежных изделий')).toEqual(['fasteners']);
    expect(categoriesForOkved('46.73', 'Торговля оптовая')).toEqual([]);
    expect(productsForOkpd2('20.30.11.120', catalog).map((p) => p.productId)).toEqual(['paint_construction', 'paint_facade', 'paint_interior']);
  });

  it('оформление названий', () => {
    expect(titleCase('ОРЕХОВО-ЗУЕВО')).toBe('Орехово-Зуево');
    expect(prettyName('ООО "ЛАКОКРАСКА"', undefined)).toBe('ООО «ЛАКОКРАСКА»');
    expect(prettyName('ООО "УЗТК "ТЕПЛОКОМПЛЕКТ""', undefined)).toBe('ООО «УЗТК „ТЕПЛОКОМПЛЕКТ“»');
    expect(prettyName('ЗАО"ПОДОЛЬСКИЙ ЗАВОД СТРОЙМАТЕРИАЛОВ"', undefined)).toBe('ЗАО «ПОДОЛЬСКИЙ ЗАВОД СТРОЙМАТЕРИАЛОВ»');
    expect(prettyName('ООО "УЗТК "ТЕПЛОКОМПЛЕКТ"', undefined)).toBe('ООО «УЗТК „ТЕПЛОКОМПЛЕКТ“»');
  });
});
