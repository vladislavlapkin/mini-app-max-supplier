import { AlertTriangle, Check, CheckCircle2, ExternalLink, Info, OctagonX } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { Provenance, Reason } from '../api/types';
import { openExternal } from '../bridge';
import { useApp } from '../store';
import { formatDate } from '../utils';

export const ICON = { size: 24, strokeWidth: 1.75 } as const;
export const ICON_S = { size: 20, strokeWidth: 1.75 } as const;
export const ICON_XS = { size: 16, strokeWidth: 2 } as const;

type ButtonVariant = 'primary' | 'secondary' | 'text' | 'ghost';

export function Button({
  variant = 'primary',
  block,
  loading,
  icon,
  tall,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; block?: boolean; loading?: boolean; icon?: ReactNode; tall?: boolean }) {
  return (
    <button
      type="button"
      className={`btn btn--${variant} ${block ? 'btn--block' : ''} ${tall ? 'btn--tall' : ''} ${className}`}
      aria-busy={loading || undefined}
      {...rest}
      disabled={rest.disabled || loading}
    >
      {loading ? <span className="btn__spinner" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, active, filled, large, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; filled?: boolean; large?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`icon-btn ${active ? 'icon-btn--active' : ''} ${filled ? 'icon-btn--filled' : ''} ${large ? 'icon-btn--large' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function StickyActionBar({ children, side }: { children: ReactNode; side?: ReactNode }) {
  return (
    <div className="action-bar">
      <div className="action-bar__main">{children}</div>
      {side}
    </div>
  );
}

export function Chip({ selected, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button type="button" className={`chip ${selected ? 'chip--selected' : ''}`} aria-pressed={selected} {...rest}>
      {selected && <Check size={16} strokeWidth={2} aria-hidden />}
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle">
      <span className="toggle__text">
        <span className="t-strong">{label}</span>
        {hint && <span className="field__hint" style={{ display: 'block' }}>{hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle__switch" aria-hidden />
    </label>
  );
}

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'warning' | 'danger'; title?: string; children: ReactNode }) {
  const Icon = tone === 'info' ? Info : tone === 'warning' ? AlertTriangle : OctagonX;
  return (
    <div className={`notice notice--${tone}`} role={tone === 'info' ? 'note' : 'alert'}>
      <Icon {...ICON_S} aria-hidden />
      <div>
        {title && <div className="notice__title">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function BrandSquares({ size = 20, row }: { size?: number; row?: boolean }) {
  return (
    <div className={`squares ${row ? 'squares--row' : ''}`} style={{ ['--sq' as string]: `${size}px` }} aria-hidden>
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

export function Skeleton({ h = 16, w = '100%', r }: { h?: number; w?: number | string; r?: number }) {
  return <div className="skeleton" style={{ height: h, width: w, borderRadius: r }} aria-hidden />;
}

export function CardSkeleton() {
  return (
    <div className="card stack-2" aria-hidden>
      <Skeleton h={20} w="75%" />
      <Skeleton h={14} w="50%" />
      <Skeleton h={14} w="60%" />
      <div className="row" style={{ gap: 6 }}>
        <Skeleton h={24} w={64} r={12} />
        <Skeleton h={24} w={80} r={12} />
        <Skeleton h={24} w={72} r={12} />
      </div>
    </div>
  );
}

export function StateView({ title, text, children }: { title: string; text?: ReactNode; children?: ReactNode }) {
  return (
    <div className="state-view fade-in">
      <BrandSquares size={28} />
      <h2 className="t-headline" style={{ marginTop: 8 }}>
        {title}
      </h2>
      {text && <div className="t-body muted">{text}</div>}
      {children && <div className="state-view__actions">{children}</div>}
    </div>
  );
}

export function Section({ title, children, tone, id }: { title: string; children: ReactNode; tone?: 'sky'; id?: string }) {
  return (
    <section className={`section ${tone === 'sky' ? 'section--sky' : ''}`} aria-labelledby={id}>
      <h2 className="t-h2 section__title" id={id}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Строка происхождения факта: источник, дата, тип данных. */
export function ProvenanceLine({ p, compact, empty }: { p: Provenance | null | undefined; compact?: boolean; empty?: string }) {
  if (!p) return <div className="prov">{empty ?? 'Источник: нет данных'}</div>;
  return (
    <div className="prov">
      <span>{p.sourceName}</span>
      <span aria-hidden>·</span>
      <span className="num">{formatDate(p.checkedAt)}</span>
      {p.isManualTestData && <span className="badge badge--test">тестовые данные</span>}
      {p.isOfficial && <span className="badge badge--ok">официальный источник</span>}
      {p.stale && <span className="prov__stale">требует обновления</span>}
      {!compact && p.sourceUrl && (
        <a
          href={p.sourceUrl}
          onClick={(e) => {
            e.preventDefault();
            openExternal(p.sourceUrl!);
          }}
        >
          Открыть источник
        </a>
      )}
    </div>
  );
}

export function FactRow({ label, value, p, empty }: { label: string; value: ReactNode; p?: Provenance | null; empty?: string }) {
  return (
    <div className="fact">
      <div className="fact__label">{label}</div>
      <div className="fact__value">{value ?? '—'}</div>
      {p !== undefined && <ProvenanceLine p={p} compact empty={empty} />}
    </div>
  );
}

export function ReasonList({ reasons, limit }: { reasons: Reason[]; limit?: number }) {
  const shown = limit ? reasons.slice(0, limit) : reasons;
  return (
    <ul className="reasons">
      {shown.map((r, i) => (
        <li key={i} className={`reason--${r.kind}`}>
          {r.kind === 'ok' ? <CheckCircle2 size={18} strokeWidth={1.75} aria-label="подтверждено" /> : r.kind === 'warn' ? <AlertTriangle size={18} strokeWidth={1.75} aria-label="внимание" /> : <Info size={18} strokeWidth={1.75} aria-hidden />}
          <span>{r.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function ExternalLinkButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <button type="button" className="list-row" onClick={() => openExternal(href)}>
      <ExternalLink {...ICON_S} className="list-row__icon" aria-hidden />
      <span className="grow">{children}</span>
    </button>
  );
}

export function ToastHost() {
  const toast = useApp((s) => s.toast);
  const hide = useApp((s) => s.hideToast);
  if (!toast) return null;
  return (
    <div className="toast" role="status" aria-live="polite" key={toast.id}>
      <span className="grow">{toast.text}</span>
      {toast.action && (
        <button
          type="button"
          className="toast__action"
          onClick={() => {
            toast.action!.run();
            hide();
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
