import { describe, expect, it } from 'vitest';
import { SourceRegistry } from '../src/sources/registry';
import { CircuitBreaker, CircuitOpenError, retry } from '../src/sources/resilience';
import type { TestDataStore } from '../src/sources/testDataStore';
import { SourceUnavailableError } from '../src/sources/types';
import { catalog, silentLog } from './helpers';

/** Контрактные тесты: каждый адаптер реализует единый интерфейс SourceAdapter. */
const fakeStore = {
  ping: async () => undefined,
  verifications: async (inns: string[], sources: string[]) =>
    Object.fromEntries(inns.map((inn) => [inn, [{ inn, field: 'legal_status', value: 'ACTIVE', source: sources[0], source_url: null, source_type: 'MANUAL_TEST_DATA', checked_at: '2026-09-25T00:00:00Z', fresh_until: null, confidence: 1, is_official: false, is_manual_test_data: true, notes: null }]])),
  products: async () => ({}),
  documents: async () => ({}),
  risks: async () => ({}),
  financials: async () => ({}),
} as unknown as TestDataStore;

describe('source adapters contract', () => {
  const registry = new SourceRegistry(fakeStore, catalog, null, silentLog, { mode: 'snapshot', simulatedFailures: new Set() });

  it.each(registry.all().map((a) => [a.id, a]))('%s реализует интерфейс', async (_id, adapter) => {
    expect(adapter.name.length).toBeGreaterThan(3);
    expect(['snapshot', 'official', 'link_only']).toContain(adapter.mode);
    const policy = adapter.getFreshnessPolicy();
    expect(policy.ttlSeconds).toBeGreaterThan(0);
    expect(policy.staleAfterSeconds).toBeGreaterThanOrEqual(policy.ttlSeconds);
    const health = await adapter.healthcheck();
    expect(['UP', 'DEGRADED', 'DOWN', 'NOT_CONFIGURED']).toContain(health.state);
    expect(typeof health.checkedAt).toBe('string');
    const query = adapter.id === 'KND' ? { categoryId: 'paints' } : { inns: ['0012345678'] };
    const res = await adapter.search(query);
    expect(res).toBeTypeOf('object');
    const link = adapter.externalLink({ inn: '0012345678' });
    if (link) expect(link).toMatch(/^https:\/\//);
  });

  it('официальный режим без доступа не притворяется, что работает', async () => {
    const official = new SourceRegistry(fakeStore, catalog, null, silentLog, { mode: 'official', simulatedFailures: new Set() });
    const res = await official.call(official.fns, { inns: ['0012345678'] });
    expect(res.ok).toBe(false);
    expect(res.status.status).toBe('not_configured');
  });

  it('частичный отказ адаптера не бросает исключение и помечается как failed', async () => {
    const failing = new SourceRegistry(fakeStore, catalog, null, silentLog, { mode: 'snapshot', simulatedFailures: new Set(['FSA_DECL']) });
    const bad = await failing.call(failing.fsaDecl, { inns: ['0012345678'] });
    expect(bad).toMatchObject({ ok: false, status: { id: 'FSA_DECL', status: 'failed' } });
    const good = await failing.call(failing.fns, { inns: ['0012345678'] });
    expect(good.ok).toBe(true);
  });
});

describe('resilience', () => {
  it('retry повторяет и сдаётся после N попыток', async () => {
    let calls = 0;
    await expect(
      retry(
        async () => {
          calls++;
          throw new SourceUnavailableError('GISP', 'down');
        },
        { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
      ),
    ).rejects.toThrow('down');
    expect(calls).toBe(3);
  });

  it('circuit breaker размыкается после серии ошибок и восстанавливается', async () => {
    let t = 0;
    const cb = new CircuitBreaker('X', 2, 1000, () => t);
    const fail = () => cb.exec(async () => Promise.reject(new Error('boom')));
    await expect(fail()).rejects.toThrow('boom');
    await expect(fail()).rejects.toThrow('boom');
    await expect(cb.exec(async () => 1)).rejects.toBeInstanceOf(CircuitOpenError);
    t = 1500;
    expect(cb.currentState).toBe('HALF_OPEN');
    await expect(cb.exec(async () => 1)).resolves.toBe(1);
    expect(cb.currentState).toBe('CLOSED');
  });
});
