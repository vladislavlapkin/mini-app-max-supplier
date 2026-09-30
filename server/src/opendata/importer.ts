import fs from 'node:fs';
import path from 'node:path';
import type { PoolClient } from 'pg';
import { Catalog } from '../catalog/catalog';
import { loadConfig } from '../config';
import type { Db } from '../infra/db';
import type { Logger } from '../logger';
import { categoriesForOkved, okvedMayMatch, prettyName, productsForOkpd2, titleCase } from './classify';
import { FAS_RNP, FNS_DATASETS } from './datasets';
import { downloadFile, latestFromPassport } from './download';
import { allTagAttrs, forEachZipEntry, streamElements, tagAttrs } from './xmlStream';

const SME_CATEGORY: Record<string, string> = { '1': 'MICRO', '2': 'SMALL', '3': 'MEDIUM' };

interface LatestFile {
  file: string;
  dataDate: string;
  url: string;
}

interface Company {
  inn: string;
  ogrn: string | null;
  name: string;
  fullName: string;
  entityType: 'LEGAL_ENTITY' | 'IP';
  sme: string;
  includedAt: string | null;
  employees: number | null;
  regionCode: string;
  regionName: string;
  city: string | null;
  okvedMain: { code: string; name: string };
  okvedAdd: { code: string; name: string }[];
  declared: { code: string; name: string }[];
  categories: string[];
  products: { productId: string; categoryId: string; title: string; code: string }[];
}

/** DD.MM.YYYY → YYYY-MM-DD */
function isoDate(d: string | undefined): string | null {
  const m = d ? /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(d) : null;
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function readLatest(dir: string, id: string): LatestFile | null {
  const p = path.join(dir, id, 'latest.json');
  if (!fs.existsSync(p)) return null;
  const meta = JSON.parse(fs.readFileSync(p, 'utf8')) as LatestFile;
  return fs.existsSync(meta.file) ? meta : null;
}

function regionName(catalog: Catalog, code: string, reg: Record<string, string> | null): string {
  const fromCatalog = catalog.region(code)?.name;
  if (fromCatalog) return fromCatalog;
  if (!reg?.Наим) return `Регион ${code}`;
  const type = (reg.Тип ?? '').toLowerCase();
  const n = reg.Наим;
  if (type.startsWith('г')) return n;
  if (type.startsWith('респ')) return n.toLowerCase().includes('республика') ? n : `Республика ${n}`;
  if (type.startsWith('обл')) return `${n} область`;
  if (type.startsWith('край')) return `${n} край`;
  if (type.includes('аобл') || type.includes('автономная')) return `${n} автономная область`;
  if (type.includes('ао') || type.includes('округ')) return `${n} автономный округ`;
  return `${n} ${reg.Тип ?? ''}`.trim();
}

/** Разбор документа реестра МСП. Возвращает null, если компания не относится к товарной вертикали. */
export function parseRsmpDoc(doc: string, catalog: Catalog, regions: Set<string> | null): Company | null {
  const main = tagAttrs(doc, 'СвОКВЭДОсн');
  const hasDeclared = doc.includes('<СвПрод');
  if (!hasDeclared && (!main?.КодОКВЭД || !okvedMayMatch(main.КодОКВЭД))) return null;

  const mn = tagAttrs(doc, 'СведМН');
  const regionCode = mn?.КодРегион ?? '';
  if (regions && !regions.has(regionCode)) return null;

  const declared = allTagAttrs(doc, 'СвПрод').map((p) => ({ code: p.КодПрод ?? '', name: p.НаимПрод ?? '' }));
  const categories = new Set(categoriesForOkved(main?.КодОКВЭД, main?.НаимОКВЭД));
  const products: Company['products'] = [];
  for (const d of declared) {
    for (const m of productsForOkpd2(d.code, catalog)) {
      products.push({ ...m, title: d.name || catalog.product(m.productId)!.name, code: d.code });
      categories.add(m.categoryId);
    }
  }
  if (!categories.size) return null;

  const head = tagAttrs(doc, 'Документ') ?? {};
  const org = tagAttrs(doc, 'ОргВклМСП');
  const ip = tagAttrs(doc, 'ИПВклМСП');
  let inn: string;
  let ogrn: string | null;
  let name: string;
  let fullName: string;
  if (org) {
    inn = org.ИННЮЛ;
    ogrn = org.ОГРН ?? null;
    name = prettyName(org.НаимОргСокр, org.НаимОрг);
    fullName = prettyName(org.НаимОрг, org.НаимОрг);
  } else if (ip) {
    const fio = tagAttrs(doc, 'ФИОИП') ?? {};
    inn = ip.ИННФЛ;
    ogrn = ip.ОГРНИП ?? null;
    const person = [fio.Фамилия, fio.Имя, fio.Отчество].filter(Boolean).map((x) => titleCase(x)).join(' ');
    name = `ИП ${person}`;
    fullName = `Индивидуальный предприниматель ${person}`;
  } else return null;
  if (!inn) return null;

  const city = tagAttrs(doc, 'Город') ?? tagAttrs(doc, 'НаселПункт');
  const ssr = head.ССЧР ?? tagAttrs(doc, 'СведССЧР')?.ССЧР;
  return {
    inn,
    ogrn,
    name,
    fullName,
    entityType: org ? 'LEGAL_ENTITY' : 'IP',
    sme: SME_CATEGORY[head.КатСубМСП] ?? 'UNKNOWN',
    includedAt: isoDate(head.ДатаВклМСП),
    employees: ssr ? Number(ssr) : null,
    regionCode,
    regionName: regionName(catalog, regionCode, tagAttrs(doc, 'Регион')),
    city: city?.Наим ? titleCase(city.Наим) : null,
    okvedMain: { code: main?.КодОКВЭД ?? '', name: main?.НаимОКВЭД ?? '' },
    okvedAdd: allTagAttrs(doc, 'СвОКВЭДДоп').map((o) => ({ code: o.КодОКВЭД, name: o.НаимОКВЭД })),
    declared,
    categories: [...categories],
    products,
  };
}

export function supplierType(c: Company): { type: string; confidence: number; basis: string } {
  if (c.products.length) {
    const names = [...new Set(c.products.map((p) => `«${p.title}» (ОКПД2 ${p.code})`))].slice(0, 3).join(', ');
    return {
      type: 'MANUFACTURER',
      confidence: 0.65,
      basis: `в реестре МСП компания указала производимую продукцию: ${names}. Сведения заявлены самой компанией`,
    };
  }
  return {
    type: 'UNKNOWN',
    confidence: 0.2,
    basis: `основной ОКВЭД ${c.okvedMain.code} «${c.okvedMain.name}». Одного ОКВЭД недостаточно, чтобы подтвердить производство`,
  };
}

/** Мульти-вставка строк одной таблицы одним запросом. */
async function insertRows(client: PoolClient, table: string, columns: string[], rows: unknown[][]): Promise<void> {
  const chunk = Math.max(1, Math.floor(60000 / columns.length));
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const values: unknown[] = [];
    const tuples = part.map((r, j) => {
      values.push(...r);
      return `(${columns.map((_, k) => `$${j * columns.length + k + 1}`).join(',')})`;
    });
    await client.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${tuples.join(',')}`, values);
  }
}

async function flushCompanies(db: Db, batch: Company[], dataDate: string, sourceUrl: string, catalog: Catalog): Promise<void> {
  if (!batch.length) return;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const checkedAt = `${dataDate}T00:00:00Z`;
    const fresh = new Date(`${dataDate}T00:00:00Z`);
    fresh.setUTCDate(fresh.getUTCDate() + 35);
    const freshUntil = fresh.toISOString();

    const ids = new Map<string, string>();
    for (const c of batch) {
      const t = supplierType(c);
      const address = [c.regionName, c.city && c.city !== c.regionName ? `г. ${c.city}` : null].filter(Boolean).join(', ');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO suppliers (inn, ogrn, name, short_name, entity_type, legal_status, region_code, region_name, city, address, okved_main,
           okved_additional, sme_status, supplier_type, supplier_type_confidence, supplier_type_basis, source_type, is_manual_test_data,
           checked_at, registry_seen_at, declared_products)
         VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'OFFICIAL',false,$16,$17,$18)
         ON CONFLICT (inn) DO UPDATE SET ogrn = COALESCE(EXCLUDED.ogrn, suppliers.ogrn), name = EXCLUDED.name, short_name = EXCLUDED.short_name,
           legal_status = 'ACTIVE', region_code = EXCLUDED.region_code, region_name = EXCLUDED.region_name, city = EXCLUDED.city,
           address = EXCLUDED.address, okved_main = EXCLUDED.okved_main, okved_additional = EXCLUDED.okved_additional,
           sme_status = EXCLUDED.sme_status, supplier_type = EXCLUDED.supplier_type, supplier_type_confidence = EXCLUDED.supplier_type_confidence,
           supplier_type_basis = EXCLUDED.supplier_type_basis, checked_at = EXCLUDED.checked_at, registry_seen_at = EXCLUDED.registry_seen_at,
           declared_products = EXCLUDED.declared_products, updated_at = now()
         WHERE suppliers.source_type = 'OFFICIAL'
         RETURNING id`,
        [
          c.inn, c.ogrn, c.name, c.name, c.entityType, c.regionCode, c.regionName, c.city, address, JSON.stringify(c.okvedMain),
          JSON.stringify(c.okvedAdd), c.sme, t.type, t.confidence, t.basis, checkedAt, dataDate, JSON.stringify(c.declared),
        ],
      );
      if (rows[0]) ids.set(c.inn, rows[0].id);
    }

    const supplierIds = [...ids.values()];
    await client.query(`DELETE FROM product_records WHERE supplier_id = ANY($1::uuid[]) AND origin IN ('OKVED', 'SME_DECLARED')`, [supplierIds]);
    await client.query(`DELETE FROM verification_records WHERE supplier_id = ANY($1::uuid[]) AND source = 'SME_REGISTRY'`, [supplierIds]);

    const products: unknown[][] = [];
    const verifications: unknown[][] = [];
    for (const c of batch) {
      const id = ids.get(c.inn);
      if (!id) continue;
      const withProducts = new Set(c.products.map((p) => p.categoryId));
      for (const p of c.products) {
        products.push([id, p.categoryId, p.productId, p.title, catalog.product(p.productId)?.okpd2 ?? null, 'SME_DECLARED', 'SME_REGISTRY', sourceUrl, false, checkedAt]);
      }
      for (const cat of c.categories.filter((x) => !withProducts.has(x))) {
        products.push([id, cat, null, `Основной вид деятельности: ${c.okvedMain.name}`, null, 'OKVED', 'SME_REGISTRY', sourceUrl, false, checkedAt]);
      }
      const v = (field: string, value: string, confidence: number, notes: string | null = null) =>
        verifications.push([id, field, value, 'SME_REGISTRY', sourceUrl, 'OFFICIAL', checkedAt, freshUntil, confidence, true, false, notes]);
      v('legal_status', 'ACTIVE', 0.85, `Компания включена в реестр МСП на ${dataDate.split('-').reverse().join('.')}: в реестре только действующие субъекты. Статус в ЕГРЮЛ не проверялся`);
      v('okved_main', c.okvedMain.code, 0.99);
      v('okved_additional', c.okvedAdd.map((o) => o.code).join(','), 0.99);
      v('region', c.regionCode, 0.99);
      v('sme_status', c.sme, 0.99);
      if (c.includedAt) v('sme_included_at', c.includedAt, 0.99);
      if (c.employees !== null) v('employees_count', String(c.employees), 0.95, 'Среднесписочная численность по данным реестра МСП');
      if (c.declared.length) v('declared_products', c.declared.map((d) => `${d.code} ${d.name}`).join('; '), 0.6, 'Продукция заявлена самой компанией');
      v('supplier_type', supplierType(c).type, supplierType(c).confidence, supplierType(c).basis);
    }
    await insertRows(
      client,
      'product_records',
      ['supplier_id', 'category_id', 'product_id', 'title', 'okpd2', 'origin', 'source', 'source_url', 'is_manual_test_data', 'updated_at'],
      products,
    );
    await insertRows(
      client,
      'verification_records',
      ['supplier_id', 'field', 'value', 'source', 'source_url', 'source_type', 'checked_at', 'fresh_until', 'confidence', 'is_official', 'is_manual_test_data', 'notes'],
      verifications,
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function recordImport(db: Db, id: string, source: string, title: string, meta: LatestFile, total: number, matched: number, details: object = {}) {
  await db.query(
    `INSERT INTO opendata_imports (dataset, source, title, data_date, file_url, imported_at, rows_total, rows_matched, details)
     VALUES ($1,$2,$3,$4,$5,now(),$6,$7,$8)
     ON CONFLICT (dataset) DO UPDATE SET source = EXCLUDED.source, title = EXCLUDED.title, data_date = EXCLUDED.data_date, file_url = EXCLUDED.file_url,
       imported_at = now(), rows_total = EXCLUDED.rows_total, rows_matched = EXCLUDED.rows_matched, details = EXCLUDED.details`,
    [id, source, title, meta.dataDate, meta.url, total, matched, JSON.stringify(details)],
  );
}

/** Реестр МСП → реальные поставщики товарной вертикали. */
async function importRsmp(db: Db, dir: string, log: Logger, catalog: Catalog, regions: Set<string> | null): Promise<void> {
  const meta = readLatest(dir, 'rsmp');
  if (!meta) throw new Error('Архив реестра МСП не скачан: запустите `opendata download rsmp`');
  const sourceUrl = FNS_DATASETS.find((d) => d.id === 'rsmp')!.passport;
  let total = 0;
  let matched = 0;
  let files = 0;
  let batch: Company[] = [];
  const byCategory: Record<string, number> = {};
  const started = Date.now();
  log.info({ file: path.basename(meta.file), dataDate: meta.dataDate, regions: regions ? [...regions] : 'all' }, 'rsmp import started');

  await forEachZipEntry(meta.file, async (_name, stream) => {
    files += 1;
    await streamElements(stream, 'Документ', async (doc) => {
      total += 1;
      const c = parseRsmpDoc(doc, catalog, regions);
      if (!c) return;
      matched += 1;
      for (const cat of c.categories) byCategory[cat] = (byCategory[cat] ?? 0) + 1;
      batch.push(c);
      if (batch.length >= 300) {
        const b = batch;
        batch = [];
        await flushCompanies(db, b, meta.dataDate, sourceUrl, catalog);
      }
    });
    if (files % 500 === 0) log.info({ files, total, matched, sec: Math.round((Date.now() - started) / 1000) }, 'rsmp import progress');
  });
  await flushCompanies(db, batch, meta.dataDate, sourceUrl, catalog);

  // Исключённые из реестра: статус больше не подтверждается
  const { rowCount } = await db.query(
    `UPDATE suppliers SET legal_status = 'UNKNOWN', updated_at = now()
      WHERE source_type = 'OFFICIAL' AND (registry_seen_at IS NULL OR registry_seen_at < $1) AND legal_status <> 'UNKNOWN'`,
    [meta.dataDate],
  );
  await recordImport(db, 'rsmp', 'SME_REGISTRY', 'Единый реестр субъектов МСП', meta, total, matched, { byCategory, excluded: rowCount, files });
  log.info({ total, matched, byCategory, excludedFromRegistry: rowCount, sec: Math.round((Date.now() - started) / 1000) }, 'rsmp import finished');
}

async function officialInns(db: Db): Promise<Map<string, string>> {
  const { rows } = await db.query<{ inn: string; id: string }>(`SELECT inn, id FROM suppliers WHERE source_type = 'OFFICIAL'`);
  return new Map(rows.map((r) => [r.inn, r.id]));
}

/** Наборы «Прозрачного бизнеса» ФНС: численность, спецрежимы, задолженность, доходы/расходы. */
async function importEnrichment(db: Db, dir: string, log: Logger): Promise<void> {
  const inns = await officialInns(db);
  if (!inns.size) {
    log.warn('no official suppliers yet — import rsmp first');
    return;
  }

  const collect = async (id: string, onDoc: (doc: string, inn: string, supplierId: string) => void) => {
    const meta = readLatest(dir, id);
    if (!meta) {
      log.warn({ dataset: id }, 'dataset not downloaded, skipped');
      return null;
    }
    let total = 0;
    let matched = 0;
    await forEachZipEntry(meta.file, async (_n, stream) => {
      await streamElements(stream, 'Документ', (doc) => {
        total += 1;
        const inn = /ИННЮЛ="(\d+)"/.exec(doc)?.[1];
        const sid = inn ? inns.get(inn) : undefined;
        if (!inn || !sid) return;
        matched += 1;
        onDoc(doc, inn, sid);
      });
    });
    return { meta, total, matched };
  };

  const writeVerifications = async (field: string, dataDate: string, sourceUrl: string, values: Map<string, { value: string; notes: string | null }>) => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM verification_records WHERE field = $1 AND source = 'FNS_PB' AND is_manual_test_data = false`, [field]);
      const checkedAt = `${dataDate}T00:00:00Z`;
      const fresh = new Date(checkedAt);
      fresh.setUTCDate(fresh.getUTCDate() + 120);
      const rows = [...values.entries()].map(([sid, v]) => [sid, field, v.value, 'FNS_PB', sourceUrl, 'OFFICIAL', checkedAt, fresh.toISOString(), 0.95, true, false, v.notes]);
      await insertRows(client, 'verification_records', ['supplier_id', 'field', 'value', 'source', 'source_url', 'source_type', 'checked_at', 'fresh_until', 'confidence', 'is_official', 'is_manual_test_data', 'notes'], rows);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  };

  // Численность
  const employees = new Map<string, { value: string; notes: string | null }>();
  const sshr = await collect('sshr', (doc, _inn, sid) => {
    const n = tagAttrs(doc, 'СведССЧР')?.КолРаб;
    const d = tagAttrs(doc, 'Документ')?.ДатаСост;
    if (n) employees.set(sid, { value: n, notes: `Среднесписочная численность на ${d ?? 'отчётную дату'}` });
  });
  if (sshr) {
    await writeVerifications('employees_count', sshr.meta.dataDate, FNS_DATASETS.find((d) => d.id === 'sshr')!.passport, employees);
    await recordImport(db, 'sshr', 'FNS_PB', 'Среднесписочная численность работников', sshr.meta, sshr.total, sshr.matched);
    log.info({ matched: sshr.matched }, 'sshr imported');
  }

  // Специальные налоговые режимы: в наборе только компании на спецрежимах
  const regimes = new Map<string, { value: string; notes: string | null }>();
  const snr = await collect('snr', (doc, _inn, sid) => {
    const a = tagAttrs(doc, 'СведСНР') ?? {};
    const list = [a.ПризнУСН === '1' && 'УСН', a.ПризнАУСН === '1' && 'АУСН', a.ПризнЕСХН === '1' && 'ЕСХН', a.ПризнСРП === '1' && 'СРП'].filter(Boolean);
    if (list.length) regimes.set(sid, { value: list.join(', '), notes: 'Специальный налоговый режим' });
  });
  if (snr) {
    // Набор ФНС охватывает только юрлиц (ИННЮЛ): для ИП режим неизвестен, значение по умолчанию не ставим
    for (const [inn, sid] of inns) if (inn.length === 10 && !regimes.has(sid)) regimes.set(sid, { value: 'ОСН (специальный режим не применяется)', notes: 'Компании нет в наборе спецрежимов ФНС' });
    await writeVerifications('tax_regime', snr.meta.dataDate, FNS_DATASETS.find((d) => d.id === 'snr')!.passport, regimes);
    await recordImport(db, 'snr', 'FNS_PB', 'Специальные налоговые режимы', snr.meta, snr.total, snr.matched);
    log.info({ matched: snr.matched }, 'snr imported');
  }

  // Задолженность: суммируем по всем налогам
  const debts = new Map<string, number>();
  const debtam = await collect('debtam', (doc, _inn, sid) => {
    const sum = allTagAttrs(doc, 'СведНедоим').reduce((acc, a) => acc + Number(a.ОбщСумНедоим ?? 0), 0);
    debts.set(sid, (debts.get(sid) ?? 0) + sum);
  });
  if (debtam) {
    const values = new Map<string, { value: string; notes: string | null }>();
    for (const [inn, sid] of inns) {
      if (inn.length !== 10) continue; // набор только по юрлицам
      const d = debts.get(sid);
      values.set(sid, d
        ? { value: `${d.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`, notes: 'Недоимка, пени и штрафы по данным ФНС' }
        : { value: 'Нет в наборе задолженностей', notes: 'Задолженность по данным ФНС не выявлена' });
    }
    await writeVerifications('tax_debt', debtam.meta.dataDate, FNS_DATASETS.find((d) => d.id === 'debtam')!.passport, values);
    await recordImport(db, 'debtam', 'FNS_PB', 'Задолженность по налогам и сборам', debtam.meta, debtam.total, debtam.matched);
    log.info({ matched: debtam.matched }, 'debtam imported');
  }

  // Доходы и расходы по бухгалтерской отчётности (в рублях)
  const fin = new Map<string, { year: number; revenue: number; expenses: number }>();
  const revexp = await collect('revexp', (doc, _inn, sid) => {
    const a = tagAttrs(doc, 'СведДохРасх') ?? {};
    const year = Number((tagAttrs(doc, 'Документ')?.ДатаСост ?? '').slice(-4)) || new Date().getUTCFullYear() - 1;
    fin.set(sid, { year, revenue: Math.round(Number(a.СумДоход ?? 0)), expenses: Math.round(Number(a.СумРасход ?? 0)) });
  });
  if (revexp) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM financial_reports WHERE source = 'FNS_REVEXP'`);
      const checkedAt = `${revexp.meta.dataDate}T00:00:00Z`;
      const url = FNS_DATASETS.find((d) => d.id === 'revexp')!.passport;
      const rows = [...fin.entries()].map(([sid, f]) => [sid, f.year, f.revenue, f.expenses, 'RUB', 'FNS_REVEXP', url, false, checkedAt]);
      await insertRows(client, 'financial_reports', ['supplier_id', 'period_year', 'revenue', 'expenses', 'unit', 'source', 'source_url', 'is_manual_test_data', 'checked_at'], rows);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    await recordImport(db, 'revexp', 'FNS_REVEXP', 'Доходы и расходы по бухгалтерской отчётности', revexp.meta, revexp.total, revexp.matched);
    log.info({ matched: revexp.matched }, 'revexp imported');
  }
}

export async function importFns(db: Db, dir: string, log: Logger, opts: { regions: string; only?: string[] }): Promise<void> {
  const config = loadConfig();
  const catalog = Catalog.load(config.dataDir);
  const regions = opts.regions ? new Set(opts.regions.split(',').map((s) => s.trim()).filter(Boolean)) : null;
  if (!opts.only || opts.only.includes('rsmp')) await importRsmp(db, dir, log, catalog, regions);
  await importEnrichment(db, dir, log);
}

/**
 * РНП ФАС (открытый набор 7703516539-rnp). Формат CSV; колонку ИНН определяем по заголовку.
 * С зарубежных IP сайт недоступен — запускайте на сервере в РФ или без VPN.
 */
export async function importFasRnp(db: Db, dir: string, log: Logger): Promise<void> {
  const latest = await latestFromPassport(FAS_RNP.passport);
  const file = path.join(dir, 'rnp', path.basename(new URL(latest.url).pathname));
  await downloadFile(latest.url, file, log);
  const raw = fs.readFileSync(file);
  const text = raw.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) || /[Ѐ-ӿ]/.test(raw.subarray(0, 2000).toString('utf8'))
    ? raw.toString('utf8')
    : new TextDecoder('windows-1251').decode(raw);
  const lines = text.split(/\r?\n/).filter(Boolean);
  const sep = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const split = (line: string) => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === sep && !q) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const header = split(lines[0]).map((h) => h.toLowerCase());
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const innCol = col(/инн/);
  if (innCol < 0) throw new Error(`В наборе РНП не найдена колонка ИНН: ${header.join(' | ')}`);
  const numCol = col(/номер|реестров/);
  const dateCol = col(/дата.*(включ|внесен|публикац)/);
  const reasonCol = col(/основани|причин/);

  const inns = await officialInns(db);
  const rows: unknown[][] = [];
  for (const line of lines.slice(1)) {
    const cells = split(line);
    const inn = (cells[innCol] ?? '').replace(/\D/g, '');
    const sid = inns.get(inn);
    if (!sid) continue;
    const date = cells[dateCol] ? isoDate(cells[dateCol].slice(0, 10)) ?? cells[dateCol].slice(0, 10) : null;
    rows.push([sid, 'RNP', 'Запись в реестре недобросовестных поставщиков', reasonCol >= 0 ? cells[reasonCol] || null : null, numCol >= 0 ? cells[numCol] || null : null, date, 'FAS_RNP', FAS_RNP.passport, false, `${latest.dataDate}T00:00:00Z`]);
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM risk_signals WHERE source = 'FAS_RNP' AND is_manual_test_data = false`);
    await insertRows(client, 'risk_signals', ['supplier_id', 'kind', 'title', 'details', 'record_number', 'published_at', 'source', 'source_url', 'is_manual_test_data', 'checked_at'], rows);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  await recordImport(db, 'rnp', 'FAS_RNP', FAS_RNP.title, { file, dataDate: latest.dataDate, url: latest.url }, lines.length - 1, rows.length);
  log.info({ records: lines.length - 1, matched: rows.length }, 'FAS RNP imported');
}
