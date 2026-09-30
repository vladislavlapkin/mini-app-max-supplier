import { getInitData, getStartParam, isInMax } from '../bridge';
import type {
  Catalog,
  CompareResponse,
  Financials,
  HistoryItem,
  SavedSupplierItem,
  SearchQuery,
  SearchResponse,
  SelectionItem,
  SessionInfo,
  SupplierCard,
  SupplierSummary,
} from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export class NetworkError extends Error {}

function demoUserId(): string {
  const key = 'pp_demo_user';
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return 'demo-browser-session';
  }
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json' };
  if (isInMax()) h['X-Max-Init-Data'] = getInitData();
  else {
    h['X-Demo-User'] = demoUserId();
    const sp = getStartParam();
    if (sp) h['X-Start-Param'] = sp;
  }
  return h;
}

/** Все запросы идут через этот слой. При сетевой ошибке — одна автоматическая попытка. */
async function request<T>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
  const init: RequestInit = {
    method,
    headers: { ...headers(), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    await new Promise((r) => setTimeout(r, 600));
    try {
      res = await fetch(path, init);
    } catch {
      throw new NetworkError('Нет соединения');
    }
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, data.message ?? 'Что-то пошло не так', data.error);
  return data as T;
}

const ctx = (q: SearchQuery | null | undefined) => (q ? `ctx=${encodeURIComponent(JSON.stringify(q))}` : '');

export const api = {
  session: () => request<SessionInfo>('GET', '/api/session'),
  catalog: () => request<Catalog>('GET', '/api/catalog'),
  suggest: (q: string) => request<{ items: { productId: string | null; categoryId: string; name: string; categoryName: string }[] }>('GET', `/api/suggest?q=${encodeURIComponent(q)}`),
  search: (q: SearchQuery) => request<SearchResponse>('POST', '/api/search', q),
  supplier: (id: string, q?: SearchQuery | null) => request<SupplierCard>('GET', `/api/suppliers/${id}?${ctx(q)}`),
  financials: (id: string) => request<Financials>('GET', `/api/suppliers/${id}/financials`),
  compare: (ids: string[], q?: SearchQuery | null) => request<CompareResponse>('GET', `/api/compare?ids=${ids.join(',')}&${ctx(q)}`),
  selections: () => request<{ items: SelectionItem[] }>('GET', '/api/saved/selections'),
  selection: (id: string) =>
    request<{ selection: SelectionItem; suppliers: (SupplierSummary & { sources: string[] })[]; warnings: string[]; checkedAt: string }>('GET', `/api/saved/selections/${id}`),
  saveSelection: (body: { title?: string; query: SearchQuery; supplierIds: string[]; note?: string | null }, searchId?: string) =>
    request<{ id: string; title: string; botNotified: boolean }>('POST', '/api/saved/selections', body, searchId ? { 'X-Search-Id': searchId } : {}),
  updateSelection: (id: string, patch: { title?: string; note?: string | null }) => request<{ ok: boolean }>('PATCH', `/api/saved/selections/${id}`, patch),
  deleteSelection: (id: string) => request<{ ok: boolean }>('DELETE', `/api/saved/selections/${id}`),
  savedSuppliers: () => request<{ items: SavedSupplierItem[] }>('GET', '/api/saved/suppliers'),
  saveSupplier: (id: string, body: { note?: string | null; query?: SearchQuery | null }, searchId?: string) =>
    request<{ ok: boolean }>('PUT', `/api/saved/suppliers/${id}`, body, searchId ? { 'X-Search-Id': searchId } : {}),
  updateSupplierNote: (id: string, note: string | null) => request<{ ok: boolean }>('PATCH', `/api/saved/suppliers/${id}`, { note }),
  removeSupplier: (id: string) => request<{ ok: boolean }>('DELETE', `/api/saved/suppliers/${id}`),
  history: () => request<{ items: HistoryItem[] }>('GET', '/api/history'),
  feedback: (text: string) => request<{ ok: boolean }>('POST', '/api/feedback/category', { text }),
  event: (name: string, searchId?: string | null, props?: Record<string, unknown>) =>
    request<{ ok: boolean }>('POST', '/api/events', { name, searchId: searchId ?? null, props }).catch(() => undefined),
};
