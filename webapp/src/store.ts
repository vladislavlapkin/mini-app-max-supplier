import { create } from 'zustand';
import type { Catalog, SearchQuery, SearchResponse, SessionInfo, SupplierSummary } from './api/types';
import { EMPTY_QUERY } from './api/types';

export interface CompareItem {
  id: string;
  name: string;
}

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

interface AppState {
  session: SessionInfo | null;
  catalog: Catalog | null;
  bootError: string | null;
  form: SearchQuery;
  results: Record<string, SearchResponse>;
  lastSearchId: string | null;
  compare: CompareItem[];
  savedSupplierIds: Set<string>;
  savedSelectionKeys: Set<string>;
  toast: Toast | null;
  online: boolean;

  setBoot: (session: SessionInfo, catalog: Catalog) => void;
  setBootError: (e: string | null) => void;
  setForm: (patch: Partial<SearchQuery>) => void;
  replaceForm: (q: SearchQuery) => void;
  cacheResults: (key: string, r: SearchResponse) => void;
  toggleCompare: (s: Pick<SupplierSummary, 'id' | 'name'>) => 'added' | 'removed' | 'full';
  removeCompare: (id: string) => void;
  clearCompare: () => void;
  setSavedSuppliers: (ids: string[]) => void;
  markSupplierSaved: (id: string, saved: boolean) => void;
  markSelectionSaved: (key: string) => void;
  showToast: (text: string, action?: Toast['action']) => void;
  hideToast: () => void;
  setOnline: (v: boolean) => void;
}

export const MAX_COMPARE = 3;

const FORM_KEY = 'pp_form';

function loadForm(): SearchQuery {
  try {
    const raw = sessionStorage.getItem(FORM_KEY);
    return raw ? { ...EMPTY_QUERY, ...JSON.parse(raw) } : EMPTY_QUERY;
  } catch {
    return EMPTY_QUERY;
  }
}

function persistForm(q: SearchQuery) {
  try {
    sessionStorage.setItem(FORM_KEY, JSON.stringify(q));
  } catch {
    /* noop */
  }
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useApp = create<AppState>((set, get) => ({
  session: null,
  catalog: null,
  bootError: null,
  form: loadForm(),
  results: {},
  lastSearchId: null,
  compare: [],
  savedSupplierIds: new Set(),
  savedSelectionKeys: new Set(),
  toast: null,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,

  setBoot: (session, catalog) => set({ session, catalog, bootError: null }),
  setBootError: (bootError) => set({ bootError }),
  setForm: (patch) => {
    const form = { ...get().form, ...patch };
    persistForm(form);
    set({ form });
  },
  replaceForm: (q) => {
    persistForm(q);
    set({ form: q });
  },
  cacheResults: (key, r) => set((s) => ({ results: { ...s.results, [key]: r }, lastSearchId: r.searchId })),
  toggleCompare: (sup) => {
    const cur = get().compare;
    if (cur.some((c) => c.id === sup.id)) {
      set({ compare: cur.filter((c) => c.id !== sup.id) });
      return 'removed';
    }
    if (cur.length >= MAX_COMPARE) return 'full';
    set({ compare: [...cur, { id: sup.id, name: sup.name }] });
    return 'added';
  },
  removeCompare: (id) => set((s) => ({ compare: s.compare.filter((c) => c.id !== id) })),
  clearCompare: () => set({ compare: [] }),
  setSavedSuppliers: (ids) => set({ savedSupplierIds: new Set(ids) }),
  markSupplierSaved: (id, saved) =>
    set((s) => {
      const next = new Set(s.savedSupplierIds);
      if (saved) next.add(id);
      else next.delete(id);
      return { savedSupplierIds: next };
    }),
  markSelectionSaved: (key) => set((s) => ({ savedSelectionKeys: new Set(s.savedSelectionKeys).add(key) })),
  showToast: (text, action) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: { id: Date.now(), text, action } });
    toastTimer = setTimeout(() => set({ toast: null }), 3000);
  },
  hideToast: () => set({ toast: null }),
  setOnline: (online) => set({ online }),
}));

export function queryKey(q: SearchQuery): string {
  return JSON.stringify(q);
}

export function encodeQuery(q: SearchQuery): string {
  return new URLSearchParams({ q: JSON.stringify(q) }).toString();
}

export function decodeQuery(search: string): SearchQuery | null {
  const raw = new URLSearchParams(search).get('q');
  if (!raw) return null;
  try {
    return { ...EMPTY_QUERY, ...JSON.parse(raw) };
  } catch {
    return null;
  }
}
