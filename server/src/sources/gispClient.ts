import type { Logger } from '../logger';
import { SourceUnavailableError, type ByInn, type ProductRow } from './types';

/**
 * Клиент витрин данных ГИСП (https://gisp.gov.ru/datamarts/info): защищённый API с JWT.
 * Доступ выдаётся по заявке организации. Пути витрин и имена полей задаются в .env по паспорту витрины,
 * который приходит вместе с доступом: GISP_PRODUCTS_PATH, GISP_PP719_PATH (параметр {inn} подставляется).
 */
export interface GispClientOptions {
  baseUrl: string;
  jwt: string;
  productsPath: string;
  pp719Path: string;
  log: Logger;
}

type Rec = Record<string, unknown>;

const pick = (r: Rec, keys: string[]): string | null => {
  for (const k of keys) {
    const v = r[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
  }
  return null;
};

export class GispClient {
  constructor(private readonly o: GispClientOptions) {}

  private async get(path: string, inn: string): Promise<Rec[]> {
    const url = new URL(path.replace('{inn}', encodeURIComponent(inn)), this.o.baseUrl);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.o.jwt}`, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 401 || res.status === 403) throw new SourceUnavailableError('GISP', 'ГИСП: JWT недействителен или истёк — обновите GISP_JWT');
    if (!res.ok) throw new SourceUnavailableError('GISP', `ГИСП: HTTP ${res.status}`);
    const body = (await res.json()) as unknown;
    if (Array.isArray(body)) return body as Rec[];
    const obj = body as Rec;
    for (const key of ['items', 'data', 'result', 'rows', 'content']) if (Array.isArray(obj[key])) return obj[key] as Rec[];
    return [];
  }

  private map(inn: string, r: Rec, pp719: boolean, sourceUrl: string): ProductRow {
    const reg = pp719 ? pick(r, ['regNumber', 'registryNumber', 'reestrNumber', 'number']) : null;
    return {
      inn,
      id: pick(r, ['id', 'productId', 'uuid']) ?? `${inn}:${pick(r, ['okpd2', 'OKPD2']) ?? ''}:${pick(r, ['name', 'productName']) ?? ''}`,
      category_id: '',
      product_id: null,
      title: pick(r, ['name', 'productName', 'title']) ?? 'Продукция из ГИСП',
      brand: pick(r, ['brand', 'trademark']),
      model: pick(r, ['model']),
      okpd2: pick(r, ['okpd2', 'OKPD2', 'okpd']),
      origin: 'GISP',
      gisp_record_number: pick(r, ['gispId', 'id', 'productId']),
      pp719_record_number: reg,
      russian_origin_confirmed: pp719 && !!reg,
      characteristics: {},
      source: pp719 ? 'GISP_PP719' : 'GISP',
      source_url: pick(r, ['url', 'link']) ?? sourceUrl,
      is_manual_test_data: false,
      updated_at: pick(r, ['updatedAt', 'modified', 'date']) ?? new Date().toISOString(),
    };
  }

  async products(inns: string[], pp719: boolean): Promise<ByInn<ProductRow>> {
    const out: ByInn<ProductRow> = {};
    const path = pp719 ? this.o.pp719Path : this.o.productsPath;
    const sourceUrl = pp719 ? 'https://gisp.gov.ru/pp719v2/pub/prod/' : 'https://gisp.gov.ru/goods/';
    // Последовательно и только по ИНН выдачи: витрины имеют лимиты запросов
    for (const inn of inns) {
      const recs = await this.get(path, inn);
      out[inn] = recs.map((r) => this.map(inn, r, pp719, sourceUrl));
    }
    return out;
  }
}
