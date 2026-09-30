import { ChevronRight, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api, NetworkError } from '../api/client';
import type { SavedSupplierItem, SelectionItem, SupplierSummary } from '../api/types';
import { EMPTY_QUERY } from '../api/types';
import { BottomSheet } from '../components/BottomSheet';
import { RoleBadge, SupplierCard } from '../components/SupplierCard';
import { Button, CardSkeleton, ICON_S, IconButton, Notice, StateView, StickyActionBar } from '../components/ui';
import { encodeQuery, useApp } from '../store';
import { formatDate, suppliersWord } from '../utils';
import { CompareBar, useSupplierActions } from './Results';

const TYPE_LABEL = { MANUFACTURER: 'Производитель', DISTRIBUTOR: 'Дистрибьютор', SUPPLIER: 'Поставщик', UNKNOWN: 'Тип не определён' } as const;

/** Сохранённые подборки (ТЗ 7.5) и поставщики по MAX ID. */
export function SavedScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const [tab, setTab] = useState<'selections' | 'suppliers'>(new URLSearchParams(location.search).get('tab') === 'suppliers' ? 'suppliers' : 'selections');
  const [selections, setSelections] = useState<SelectionItem[] | null>(null);
  const [suppliers, setSuppliers] = useState<SavedSupplierItem[] | null>(null);
  const [error, setError] = useState<'offline' | 'error' | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'selection' | 'supplier'; id: string; title: string } | null>(null);
  const { showToast, markSupplierSaved } = useApp();

  const load = useCallback(async () => {
    setError(null);
    try {
      const [a, b] = await Promise.all([api.selections(), api.savedSuppliers()]);
      setSelections(a.items);
      setSuppliers(b.items);
    } catch (err) {
      setError(err instanceof NetworkError ? 'offline' : 'error');
    }
  }, []);

  useEffect(() => {
    void load();
    void api.event('saved_opened', null, { from: 'miniapp_list' });
  }, [load]);

  const doDelete = async () => {
    if (!confirm) return;
    try {
      if (confirm.kind === 'selection') {
        await api.deleteSelection(confirm.id);
        setSelections((s) => s?.filter((x) => x.id !== confirm.id) ?? null);
        showToast('Подборка удалена');
      } else {
        await api.removeSupplier(confirm.id);
        markSupplierSaved(confirm.id, false);
        setSuppliers((s) => s?.filter((x) => x.supplierId !== confirm.id) ?? null);
        showToast('Поставщик удалён из сохранённых');
      }
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Не удалось удалить');
    } finally {
      setConfirm(null);
    }
  };

  if (error)
    return (
      <div className="screen">
        <StateView title={error === 'offline' ? 'Нет соединения' : 'Не удалось загрузить'} text="Попробуйте ещё раз.">
          <Button block onClick={load}>
            Повторить
          </Button>
        </StateView>
      </div>
    );

  return (
    <div className="screen">
      <h1 className="t-h1">Сохранённое</h1>
      <p className="t-caption muted" style={{ margin: '4px 0 16px' }}>
        Хранится по вашему MAX ID, без регистрации. В чате бота подборки доступны командой /saved.
      </p>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'selections'} className={`tab ${tab === 'selections' ? 'tab--active' : ''}`} onClick={() => setTab('selections')}>
          Подборки{selections ? ` · ${selections.length}` : ''}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'suppliers'} className={`tab ${tab === 'suppliers' ? 'tab--active' : ''}`} onClick={() => setTab('suppliers')}>
          Поставщики{suppliers ? ` · ${suppliers.length}` : ''}
        </button>
      </div>

      <div className="stack-3" style={{ marginTop: 16 }}>
        {tab === 'selections' &&
          (selections === null ? (
            <>
              <CardSkeleton />
              <CardSkeleton />
            </>
          ) : selections.length === 0 ? (
            <StateView title="Подборок пока нет" text="Найдите поставщиков и нажмите «Сохранить подборку» в выдаче.">
              <Button block onClick={() => navigate('/')}>
                К поиску
              </Button>
            </StateView>
          ) : (
            selections.map((s) => (
              <article className="card" key={s.id}>
                <button type="button" className="supplier-card__name-btn" onClick={() => navigate(`/saved/${s.id}`)}>
                  <div className="t-headline break">{s.title}</div>
                </button>
                <div className="t-caption muted" style={{ marginTop: 4 }}>
                  {s.queryLabel.product}, {s.queryLabel.region} · {s.queryLabel.supplierType}
                  {s.queryLabel.volume ? ` · ${s.queryLabel.volume}` : ''}
                </div>
                <dl className="kv">
                  <dt>Поставщиков</dt>
                  <dd className="num">
                    {s.supplierCount} {suppliersWord(s.supplierCount)}
                  </dd>
                  <dt>Создана</dt>
                  <dd className="num">{formatDate(s.createdAt)}</dd>
                  <dt>Последняя проверка</dt>
                  <dd className="num">{formatDate(s.lastCheckedAt)}</dd>
                </dl>
                <div className="row" style={{ marginTop: 12 }}>
                  <Button variant="secondary" className="grow" onClick={() => navigate(`/saved/${s.id}`)}>
                    Открыть
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirm({ kind: 'selection', id: s.id, title: s.title })}>
                    Удалить
                  </Button>
                </div>
              </article>
            ))
          ))}

        {tab === 'suppliers' &&
          (suppliers === null ? (
            <CardSkeleton />
          ) : suppliers.length === 0 ? (
            <StateView title="Сохранённых поставщиков нет" text="Нажмите «Сохранить» на карточке поставщика в выдаче." />
          ) : (
            <div className="card" style={{ padding: '0 16px' }}>
              {suppliers.map((s) => (
                <div className="list-row" key={s.id}>
                  <button type="button" className="supplier-card__name-btn grow" onClick={() => navigate(`/supplier/${s.supplierId}`)}>
                    <div className="t-strong break">{s.name}</div>
                    <div className="supplier-card__meta">
                      <RoleBadge type={s.supplierType} label={TYPE_LABEL[s.supplierType]} />
                      <span>
                        {s.city ? `${s.city}, ` : ''}
                        {s.region}
                      </span>
                    </div>
                    {s.note && (
                      <div className="t-caption" style={{ marginTop: 4 }}>
                        Заметка: {s.note}
                      </div>
                    )}
                  </button>
                  <IconButton label={`Удалить ${s.name}`} onClick={() => setConfirm({ kind: 'supplier', id: s.supplierId, title: s.name })}>
                    <Trash2 {...ICON_S} />
                  </IconButton>
                  <ChevronRight {...ICON_S} className="list-row__chevron" aria-hidden />
                </div>
              ))}
            </div>
          ))}
      </div>

      <BottomSheet
        open={!!confirm}
        title={confirm?.kind === 'selection' ? 'Удалить подборку?' : 'Удалить поставщика из сохранённых?'}
        onClose={() => setConfirm(null)}
        footer={
          <div className="stack-2">
            <Button block onClick={doDelete}>
              Удалить
            </Button>
            <Button variant="ghost" block onClick={() => setConfirm(null)}>
              Отмена
            </Button>
          </div>
        }
      >
        <p className="t-body">«{confirm?.title}» будет удалено без возможности восстановления.</p>
      </BottomSheet>
    </div>
  );
}

export function SelectionScreen() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { replaceForm, showToast } = useApp();
  const [data, setData] = useState<{ selection: SelectionItem; suppliers: (SupplierSummary & { sources: string[] })[]; warnings: string[]; checkedAt: string } | null>(null);
  const [error, setError] = useState<'offline' | 'error' | 'not_found' | null>(null);
  const [note, setNote] = useState('');
  const [dirty, setDirty] = useState(false);
  const actions = useSupplierActions(null, data?.selection.query ?? null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.selection(id);
      setData(r);
      setNote(r.selection.note ?? '');
    } catch (err) {
      setError(err instanceof NetworkError ? 'offline' : err instanceof ApiError && err.status === 404 ? 'not_found' : 'error');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error)
    return (
      <div className="screen">
        <StateView title={error === 'not_found' ? 'Подборка не найдена' : error === 'offline' ? 'Нет соединения' : 'Не удалось загрузить подборку'} text={error === 'not_found' ? 'Возможно, она удалена.' : 'Попробуйте ещё раз.'}>
          {error !== 'not_found' && (
            <Button block onClick={load}>
              Повторить
            </Button>
          )}
          <Button variant="text" onClick={() => navigate('/saved')}>
            Все подборки
          </Button>
        </StateView>
      </div>
    );

  if (!data)
    return (
      <div className="screen stack-3" aria-busy="true">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );

  const sel = data.selection;
  const rerun = () => {
    const q = { ...EMPTY_QUERY, ...sel.query };
    replaceForm(q);
    navigate(`/results?${encodeQuery(q)}`);
  };

  return (
    <div className={`screen screen--with-bar${actions.compare.length ? '-and-float' : ''}`}>
      <h1 className="t-h1 break">{sel.title}</h1>
      <p className="t-caption muted" style={{ margin: '4px 0 0' }}>
        {sel.queryLabel.product}, {sel.queryLabel.region} · {sel.queryLabel.supplierType}
      </p>
      <p className="t-caption muted num" style={{ margin: '4px 0 16px' }}>
        Создана {formatDate(sel.createdAt)} · сведения обновлены {formatDate(data.checkedAt)}
      </p>
      {data.warnings.map((w) => (
        <div key={w} style={{ marginBottom: 12 }}>
          <Notice tone={w.startsWith('Часть') ? 'warning' : 'info'}>{w}</Notice>
        </div>
      ))}
      <div className="stack-3">
        {data.suppliers.map((s) => (
          <SupplierCard
            key={s.id}
            s={s}
            onOpen={() => actions.open(s)}
            onCompare={() => actions.onCompare(s)}
            inCompare={actions.compare.some((c) => c.id === s.id)}
            onSave={() => actions.onSave(s)}
            saved={actions.savedSupplierIds.has(s.id)}
          />
        ))}
      </div>

      <section className="section">
        <h2 className="t-h2 section__title">Заметка</h2>
        <textarea
          className="input"
          value={note}
          maxLength={1000}
          placeholder="Например: запросить КП у первых двух"
          onChange={(e) => {
            setNote(e.target.value);
            setDirty(true);
          }}
          aria-label="Заметка к подборке"
        />
        {dirty && (
          <Button
            variant="secondary"
            block
            style={{ marginTop: 8 }}
            onClick={async () => {
              try {
                await api.updateSelection(id, { note: note.trim() || null });
                setDirty(false);
                showToast('Заметка сохранена');
              } catch {
                showToast('Не удалось сохранить заметку');
              }
            }}
          >
            Сохранить заметку
          </Button>
        )}
      </section>

      <CompareBar query={sel.query} />
      <StickyActionBar>
        <Button block variant="secondary" tall icon={<RefreshCw size={20} strokeWidth={2} aria-hidden />} onClick={rerun}>
          Повторить поиск
        </Button>
      </StickyActionBar>
    </div>
  );
}
