import type { Db } from '../infra/db';
import { hashUserId, type Logger } from '../logger';

export const CLIENT_EVENTS = [
  'miniapp_opened',
  'card_opened',
  'supplier_saved',
  'selection_saved',
  'source_link_opened',
  'contact_link_opened',
  'filters_changed',
  'compare_opened',
  'saved_opened',
  'sources_opened',
] as const;

export type ClientEvent = (typeof CLIENT_EVENTS)[number];

/** События, которые считаются успешным исходом поиска (раздел 17 ТЗ). */
const SUCCESS_EVENTS = ['card_opened', 'supplier_saved', 'selection_saved', 'source_link_opened', 'contact_link_opened'];

export class AnalyticsService {
  constructor(
    private readonly db: Db,
    private readonly log: Logger,
  ) {}

  track(name: string, opts: { userId?: string | null; searchId?: string | null; props?: Record<string, unknown> } = {}): void {
    this.db
      .query('INSERT INTO analytics_events (user_hash, search_id, name, props) VALUES ($1, $2, $3, $4)', [
        hashUserId(opts.userId),
        opts.searchId ?? null,
        name,
        JSON.stringify(opts.props ?? {}),
      ])
      .catch((err) => this.log.warn({ err: err.message, name }, 'analytics insert failed'));
  }

  /** Основная и дополнительные метрики за период. */
  async metrics(days = 30) {
    const { rows } = await this.db.query(
      `WITH period AS (SELECT * FROM analytics_events WHERE created_at > now() - make_interval(days => $1::int)),
            started AS (SELECT DISTINCT search_id FROM period WHERE name = 'search_started' AND search_id IS NOT NULL),
            success AS (SELECT DISTINCT search_id FROM period WHERE name = ANY($2) AND search_id IN (SELECT search_id FROM started))
       SELECT
         (SELECT count(*) FROM started)::int AS searches_started,
         (SELECT count(*) FROM success)::int AS searches_successful,
         (SELECT count(*) FROM period WHERE name = 'search_started' AND (props->>'total')::int > 0)::int AS searches_nonempty,
         (SELECT avg((props->>'latencyMs')::numeric) FROM period WHERE name = 'search_started')::float AS avg_latency_ms,
         (SELECT count(*) FROM period WHERE name = 'filters_changed')::int AS filters_changed,
         (SELECT count(*) FROM period WHERE name = 'source_link_opened')::int AS source_clicks,
         (SELECT count(*) FROM period WHERE name IN ('supplier_saved', 'selection_saved'))::int AS saves,
         (SELECT count(*) FROM period WHERE name = 'saved_opened')::int AS saved_returns,
         (SELECT count(*) FROM period WHERE name = 'card_opened')::int AS cards_opened,
         (SELECT sum((props->>'shown')::int) FROM period WHERE name = 'search_started')::int AS cards_shown,
         (SELECT sum((props->>'legalConfirmed')::int) FROM period WHERE name = 'search_started')::int AS cards_legal_confirmed,
         (SELECT sum((props->>'typeDefined')::int) FROM period WHERE name = 'search_started')::int AS cards_type_defined,
         (SELECT sum((props->>'staleSources')::int) FROM period WHERE name = 'search_started')::int AS stale_sources`,
      [days, SUCCESS_EVENTS],
    );
    const r = rows[0];
    const ratio = (a: number | null, b: number | null) => (b ? Math.round(((a ?? 0) / b) * 1000) / 1000 : null);
    return {
      periodDays: days,
      searchSuccessRate: ratio(r.searches_successful, r.searches_started),
      searchesStarted: r.searches_started,
      nonEmptyShare: ratio(r.searches_nonempty, r.searches_started),
      avgTimeToFirstResultMs: r.avg_latency_ms ? Math.round(r.avg_latency_ms) : null,
      avgFiltersChangedPerSearch: ratio(r.filters_changed, r.searches_started),
      legalStatusConfirmedShare: ratio(r.cards_legal_confirmed, r.cards_shown),
      supplierTypeDefinedShare: ratio(r.cards_type_defined, r.cards_shown),
      sourceClickShare: ratio(r.source_clicks, r.cards_opened),
      saveShare: ratio(r.saves, r.searches_started),
      savedReturns: r.saved_returns,
      staleSourceResponses: r.stale_sources ?? 0,
    };
  }
}
