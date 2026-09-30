import { AlertTriangle, BadgeCheck, Bookmark, BookmarkCheck, Building2, CheckCircle2, ChevronDown, ChevronUp, Factory, FileCheck2, FileSearch, OctagonX, Scale, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { SupplierSummary, SupplierType } from '../api/types';
import { formatDate } from '../utils';
import { ReasonList } from './ui';

export function RoleBadge({ type, label }: { type: SupplierType; label: string }) {
  const cls = type === 'MANUFACTURER' ? 'badge--role-manufacturer' : type === 'UNKNOWN' ? 'badge--role-unknown' : '';
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function EvidenceBadges({ s, max = 4 }: { s: SupplierSummary; max?: number }) {
  const items: { key: string; icon: JSX.Element; text: string; title: string }[] = [];
  if (s.gisp.found) items.push({ key: 'gisp', icon: <Factory size={14} strokeWidth={2} />, text: 'ГИСП', title: 'Продукция найдена в каталоге ГИСП' });
  if (s.gisp.pp719) items.push({ key: 'pp719', icon: <ShieldCheck size={14} strokeWidth={2} />, text: 'ПП РФ №719', title: 'Продукция в реестре российской промышленной продукции' });
  const decl = s.documents.items.find((d) => d.type === 'DECLARATION' && d.isActive && d.match !== 'other');
  const cert = s.documents.items.find((d) => d.type === 'CERTIFICATE' && d.isActive && d.match !== 'other');
  if (decl) items.push({ key: 'decl', icon: <FileCheck2 size={14} strokeWidth={2} />, text: 'Декларация', title: 'Декларация о соответствии на товар' });
  if (cert) items.push({ key: 'cert', icon: <BadgeCheck size={14} strokeWidth={2} />, text: 'Сертификат', title: 'Сертификат на товар' });
  if (['MICRO', 'SMALL', 'MEDIUM'].includes(s.sme.value)) items.push({ key: 'sme', icon: <Building2 size={14} strokeWidth={2} />, text: 'МСП', title: s.sme.label });
  if (!items.length) return null;
  return (
    <div className="badges">
      {items.slice(0, max).map((i) => (
        <span className="badge" key={i.key} title={i.title}>
          {i.icon}
          {i.text}
        </span>
      ))}
    </div>
  );
}

export function LegalStatusLine({ s }: { s: SupplierSummary }) {
  const ls = s.legalStatus;
  if (ls.value === 'INACTIVE')
    return (
      <div className="status-line status-line--danger">
        <OctagonX size={16} strokeWidth={2} aria-hidden /> Деятельность прекращена
      </div>
    );
  if (!ls.refreshed)
    return (
      <div className="status-line status-line--warn">
        <AlertTriangle size={16} strokeWidth={2} aria-hidden /> Статус на {formatDate(ls.provenance?.checkedAt)} — ЕГРЮЛ сейчас недоступен
      </div>
    );
  if (ls.value === 'UNKNOWN')
    return (
      <div className="status-line status-line--warn">
        <AlertTriangle size={16} strokeWidth={2} aria-hidden /> Статус деятельности не подтверждён
      </div>
    );
  const source = ls.provenance?.source === 'SME_REGISTRY' ? 'реестр МСП' : s.entityType === 'IP' ? 'ЕГРИП' : 'ЕГРЮЛ';
  return (
    <div className="status-line status-line--ok">
      <CheckCircle2 size={16} strokeWidth={2} aria-hidden /> {ls.label}
      <span className="muted" style={{ fontWeight: 400 }}>
        · {source}
      </span>
    </div>
  );
}

const REGION_NOTE: Record<SupplierSummary['regionMatch'], string | null> = { same: null, any: null, neighbor: 'соседний регион', other: 'другой регион' };

interface Props {
  s: SupplierSummary;
  onOpen: () => void;
  onCompare?: () => void;
  inCompare?: boolean;
  onSave?: () => void;
  saved?: boolean;
  onSources?: () => void;
  reasonsOpen?: boolean;
  rank?: number;
}

/** Карточка результата (ТЗ 7.2): тип, регион, товар, статус деятельности, МСП, ГИСП, документы, дата проверки. */
export function SupplierCard({ s, onOpen, onCompare, inCompare, onSave, saved, onSources, reasonsOpen = false, rank }: Props) {
  const [open, setOpen] = useState(reasonsOpen);
  const regionNote = REGION_NOTE[s.regionMatch];
  const warnCount = s.reasons.filter((r) => r.kind === 'warn').length;
  return (
    <article className="card supplier-card" aria-label={s.name}>
      <div className="supplier-card__head">
        {rank !== undefined && (
          <span className="supplier-card__rank num" aria-hidden>
            {String(rank).padStart(2, '0')}
          </span>
        )}
        <h3 className="supplier-card__name">
          <button type="button" className="supplier-card__name-btn" onClick={onOpen}>
            {s.name}
          </button>
        </h3>
      </div>
      <div className="supplier-card__meta">
        <RoleBadge type={s.supplierType} label={s.supplierTypeLabel} />
        <span>
          {s.city ? `${s.city}, ` : ''}
          {s.region.name}
        </span>
        {regionNote && <span className="badge badge--warn">{regionNote}</span>}
      </div>
      <div className="stack-2 supplier-card__body">
        <LegalStatusLine s={s} />
        {s.product.titles.length > 0 && (
          <div className="t-caption">
            <span className="muted">Товар: </span>
            {s.product.titles.slice(0, 2).join('; ')}
            {s.product.titles.length > 2 ? ` и ещё ${s.product.titles.length - 2}` : ''}
          </div>
        )}
        <EvidenceBadges s={s} />
        {s.risks.length > 0 && (
          <div className="status-line status-line--danger" style={{ fontWeight: 500 }}>
            <AlertTriangle size={16} strokeWidth={2} aria-hidden />
            Официальный факт: {s.risks[0].title.toLowerCase()}
          </div>
        )}
        <div className="t-caption muted num">
          Дата проверки {formatDate(s.checkedAt)}
          {s.isManualTestData ? ' · тестовые данные' : ''}
        </div>
      </div>

      <div className="disclosure">
        <button type="button" className="disclosure__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span>
            Почему в подборке{warnCount ? ` · ${warnCount} ${warnCount === 1 ? 'момент' : warnCount < 5 ? 'момента' : 'моментов'} проверить` : ''}
          </span>
          {open ? <ChevronUp size={18} strokeWidth={2} /> : <ChevronDown size={18} strokeWidth={2} />}
        </button>
        {open && <ReasonList reasons={s.reasons} />}
      </div>

      <div className="supplier-card__actions">
        <button type="button" className="card-action" onClick={onOpen}>
          <FileSearch size={20} strokeWidth={1.75} aria-hidden />
          Подробнее
        </button>
        {onCompare && (
          <button type="button" className={`card-action ${inCompare ? 'card-action--active' : ''}`} onClick={onCompare} aria-pressed={inCompare}>
            <Scale size={20} strokeWidth={1.75} aria-hidden />
            {inCompare ? 'В сравнении' : 'Сравнить'}
          </button>
        )}
        {onSave && (
          <button type="button" className={`card-action ${saved ? 'card-action--active' : ''}`} onClick={onSave} aria-pressed={saved} aria-label={saved ? 'Убрать из сохранённых' : 'Сохранить поставщика'}>
            {saved ? <BookmarkCheck size={20} strokeWidth={1.75} aria-hidden /> : <Bookmark size={20} strokeWidth={1.75} aria-hidden />}
            {saved ? 'Сохранено' : 'Сохранить'}
          </button>
        )}
        {onSources && (
          <button type="button" className="card-action" onClick={onSources}>
            <FileCheck2 size={20} strokeWidth={1.75} aria-hidden />
            Источники
          </button>
        )}
      </div>
    </article>
  );
}
