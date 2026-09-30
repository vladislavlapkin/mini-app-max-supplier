/**
 * Обёртка над MAX Bridge (window.WebApp, https://dev.max.ru/docs/webapps/bridge)
 * с запасным поведением для обычного браузера (демо-режим).
 */

interface WebAppApi {
  initData?: string;
  initDataUnsafe?: { start_param?: string; user?: { id: number; first_name?: string } };
  platform?: 'ios' | 'android' | 'desktop' | 'web';
  version?: string;
  ready?: () => void;
  close?: () => void;
  openLink?: (url: string) => void;
  openMaxLink?: (url: string) => void;
  shareMaxContent?: (p: { text?: string; link?: string }) => Promise<unknown> | void;
  getViewportSize?: () => { width: number; height: number };
  BackButton?: { show: () => void; hide: () => void; onClick: (cb: () => void) => void; offClick: (cb: () => void) => void; isVisible?: boolean };
  HapticFeedback?: {
    impactOccurred: (style: 'soft' | 'light' | 'medium' | 'heavy' | 'rigid') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
    selectionChanged: () => void;
  };
}

declare global {
  interface Window {
    WebApp?: WebAppApi;
  }
}

const wa = (): WebAppApi | undefined => window.WebApp;

/** В MAX initData непустой; сам скрипт bridge может загрузиться и в браузере. */
export function isInMax(): boolean {
  return !!wa()?.initData;
}

export function ready(): void {
  try {
    wa()?.ready?.();
  } catch {
    /* noop */
  }
}

export function getInitData(): string {
  return wa()?.initData ?? '';
}

export function getStartParam(): string | null {
  const fromMax = wa()?.initDataUnsafe?.start_param;
  if (fromMax) return fromMax;
  const url = new URL(window.location.href);
  return url.searchParams.get('startapp') ?? url.searchParams.get('WebAppStartParam');
}

export function platform(): string {
  return wa()?.platform ?? 'browser';
}

// ── Кнопка «Назад»: системная в MAX, отладочная панель в браузере ────────────
type Listener = () => void;
const backListeners = new Set<Listener>();
const visibilityListeners = new Set<(v: boolean) => void>();
let backVisible = false;
let nativeHandler: Listener | null = null;

export const backButton = {
  show() {
    backVisible = true;
    wa()?.BackButton?.show();
    visibilityListeners.forEach((l) => l(true));
  },
  hide() {
    backVisible = false;
    wa()?.BackButton?.hide();
    visibilityListeners.forEach((l) => l(false));
  },
  onClick(cb: Listener) {
    backListeners.add(cb);
    if (!nativeHandler && wa()?.BackButton) {
      nativeHandler = () => backListeners.forEach((l) => l());
      wa()!.BackButton!.onClick(nativeHandler);
    }
  },
  offClick(cb: Listener) {
    backListeners.delete(cb);
  },
  /** Для отладочной панели в браузере. */
  press() {
    backListeners.forEach((l) => l());
  },
  get visible() {
    return backVisible;
  },
  subscribe(l: (v: boolean) => void) {
    visibilityListeners.add(l);
    return () => visibilityListeners.delete(l);
  },
};

// ── Тактильный отклик: только на телефонах ──────────────────────────────────
export function haptic(type: 'success' | 'selection' | 'error' | 'light'): void {
  const p = wa()?.platform;
  const h = wa()?.HapticFeedback;
  if (!h || (p !== 'ios' && p !== 'android')) return;
  try {
    if (type === 'selection') h.selectionChanged();
    else if (type === 'light') h.impactOccurred('light');
    else h.notificationOccurred(type);
  } catch {
    /* noop */
  }
}

/** Внешние ссылки (сайты, реестры) — через openLink; только по нажатию пользователя. */
export function openExternal(url: string): void {
  if (/^https?:\/\/(www\.)?max\.ru\//.test(url) && wa()?.openMaxLink) {
    wa()!.openMaxLink!(url);
    return;
  }
  if (isInMax() && wa()?.openLink) {
    wa()!.openLink!(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/** Поделиться в чат MAX: shareMaxContent в MAX, в браузере — копирование текста. */
export async function shareToChat(text: string, link?: string): Promise<'shared' | 'copied' | 'failed'> {
  if (isInMax() && wa()?.shareMaxContent) {
    try {
      await wa()!.shareMaxContent!({ text, link });
      return 'shared';
    } catch {
      /* fallthrough */
    }
  }
  return (await copyText(link ? `${text}\n${link}` : text)) ? 'copied' : 'failed';
}
