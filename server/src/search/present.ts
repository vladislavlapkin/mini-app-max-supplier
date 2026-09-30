import type { Catalog } from '../catalog/catalog';
import { formatDateRu } from '../catalog/text';
import { type Provenance, type SearchQuery, SME_LABEL, SUPPLIER_TYPE_LABEL } from '../domain/types';
import type { SourceRegistry, SourceStatus } from '../sources/registry';
import type { DocumentRow, RiskRow, VerificationRow } from '../sources/types';
import type { DocumentDto, RiskDto, SourceRefDto, SupplierCardDto, SupplierSummary } from './dto';
import { type DerivedDocument, type DerivedFacts, fieldValue, provenanceOf } from './facts';
import type { Evidence, Reason, SupplierRow } from './model';
import type { ScoreComponents } from './ranking';

export const LEGAL_LABEL = { ACTIVE: 'Действует', INACTIVE: 'Деятельность прекращена', UNKNOWN: 'Нет данных' } as const;

const STALE_DAYS: Record<string, number> = {
  FNS_EGRUL: 14, FNS_PB: 30, SME_REGISTRY: 35, GISP: 30, GISP_PP719: 30, FSA_CERT: 14, FSA_DECL: 14, FAS_RNP: 7, FEDRESURS: 7, GIR_BO: 365, MANUAL: 90,
};

export const FIELD_LABEL: Record<string, string> = {
  legal_status: 'Статус деятельности',
  registration_date: 'Дата регистрации',
  okved_main: 'Основной ОКВЭД',
  okved_additional: 'Дополнительные ОКВЭД',
  director: 'Руководитель',
  address: 'Адрес',
  region: 'Регион регистрации',
  unreliable_address: 'Недостоверность сведений',
  sme_status: 'Категория МСП',
  sme_included_at: 'Дата включения в реестр МСП',
  employees_count: 'Среднесписочная численность',
  tax_regime: 'Налоговый режим',
  tax_debt: 'Налоговая задолженность',
  supplier_type: 'Тип поставщика и основание',
  supplier_type_claim: 'Заявление компании о своём типе',
};

function freshUntil(source: string, checkedAt: string | null): string | null {
  if (!checkedAt) return null;
  const d = new Date(checkedAt);
  d.setUTCDate(d.getUTCDate() + (STALE_DAYS[source] ?? 30));
  return d.toISOString();
}

export function rowProvenance(
  row: { source: string; source_url: string | null; checked_at?: string; updated_at?: string; is_manual_test_data: boolean },
  catalog: Catalog,
  now: Date,
): Provenance {
  const checked = row.checked_at ?? row.updated_at ?? null;
  return provenanceOf(
    {
      source: row.source,
      source_url: row.source_url,
      checked_at: checked as string,
      fresh_until: freshUntil(row.source, checked),
      is_manual_test_data: row.is_manual_test_data,
      is_official: !row.is_manual_test_data,
      source_type: row.is_manual_test_data ? 'MANUAL_TEST_DATA' : 'OFFICIAL',
      confidence: 0.9,
    },
    catalog,
    now,
  );
}

export function documentDto(d: DerivedDocument, catalog: Catalog, now: Date): DocumentDto {
  const r: DocumentRow = d.row;
  return {
    type: r.document_type,
    number: r.number,
    status: r.status,
    statusLabel: d.isActive && !d.isOfficiallyVerified ? 'Действует по данным тестовой базы' : d.statusLabel,
    isActive: d.isActive,
    isOfficiallyVerified: d.isOfficiallyVerified,
    match: d.match,
    productName: r.product_name,
    manufacturer: r.manufacturer_name,
    manufacturerInn: r.manufacturer_inn,
    applicant: r.applicant,
    techRegulation: r.tech_regulation,
    certificationBody: r.certification_body,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    provenance: rowProvenance(r, catalog, now),
  };
}

export function riskDto(r: RiskRow, catalog: Catalog, now: Date): RiskDto {
  return {
    kind: r.kind,
    title: r.title,
    details: r.details,
    recordNumber: r.record_number,
    publishedAt: r.published_at,
    provenance: rowProvenance(r, catalog, now),
  };
}

export function toSummary(
  s: SupplierRow,
  f: DerivedFacts,
  scored: { score: number; components: ScoreComponents },
  reasons: Reason[],
  catalog: Catalog,
  now: Date,
): SupplierSummary {
  const docs = [...f.documents].sort((a, b) => Number(b.countsAsActive) - Number(a.countsAsActive) || (a.match === 'other' ? 1 : -1));
  return {
    id: s.id,
    inn: s.inn,
    ogrn: s.ogrn,
    name: s.name,
    entityType: s.entity_type,
    supplierType: s.supplier_type,
    supplierTypeLabel: SUPPLIER_TYPE_LABEL[s.supplier_type],
    supplierTypeBasis: s.supplier_type_basis,
    supplierTypeConfidence: s.supplier_type_confidence,
    region: { code: s.region_code, name: catalog.region(s.region_code)?.name ?? s.region_name },
    city: s.city,
    regionMatch: f.regionMatch,
    product: { titles: f.matchedProductTitles, match: f.productMatch },
    legalStatus: { ...f.legalStatus, label: LEGAL_LABEL[f.legalStatus.value] },
    sme: { ...f.sme, label: SME_LABEL[f.sme.value] },
    gisp: {
      found: f.gispRecords.length > 0,
      records: f.gispRecords.length,
      pp719: f.pp719Records.length > 0,
      provenance: f.gispRecords[0] ? rowProvenance(f.gispRecords[0], catalog, now) : null,
    },
    documents: {
      total: f.documents.length,
      active: f.documents.filter((d) => d.countsAsActive).length,
      relevantActive: f.documents.filter((d) => d.countsAsActive && d.match !== 'other').length,
      items: docs.map((d) => documentDto(d, catalog, now)),
    },
    risks: f.risks.map((r) => riskDto(r, catalog, now)),
    discrepancies: f.discrepancies,
    checkedAt: f.checkedAt,
    score: scored.score,
    scoreComponents: scored.components,
    reasons,
    isManualTestData: s.is_manual_test_data,
    sourcesFailed: f.sourcesFailed,
    uncovered: f.uncovered,
  };
}

function factFrom<T>(row: VerificationRow | undefined, value: T, catalog: Catalog, now: Date) {
  return { value, provenance: row ? provenanceOf(row, catalog, now) : null };
}

export function toCard(args: {
  s: SupplierRow;
  ev: Evidence;
  f: DerivedFacts;
  summary: SupplierSummary;
  query: SearchQuery | null;
  statuses: SourceStatus[];
  requirements: { categoryId: string; documents: { title: string; hint: string }[] } | null;
  catalog: Catalog;
  sources: SourceRegistry;
  imports: { dataset: string; title: string; dataDate: string }[];
  now: Date;
}): SupplierCardDto {
  const { s, ev, f, summary, query, statuses, requirements, catalog, sources, now } = args;
  const fnsRows = ev.fns?.rows ?? [];
  const regRow = fieldValue(fnsRows, 'registration_date');
  // Для реальных компаний без ЕГРЮЛ: местонахождение и ОКВЭД — из реестра МСП
  const addrRow = fieldValue(fnsRows, 'address') ?? fieldValue(ev.sme, 'region');
  const dirRow = fieldValue(fnsRows, 'director');
  const okMainRow = fieldValue(fnsRows, 'okved_main') ?? fieldValue(ev.sme, 'okved_main');
  const okAddRow = fieldValue(fnsRows, 'okved_additional') ?? fieldValue(ev.sme, 'okved_additional');
  const smeIncl = fieldValue(ev.sme, 'sme_included_at');
  const category = catalog.category(query?.categoryId ?? s.products[0]?.category_id);

  const allProducts = [...(ev.gisp ?? [])];
  const gispIds = new Set(allProducts.map((p) => p.id));
  const productCards = s.products.map((p) => {
    const gisp = allProducts.find((g) => g.product_id === p.product_id && g.category_id === p.category_id);
    const pp = (ev.pp719 ?? []).find((g) => g.product_id === p.product_id);
    return {
      title: p.title,
      categoryName: catalog.category(p.category_id)?.name ?? p.category_id,
      brand: gisp?.brand ?? null,
      model: gisp?.model ?? null,
      okpd2: gisp?.okpd2 ?? catalog.product(p.product_id)?.okpd2 ?? null,
      characteristics: gisp?.characteristics ?? {},
      gispRecordNumber: gisp && gispIds.has(gisp.id) ? gisp.gisp_record_number : null,
      pp719RecordNumber: pp?.pp719_record_number ?? null,
      russianOriginConfirmed: !!pp?.russian_origin_confirmed,
      matchesQuery: query?.productId ? p.product_id === query.productId : !!category && p.category_id === category.id,
      provenance: gisp ? rowProvenance(pp ?? gisp, catalog, now) : null,
    };
  });

  const okMainValue = okMainRow ? s.okved_main && s.okved_main.code === okMainRow.value ? s.okved_main : { code: okMainRow.value, name: '' } : s.okved_main;
  const okAddCodes = okAddRow ? okAddRow.value.split(',') : s.okved_additional.map((o) => o.code);
  const okAddValue = okAddCodes.map((code) => s.okved_additional.find((o) => o.code === code) ?? { code, name: '' });

  // Источники: что и откуда показано
  const refs = new Map<string, SourceRefDto>();
  const touch = (source: string, field: string, checkedAt: string | null, manual: boolean) => {
    const info = catalog.source(source);
    const ref: SourceRefDto = refs.get(source) ?? {
      source,
      name: source === 'MANUAL' ? 'Ручная тестовая база' : info.name,
      url: info.url || null,
      checkedAt: null,
      sourceType: manual ? 'MANUAL_TEST_DATA' : 'OFFICIAL',
      isOfficial: !manual,
      fields: [],
      status: 'ok',
    };
    if (!ref.fields.includes(field)) ref.fields.push(field);
    if (checkedAt && (!ref.checkedAt || checkedAt > ref.checkedAt)) ref.checkedAt = checkedAt;
    refs.set(source, ref);
  };
  for (const r of [...fnsRows, ...(ev.sme ?? []), ...(ev.pb ?? []), ...ev.manual]) touch(r.source, FIELD_LABEL[r.field] ?? r.field, r.checked_at, r.is_manual_test_data);
  for (const p of ev.gisp ?? []) touch('GISP', 'Продукция и характеристики', p.updated_at, p.is_manual_test_data);
  for (const p of ev.pp719 ?? []) touch('GISP_PP719', 'Реестровая запись ПП РФ №719', p.updated_at, p.is_manual_test_data);
  for (const d of [...(ev.certs ?? []), ...(ev.decls ?? [])]) touch(d.source, 'Документы о соответствии', d.checked_at, d.is_manual_test_data);
  for (const r of f.risks) touch(r.source, 'Риск-сигналы', r.checked_at, r.is_manual_test_data);
  const official = s.source_type === 'OFFICIAL';
  for (const st of statuses) {
    const notConnected = f.uncovered.includes(st.id);
    if (!refs.has(st.id)) {
      const info = catalog.source(st.id);
      refs.set(st.id, {
        source: st.id,
        name: info.name,
        url: info.url || null,
        checkedAt: null,
        sourceType: official ? 'OFFICIAL' : 'MANUAL_TEST_DATA',
        isOfficial: official,
        fields: notConnected ? ['Нет разрешённого автоматизированного доступа — проверьте по ссылке'] : st.status === 'ok' ? ['Проверено: записей не найдено'] : [],
        status: notConnected ? 'not_configured' : st.status,
      });
    } else if (st.status !== 'ok') refs.get(st.id)!.status = st.status;
  }
  if (s.website || s.phone) touch('MANUAL', 'Контакты', s.checked_at, true);

  const limitations = [
    'Цена, наличие, сроки поставки и минимальная партия не подтверждены — уточняйте у поставщика.',
    'Отсутствие записей в реестрах риск-сигналов не гарантирует исполнение обязательств.',
  ];
  if (s.is_manual_test_data) limitations.unshift('Демо-версия: сведения из ручной тестовой базы, а не из официальных реестров.');
  if (official) {
    const loaded = args.imports.map((i) => `${i.title} — на ${formatDateRu(i.dataDate)}`).join('; ');
    const names = [...new Set(f.uncovered.map((u) => catalog.source(u).name))].join(', ');
    limitations.unshift(`Реальная компания. Подключены официальные открытые данные ФНС: ${loaded}.`);
    if (names) limitations.push(`Не подключены (нужен API-ключ, выгрузка или договор): ${names}. Статус в ЕГРЮЛ, документы и риск-сигналы проверьте по ссылкам ниже.`);
    if (s.supplier_type === 'UNKNOWN') limitations.push('Тип поставщика не определён: по одному ОКВЭД производство не подтверждается.');
  }
  for (const st of statuses) {
    if (st.status === 'failed') limitations.push(`${st.name}: источник не ответил. Показаны данные последней успешной проверки на ${formatDateRu(s.checked_at)}.`);
  }
  const lowConfidence = [...fnsRows, ...(ev.sme ?? []), ...ev.manual].filter((r) => r.confidence < 0.8).map((r) => FIELD_LABEL[r.field] ?? r.field);
  if (lowConfidence.length) limitations.push(`Непроверенные поля: ${[...new Set(lowConfidence)].join(', ').toLowerCase()}.`);

  const externalLinks = ['FNS_EGRUL', 'FNS_PB', 'SME_REGISTRY', 'GISP', 'GISP_PP719', 'FSA_DECL', 'FSA_CERT', 'FAS_RNP', 'FEDRESURS', 'GIR_BO', 'KAD']
    .map((id) => {
      const adapter = sources.byId(id as never);
      const url = adapter ? adapter.externalLink({ inn: s.inn, name: s.name }) : catalog.source(id).url;
      return url ? { source: id, name: catalog.source(id).name, url } : null;
    })
    .filter((x): x is { source: string; name: string; url: string } => !!x);

  const pbRows = ev.pb;
  return {
    summary,
    general: {
      name: s.name,
      inn: s.inn,
      ogrn: s.ogrn,
      kpp: s.kpp,
      entityType: s.entity_type,
      legalStatus: summary.legalStatus,
      registrationDate: factFrom(regRow, regRow?.value ?? s.registration_date, catalog, now),
      region: summary.region.name,
      address: factFrom(addrRow, fieldValue(fnsRows, 'address')?.value ?? s.address, catalog, now),
      director: factFrom(dirRow, dirRow?.value ?? s.director, catalog, now),
      checkedAt: f.checkedAt,
    },
    activity: {
      okvedMain: factFrom(okMainRow, okMainValue, catalog, now),
      okvedAdditional: factFrom(okAddRow, okAddValue, catalog, now),
      matchesQuery: f.okvedMatch,
      note: f.okvedMatch
        ? 'Есть профильный ОКВЭД. Тип поставщика по одному ОКВЭД не определяется.'
        : 'Профильный ОКВЭД не найден. Это не исключает компанию из выдачи.',
    },
    sme: {
      status: { ...f.sme, label: SME_LABEL[f.sme.value] },
      includedAt: factFrom(smeIncl, smeIncl?.value ?? null, catalog, now),
    },
    products: productCards,
    documents: summary.documents.items,
    transparency: pbRows
      ? (() => {
          // Численность: набор ФНС, иначе сведения реестра МСП
          const emp = fieldValue(pbRows, 'employees_count') ?? fieldValue(ev.sme, 'employees_count');
          return {
            employees: factFrom(emp, emp?.value ?? null, catalog, now),
            taxRegime: factFrom(fieldValue(pbRows, 'tax_regime'), fieldValue(pbRows, 'tax_regime')?.value ?? null, catalog, now),
            taxDebt: factFrom(fieldValue(pbRows, 'tax_debt'), fieldValue(pbRows, 'tax_debt')?.value ?? null, catalog, now),
          };
        })()
      : null,
    risks: summary.risks,
    riskSourcesChecked: statuses
      .filter((st) => ['FNS_EGRUL', 'FAS_RNP', 'FEDRESURS'].includes(st.id))
      .map((st) => ({ source: st.id, name: st.name, status: f.uncovered.includes(st.id) ? 'not_configured' : st.status })),
    requirements:
      requirements && category
        ? { categoryName: category.name, documents: requirements.documents, sourceName: catalog.source('KND').name, sourceUrl: catalog.source('KND').url }
        : null,
    contacts: { website: s.website, phone: s.phone, email: s.email, isManualTestData: s.is_manual_test_data },
    sources: [...refs.values()],
    externalLinks,
    limitations,
    discrepancies: f.discrepancies,
    sourceStatuses: statuses,
    financialsAvailable: true,
  };
}
