/** Официальные открытые наборы данных, из которых собираются реальные сведения о поставщиках. */
export interface DatasetDef {
  id: string;
  source: string;
  title: string;
  passport: string;
  /** Файл в кэше: <id>/<имя из URL> */
  kind: 'fns_xml' | 'csv';
}

export const FNS_DATASETS: DatasetDef[] = [
  { id: 'rsmp', source: 'SME_REGISTRY', title: 'Единый реестр субъектов МСП', passport: 'https://www.nalog.gov.ru/opendata/7707329152-rsmp/', kind: 'fns_xml' },
  { id: 'sshr', source: 'FNS_PB', title: 'Среднесписочная численность работников', passport: 'https://www.nalog.gov.ru/opendata/7707329152-sshr2019/', kind: 'fns_xml' },
  { id: 'snr', source: 'FNS_PB', title: 'Специальные налоговые режимы', passport: 'https://www.nalog.gov.ru/opendata/7707329152-snr/', kind: 'fns_xml' },
  { id: 'revexp', source: 'FNS_REVEXP', title: 'Доходы и расходы по бухгалтерской отчётности', passport: 'https://www.nalog.gov.ru/opendata/7707329152-revexp/', kind: 'fns_xml' },
  { id: 'debtam', source: 'FNS_PB', title: 'Задолженность по налогам и сборам', passport: 'https://www.nalog.gov.ru/opendata/7707329152-debtam/', kind: 'fns_xml' },
];

/** РНП ФАС — открытый набор из раздела 8 ТЗ. С зарубежных IP сайт недоступен. */
export const FAS_RNP: DatasetDef = {
  id: 'rnp',
  source: 'FAS_RNP',
  title: 'Реестр недобросовестных поставщиков (ФАС)',
  passport: 'https://fas.gov.ru/opendata/7703516539-rnp/',
  kind: 'csv',
};
