import type { Catalog, RequiredDocument } from '../catalog/catalog';
import { productsForOkpd2 } from '../opendata/classify';
import type { GispClient } from './gispClient';
import { sleep } from './resilience';
import type { TestDataStore } from './testDataStore';
import {
  type ByInn,
  type DocumentRow,
  type FinancialRow,
  type FreshnessPolicy,
  type HealthStatus,
  type InnQuery,
  type ProductRow,
  type RiskRow,
  type SourceAdapter,
  type SourceId,
  type SourceMode,
  SourceNotConfiguredError,
  SourceUnavailableError,
  type VerificationRow,
} from './types';

export interface AdapterDeps {
  store: TestDataStore;
  catalog: Catalog;
  mode: SourceMode;
  simulateFailure: boolean;
  /** Клиент витрин ГИСП — задаётся, когда получен JWT. */
  gisp?: GispClient;
}

/** Живые данные ГИСП по реальным ИНН + локальный снимок (тестовая база). Товары привязываются к справочнику по ОКПД2. */
async function gispOfficial(deps: AdapterDeps, q: InnQuery, pp719: boolean): Promise<ByInn<ProductRow>> {
  const snapshot = await deps.store.products(q.inns, pp719 ? { pp719Only: true } : { gispOnly: true });
  if (!deps.gisp) return snapshot;
  const real = q.inns.filter((inn) => !inn.startsWith('00'));
  const live = await deps.gisp.products(real, pp719);
  for (const [inn, rows] of Object.entries(live)) {
    snapshot[inn] = rows.flatMap((r) => {
      const matches = productsForOkpd2(r.okpd2 ?? undefined, deps.catalog);
      return matches.length ? matches.map((m) => ({ ...r, category_id: m.categoryId, product_id: m.productId })) : [];
    });
  }
  return snapshot;
}

const DAY = 86_400;

/**
 * Базовый адаптер. Бизнес-логика никогда не обращается к URL реестров напрямую — только через адаптеры.
 * Официальный режим требует разрешённого доступа (API, открытый набор данных, договор, JWT).
 * Пока доступ не оформлен, адаптер работает на ручной тестовой базе либо только отдаёт ссылку.
 */
abstract class BaseAdapter<TQuery, TResult> implements SourceAdapter<TQuery, TResult> {
  abstract readonly id: SourceId;
  abstract readonly name: string;
  protected abstract readonly freshness: FreshnessPolicy;

  constructor(protected readonly deps: AdapterDeps) {}

  get mode(): SourceMode {
    return this.deps.mode;
  }

  async search(query: TQuery): Promise<TResult> {
    if (this.deps.simulateFailure) {
      await sleep(120);
      throw new SourceUnavailableError(this.id, `${this.name}: источник не ответил`);
    }
    switch (this.deps.mode) {
      case 'snapshot':
        return this.searchSnapshot(query);
      case 'official':
        return this.searchOfficial(query);
      default:
        throw new SourceNotConfiguredError(this.id, `${this.name}: автоматизированный доступ не подключён, доступна только ссылка`);
    }
  }

  /** Точка подключения официального API. Реализуется после получения доступа и legal review. */
  protected async searchOfficial(_query: TQuery): Promise<TResult> {
    throw new SourceNotConfiguredError(this.id, `${this.name}: официальный доступ не настроен (нужен API-ключ, выгрузка или договор)`);
  }

  protected abstract searchSnapshot(query: TQuery): Promise<TResult>;

  async healthcheck(): Promise<HealthStatus> {
    const checkedAt = new Date().toISOString();
    if (this.deps.simulateFailure) return { state: 'DOWN', mode: this.mode, checkedAt, details: 'Симуляция недоступности' };
    if (this.mode === 'official') return { state: 'NOT_CONFIGURED', mode: this.mode, checkedAt, details: 'Официальный доступ не оформлен' };
    if (this.mode === 'link_only') return { state: 'NOT_CONFIGURED', mode: this.mode, checkedAt, details: 'Только внешняя ссылка' };
    try {
      await this.deps.store.ping();
      return { state: 'UP', mode: this.mode, checkedAt, details: 'Локальный снимок: открытые данные и ручная база' };
    } catch (err) {
      return { state: 'DOWN', mode: this.mode, checkedAt, details: (err as Error).message };
    }
  }

  getFreshnessPolicy(): FreshnessPolicy {
    return this.freshness;
  }

  externalLink(_q: { inn?: string; name?: string }): string | null {
    return this.deps.catalog.source(this.id).url || null;
  }
}

// ── ФНС ──────────────────────────────────────────────────────────────────────

export interface FnsResult {
  verifications: ByInn<VerificationRow>;
  risks: ByInn<RiskRow>;
}

/** ЕГРЮЛ/ЕГРИП: ИНН, ОГРН, статус, дата регистрации, регион, ОКВЭД, руководитель, недостоверность. */
export class FNSRegistryAdapter extends BaseAdapter<InnQuery, FnsResult> {
  readonly id = 'FNS_EGRUL' as const;
  readonly name = 'ЕГРЮЛ/ЕГРИП ФНС';
  protected readonly freshness = { ttlSeconds: 6 * 3600, staleAfterSeconds: 14 * DAY };
  protected async searchSnapshot(q: InnQuery): Promise<FnsResult> {
    const [verifications, risks] = await Promise.all([
      this.deps.store.verifications(q.inns, ['FNS_EGRUL']),
      this.deps.store.risks(q.inns, ['FNS_EGRUL']),
    ]);
    return { verifications, risks };
  }
}

/** «Прозрачный бизнес»: только поля, связанные с первичным отбором. */
export class TransparentBusinessAdapter extends BaseAdapter<InnQuery, ByInn<VerificationRow>> {
  readonly id = 'FNS_PB' as const;
  readonly name = 'Прозрачный бизнес ФНС';
  protected readonly freshness = { ttlSeconds: 24 * 3600, staleAfterSeconds: 30 * DAY };
  protected searchSnapshot(q: InnQuery) {
    return this.deps.store.verifications(q.inns, ['FNS_PB']);
  }
}

/** Единый реестр МСП. Статус МСП не является обязательным условием выдачи. */
export class SMERegistryAdapter extends BaseAdapter<InnQuery, ByInn<VerificationRow>> {
  readonly id = 'SME_REGISTRY' as const;
  readonly name = 'Единый реестр МСП';
  protected readonly freshness = { ttlSeconds: 24 * 3600, staleAfterSeconds: 35 * DAY };
  protected searchSnapshot(q: InnQuery) {
    return this.deps.store.verifications(q.inns, ['SME_REGISTRY']);
  }
}

/** ГИР БО: показывается только по запросу пользователя, годы не смешиваются. */
export class FinancialReportsAdapter extends BaseAdapter<InnQuery, ByInn<FinancialRow>> {
  readonly id = 'GIR_BO' as const;
  readonly name = 'ГИР БО ФНС';
  protected readonly freshness = { ttlSeconds: 7 * 24 * 3600, staleAfterSeconds: 365 * DAY };
  protected searchSnapshot(q: InnQuery) {
    return this.deps.store.financials(q.inns);
  }
}

// ── ГИСП ─────────────────────────────────────────────────────────────────────

/** Каталог продукции ГИСП. Карточка не доказывает наличие товара на складе. */
export class GispProductAdapter extends BaseAdapter<InnQuery, ByInn<ProductRow>> {
  readonly id = 'GISP' as const;
  readonly name = 'ГИСП: каталог продукции';
  protected readonly freshness = { ttlSeconds: 24 * 3600, staleAfterSeconds: 30 * DAY };
  protected searchSnapshot(q: InnQuery) {
    return this.deps.store.products(q.inns, { gispOnly: true });
  }
  protected override searchOfficial(q: InnQuery) {
    return gispOfficial(this.deps, q, false);
  }
}

/** Реестр российской промышленной продукции (ПП РФ №719). Статус не выводится по общему профилю производителя. */
export class GispRegistryAdapter extends BaseAdapter<InnQuery, ByInn<ProductRow>> {
  readonly id = 'GISP_PP719' as const;
  readonly name = 'ГИСП: реестр промышленной продукции (ПП РФ №719)';
  protected readonly freshness = { ttlSeconds: 24 * 3600, staleAfterSeconds: 30 * DAY };
  protected searchSnapshot(q: InnQuery) {
    return this.deps.store.products(q.inns, { pp719Only: true });
  }
  protected override searchOfficial(q: InnQuery) {
    return gispOfficial(this.deps, q, true);
  }
}

// ── Росаккредитация ──────────────────────────────────────────────────────────

export class FsaCertificateAdapter extends BaseAdapter<InnQuery, ByInn<DocumentRow>> {
  readonly id = 'FSA_CERT' as const;
  readonly name = 'Росаккредитация: сертификаты';
  protected readonly freshness = { ttlSeconds: 6 * 3600, staleAfterSeconds: 14 * DAY };
  protected searchSnapshot(q: InnQuery) {
    return this.deps.store.documents(q.inns, 'CERTIFICATE');
  }
}

/** Отдельный адаптер: модели деклараций и сертификатов не смешиваются. */
export class FsaDeclarationAdapter extends BaseAdapter<InnQuery, ByInn<DocumentRow>> {
  readonly id = 'FSA_DECL' as const;
  readonly name = 'Росаккредитация: декларации';
  protected readonly freshness = { ttlSeconds: 6 * 3600, staleAfterSeconds: 14 * DAY };
  protected searchSnapshot(q: InnQuery) {
    return this.deps.store.documents(q.inns, 'DECLARATION');
  }
}

// ── Риск-сигналы: только официальные факты ───────────────────────────────────

export class EisRnpAdapter extends BaseAdapter<InnQuery, ByInn<RiskRow>> {
  readonly id = 'FAS_RNP' as const;
  readonly name = 'Реестр недобросовестных поставщиков';
  protected readonly freshness = { ttlSeconds: 6 * 3600, staleAfterSeconds: 7 * DAY };
  protected searchSnapshot(q: InnQuery) {
    return this.deps.store.risks(q.inns, ['FAS_RNP']);
  }
  override externalLink(q: { inn?: string }) {
    const base = this.deps.catalog.source(this.id).url;
    return q.inn ? `${base}?searchString=${encodeURIComponent(q.inn)}` : base;
  }
}

export class FedresursAdapter extends BaseAdapter<InnQuery, ByInn<RiskRow>> {
  readonly id = 'FEDRESURS' as const;
  readonly name = 'ЕФРСБ (Федресурс)';
  protected readonly freshness = { ttlSeconds: 6 * 3600, staleAfterSeconds: 7 * DAY };
  protected searchSnapshot(q: InnQuery) {
    return this.deps.store.risks(q.inns, ['FEDRESURS']);
  }
}

// ── Обязательные требования к категории ──────────────────────────────────────

export interface RequirementsResult {
  categoryId: string;
  documents: RequiredDocument[];
}

/** Справочник «категория товара → документы». Не рейтинг поставщиков и не юридическое заключение. */
export class MandatoryRequirementsAdapter extends BaseAdapter<{ categoryId: string }, RequirementsResult> {
  readonly id = 'KND' as const;
  readonly name = 'Портал обязательных требований';
  protected readonly freshness = { ttlSeconds: 7 * 24 * 3600, staleAfterSeconds: 90 * DAY };
  protected async searchSnapshot(q: { categoryId: string }): Promise<RequirementsResult> {
    return { categoryId: q.categoryId, documents: this.deps.catalog.category(q.categoryId)?.requiredDocuments ?? [] };
  }
}

export type AnyAdapter = SourceAdapter<unknown, unknown>;
