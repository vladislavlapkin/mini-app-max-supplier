import { Check, CheckCircle2, MinusCircle, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Catalog, Provenance, SourceStatus, SupplierSummary } from '../api/types';
import { api } from '../api/client';
import { useApp } from '../store';
import { BottomSheet } from './BottomSheet';
import { Button, ICON_S, Notice, ProvenanceLine } from './ui';

export function RegionSheet({ open, catalog, value, onSelect, onClose }: { open: boolean; catalog: Catalog; value: string | null; onSelect: (code: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const regions = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/ё/g, 'е');
    const all = catalog.regions;
    const pilot = catalog.pilotRegions;
    const sorted = [...all].sort((a, b) => {
      const ra = a.code === 'RU' ? 0 : pilot.includes(a.code) ? 1 : 2;
      const rb = b.code === 'RU' ? 0 : pilot.includes(b.code) ? 1 : 2;
      return ra - rb || a.name.localeCompare(b.name, 'ru');
    });
    return needle ? sorted.filter((r) => r.name.toLowerCase().replace(/ё/g, 'е').includes(needle)) : sorted;
  }, [q, catalog]);

  return (
    <BottomSheet open={open} title="Регион" onClose={onClose}>
      <div className="input-wrap" style={{ marginBottom: 8 }}>
        <input className="input" placeholder="Поиск по названию" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск региона" />
        <Search {...ICON_S} className="input-wrap__clear" style={{ top: 16, right: 14, color: 'var(--text-secondary)' }} aria-hidden />
      </div>
      <div role="listbox" aria-label="Регионы">
        {regions.map((r) => (
          <button
            key={r.code}
            type="button"
            role="option"
            aria-selected={value === r.code}
            className="list-row"
            onClick={() => {
              onSelect(r.code);
              onClose();
            }}
          >
            <span className="grow">
              {r.name}
              {catalog.pilotRegions.includes(r.code) && <span className="t-caption muted"> · пилотный регион</span>}
            </span>
            {value === r.code && <Check {...ICON_S} color="var(--brand-blue)" aria-hidden />}
          </button>
        ))}
        {!regions.length && <p className="muted">Регион не найден. Попробуйте другое написание.</p>}
      </div>
    </BottomSheet>
  );
}

/** Источники по поставщику из выдачи: что, откуда и на какую дату. */
export function SourcesSheet({ s, onClose, onDetails }: { s: SupplierSummary | null; onClose: () => void; onDetails: () => void }) {
  if (!s) return null;
  const rows: { label: string; p: Provenance | null }[] = [
    { label: `Статус деятельности: ${s.legalStatus.label.toLowerCase()}`, p: s.legalStatus.provenance },
    { label: `МСП: ${s.sme.label.toLowerCase()}`, p: s.sme.provenance },
  ];
  if (s.gisp.found) rows.push({ label: `ГИСП: найдено записей — ${s.gisp.records}`, p: s.gisp.provenance });
  for (const d of s.documents.items) rows.push({ label: `${d.type === 'DECLARATION' ? 'Декларация' : 'Сертификат'} ${d.number}: ${d.statusLabel.toLowerCase()}`, p: d.provenance });
  for (const r of s.risks) rows.push({ label: r.title, p: r.provenance });
  return (
    <BottomSheet
      open
      title="Источники"
      onClose={onClose}
      footer={
        <Button variant="secondary" block tall onClick={onDetails}>
          Все источники и ограничения
        </Button>
      }
    >
      <p className="t-caption muted" style={{ marginTop: 0 }}>
        {s.name}. Для каждого факта указаны источник, тип данных и дата проверки.
      </p>
      {s.isManualTestData ? (
        <Notice tone="warning">Сведения из ручной тестовой базы: в официальных реестрах этих вымышленных компаний нет.</Notice>
      ) : (
        <Notice tone="info">Официальные открытые данные ФНС. ЕГРЮЛ, ГИСП, Росаккредитация и РНП для этой компании не подключены — проверьте их по ссылкам в карточке.</Notice>
      )}
      <div style={{ marginTop: 8 }}>
        {rows.map((r, i) => (
          <div className="fact" key={i} style={{ paddingLeft: 0, paddingRight: 0 }}>
            <div className="fact__value">{r.label}</div>
            <ProvenanceLine p={r.p} />
          </div>
        ))}
      </div>
    </BottomSheet>
  );
}

export function SourceProgress({ statuses, done }: { statuses: SourceStatus[] | null; done: boolean }) {
  const session = useApp((s) => s.session);
  const real = session?.data?.mode === 'real' && !!session.data.imports.length;
  const imported = new Set(session?.data?.imports.map((i) => i.source) ?? []);
  const list = [
    { id: 'SME_REGISTRY', name: 'ФНС: реестр МСП' },
    { id: 'FNS_PB', name: 'ФНС: налоги и отчётность' },
    { id: 'FNS_EGRUL', name: 'ЕГРЮЛ: статус компаний' },
    { id: 'GISP', name: 'Каталог ГИСП' },
    { id: 'FSA_DECL', name: 'Декларации и сертификаты' },
    { id: 'FAS_RNP', name: 'РНП и ЕФРСБ' },
  ];
  return (
    <div className="card" aria-live="polite">
      {list.map((row) => {
        const notConnected = real && !imported.has(row.id) && row.id !== 'FNS_PB';
        const st = statuses?.find((s) => s.id === row.id);
        const failed = !notConnected && done && st && st.status !== 'ok';
        const ok = !notConnected && done && (!st || st.status === 'ok');
        return (
          <div key={row.id} className={`source-row ${ok ? 'source-row--ok' : ''} ${failed ? 'source-row--failed' : ''}`}>
            {ok ? (
              <CheckCircle2 {...ICON_S} color="var(--success)" aria-hidden />
            ) : failed ? (
              <CheckCircle2 {...ICON_S} color="var(--warning-icon)" aria-hidden />
            ) : notConnected ? (
              <MinusCircle {...ICON_S} color="var(--text-disabled)" aria-hidden />
            ) : (
              <span className="pulse" aria-hidden />
            )}
            <span className={`t-body ${notConnected ? 'muted' : ''}`}>{row.name}</span>
            <span className="source-row__status">{notConnected ? 'Не подключён' : ok ? 'Готово' : failed ? 'Не ответил' : 'Ищем'}</span>
          </div>
        );
      })}
    </div>
  );
}

export function MissingProductSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const toast = useApp((s) => s.showToast);
  return (
    <BottomSheet
      open={open}
      title="Нет вашего товара?"
      onClose={onClose}
      footer={
        <Button
          block
          loading={sending}
          disabled={text.trim().length < 2}
          onClick={async () => {
            setSending(true);
            try {
              await api.feedback(text.trim());
              toast('Спасибо. Добавим категорию в следующих версиях');
              setText('');
              onClose();
            } catch {
              toast('Не удалось отправить. Попробуйте ещё раз');
            } finally {
              setSending(false);
            }
          }}
        >
          Отправить
        </Button>
      }
    >
      <label className="field__label" htmlFor="missing-product">
        Какой товар ищете?
      </label>
      <input id="missing-product" className="input" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder="Например, керамогранит" />
      <p className="field__hint">Сейчас в базе строительные и отделочные материалы. Запрос поможет выбрать следующие категории.</p>
    </BottomSheet>
  );
}
