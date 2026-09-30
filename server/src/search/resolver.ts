import type { SourceRegistry, SourceStatus } from '../sources/registry';
import type { TestDataStore } from '../sources/testDataStore';
import type { Evidence } from './model';

export type EvidenceScope = 'search' | 'card';

/**
 * Supplier Resolver: параллельно опрашивает адаптеры и собирает сведения по каждой компании.
 * Частичный отказ адаптера не ломает поиск: для такого источника в Evidence будет null и статус failed.
 */
export class SupplierResolver {
  constructor(
    private readonly sources: SourceRegistry,
    private readonly store: TestDataStore,
  ) {}

  async resolve(inns: string[], scope: EvidenceScope): Promise<{ evidence: Record<string, Evidence>; statuses: SourceStatus[] }> {
    const q = { inns };
    const s = this.sources;
    const [fns, sme, gisp, pp719, certs, decls, rnp, fedresurs, pb, manual] = await Promise.all([
      s.call(s.fns, q),
      s.call(s.sme, q),
      s.call(s.gisp, q),
      s.call(s.pp719, q),
      s.call(s.fsaCert, q),
      s.call(s.fsaDecl, q),
      s.call(s.rnp, q),
      s.call(s.fedresurs, q),
      scope === 'card' ? s.call(s.pb, q) : Promise.resolve(null),
      this.store.verifications(inns, ['MANUAL']).catch(() => ({})),
    ]);

    const evidence: Record<string, Evidence> = {};
    for (const inn of inns) {
      evidence[inn] = {
        fns: fns.ok ? { rows: fns.data.verifications[inn] ?? [], risks: fns.data.risks[inn] ?? [] } : null,
        sme: sme.ok ? sme.data[inn] ?? [] : null,
        gisp: gisp.ok ? gisp.data[inn] ?? [] : null,
        pp719: pp719.ok ? pp719.data[inn] ?? [] : null,
        certs: certs.ok ? certs.data[inn] ?? [] : null,
        decls: decls.ok ? decls.data[inn] ?? [] : null,
        rnp: rnp.ok ? rnp.data[inn] ?? [] : null,
        fedresurs: fedresurs.ok ? fedresurs.data[inn] ?? [] : null,
        pb: pb && pb.ok ? pb.data[inn] ?? [] : null,
        manual: (manual as Record<string, Evidence['manual']>)[inn] ?? [],
      };
    }
    const statuses = [fns, sme, gisp, pp719, certs, decls, rnp, fedresurs, pb].filter((c): c is NonNullable<typeof c> => !!c).map((c) => c.status);
    return { evidence, statuses };
  }
}
