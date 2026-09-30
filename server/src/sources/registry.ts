import crypto from 'node:crypto';
import type { Catalog } from '../catalog/catalog';
import type { RedisClient } from '../infra/redis';
import { sourceLatency, sourceRequests } from '../infra/metrics';
import type { Logger } from '../logger';
import {
  EisRnpAdapter,
  FedresursAdapter,
  FinancialReportsAdapter,
  FNSRegistryAdapter,
  FsaCertificateAdapter,
  FsaDeclarationAdapter,
  GispProductAdapter,
  GispRegistryAdapter,
  MandatoryRequirementsAdapter,
  SMERegistryAdapter,
  TransparentBusinessAdapter,
  type AdapterDeps,
} from './adapters';
import { CircuitBreaker, CircuitOpenError, retry, withTimeout } from './resilience';
import type { GispClient } from './gispClient';
import type { TestDataStore } from './testDataStore';
import { type HealthStatus, type SourceAdapter, type SourceId, type SourceMode, SourceNotConfiguredError } from './types';

export type SourceCallStatus = 'ok' | 'failed' | 'not_configured';

export interface SourceStatus {
  id: SourceId;
  name: string;
  status: SourceCallStatus;
  mode: SourceMode;
  message?: string;
}

export type SourceCallResult<T> = { ok: true; data: T; fromCache: boolean; status: SourceStatus } | { ok: false; status: SourceStatus };

export interface RegistryOptions {
  mode: SourceMode;
  simulatedFailures: Set<string>;
  timeoutMs?: number;
  cacheTtlCapSec?: number;
  /** Клиент витрин ГИСП: при наличии адаптеры ГИСП работают в официальном режиме. */
  gisp?: GispClient;
}

export class SourceRegistry {
  readonly fns: FNSRegistryAdapter;
  readonly pb: TransparentBusinessAdapter;
  readonly sme: SMERegistryAdapter;
  readonly finance: FinancialReportsAdapter;
  readonly gisp: GispProductAdapter;
  readonly pp719: GispRegistryAdapter;
  readonly fsaCert: FsaCertificateAdapter;
  readonly fsaDecl: FsaDeclarationAdapter;
  readonly rnp: EisRnpAdapter;
  readonly fedresurs: FedresursAdapter;
  readonly requirements: MandatoryRequirementsAdapter;

  /** Источники с живым официальным API (для реальных компаний считаются подключёнными). */
  readonly officialLive: Set<string>;

  private readonly breakers = new Map<SourceId, CircuitBreaker>();
  private readonly timeoutMs: number;
  private readonly cacheTtlCap: number;

  constructor(
    store: TestDataStore,
    readonly catalog: Catalog,
    private readonly redis: RedisClient | null,
    private readonly log: Logger,
    opts: RegistryOptions,
  ) {
    const deps = (id: SourceId): AdapterDeps => ({ store, catalog, mode: opts.mode, simulateFailure: opts.simulatedFailures.has(id) });
    this.fns = new FNSRegistryAdapter(deps('FNS_EGRUL'));
    this.pb = new TransparentBusinessAdapter(deps('FNS_PB'));
    this.sme = new SMERegistryAdapter(deps('SME_REGISTRY'));
    this.finance = new FinancialReportsAdapter(deps('GIR_BO'));
    const gispDeps = (id: SourceId): AdapterDeps => (opts.gisp ? { ...deps(id), mode: 'official', gisp: opts.gisp } : deps(id));
    this.gisp = new GispProductAdapter(gispDeps('GISP'));
    this.pp719 = new GispRegistryAdapter(gispDeps('GISP_PP719'));
    this.officialLive = new Set(opts.gisp ? ['GISP', 'GISP_PP719'] : []);
    this.fsaCert = new FsaCertificateAdapter(deps('FSA_CERT'));
    this.fsaDecl = new FsaDeclarationAdapter(deps('FSA_DECL'));
    this.rnp = new EisRnpAdapter(deps('FAS_RNP'));
    this.fedresurs = new FedresursAdapter(deps('FEDRESURS'));
    this.requirements = new MandatoryRequirementsAdapter({ ...deps('KND'), mode: 'snapshot' });
    this.timeoutMs = opts.timeoutMs ?? 2500;
    this.cacheTtlCap = opts.cacheTtlCapSec ?? 300;
    for (const a of this.all()) this.breakers.set(a.id, new CircuitBreaker(a.id));
  }

  all(): SourceAdapter<unknown, unknown>[] {
    return [this.fns, this.pb, this.sme, this.finance, this.gisp, this.pp719, this.fsaCert, this.fsaDecl, this.rnp, this.fedresurs, this.requirements] as SourceAdapter<
      unknown,
      unknown
    >[];
  }

  byId(id: SourceId): SourceAdapter<unknown, unknown> | undefined {
    return this.all().find((a) => a.id === id);
  }

  /** Вызов адаптера с кэшем, таймаутом, повтором с backoff и circuit breaker. Никогда не бросает исключение. */
  async call<Q, R>(adapter: SourceAdapter<Q, R>, query: Q): Promise<SourceCallResult<R>> {
    const base = { id: adapter.id, name: adapter.name, mode: adapter.mode };
    const cacheKey = `src:${adapter.id}:${crypto.createHash('sha1').update(JSON.stringify(query)).digest('hex')}`;
    const ttl = Math.min(adapter.getFreshnessPolicy().ttlSeconds, this.cacheTtlCap);

    if (this.redis) {
      const cached = await this.redis.get(cacheKey).catch(() => null);
      if (cached) {
        sourceRequests.inc({ source: adapter.id, outcome: 'cache' });
        return { ok: true, data: JSON.parse(cached) as R, fromCache: true, status: { ...base, status: 'ok' } };
      }
    }

    const breaker = this.breakers.get(adapter.id)!;
    const end = sourceLatency.startTimer({ source: adapter.id });
    try {
      const data = await breaker.exec(() =>
        retry(() => withTimeout(adapter.search(query), this.timeoutMs, adapter.name), {
          attempts: 2,
          baseDelayMs: 150,
          maxDelayMs: 1000,
          isRetryable: (e) => !(e instanceof SourceNotConfiguredError) && !(e instanceof CircuitOpenError),
        }),
      );
      end();
      sourceRequests.inc({ source: adapter.id, outcome: 'ok' });
      if (this.redis && ttl > 0) await this.redis.set(cacheKey, JSON.stringify(data), 'EX', ttl).catch(() => undefined);
      return { ok: true, data, fromCache: false, status: { ...base, status: 'ok' } };
    } catch (err) {
      end();
      const notConfigured = err instanceof SourceNotConfiguredError;
      sourceRequests.inc({ source: adapter.id, outcome: notConfigured ? 'not_configured' : 'failed' });
      if (!notConfigured) this.log.warn({ source: adapter.id, err: (err as Error).message }, 'source call failed');
      return {
        ok: false,
        status: { ...base, status: notConfigured ? 'not_configured' : 'failed', message: (err as Error).message },
      };
    }
  }

  async health(): Promise<(HealthStatus & { id: SourceId; name: string; breaker: string })[]> {
    return Promise.all(
      this.all().map(async (a) => ({ id: a.id, name: a.name, breaker: this.breakers.get(a.id)!.currentState, ...(await a.healthcheck()) })),
    );
  }
}
