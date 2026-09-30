import { BookmarkCheck, BookmarkPlus, Scale } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError, api, NetworkError } from '../api/client';
import type { SearchQuery, SearchResponse, SupplierSummary } from '../api/types';
import { EMPTY_QUERY } from '../api/types';
import { haptic } from '../bridge';
import { SourceProgress, SourcesSheet } from '../components/sheets';
import { SupplierCard } from '../components/SupplierCard';
import { Button, CardSkeleton, Chip, Notice, StateView, StickyActionBar } from '../components/ui';
import { decodeQuery, encodeQuery, MAX_COMPARE, queryKey, useApp } from '../store';
import { formatDate, suppliersWord } from '../utils';

const MIN_LOADING_MS = 1200;

export function useSupplierActions(searchId: string | null, query: SearchQuery | null) {
  const navigate = useNavigate();
  const { compare, toggleCompare, savedSupplierIds, markSupplierSaved, showToast } = useApp();

  const open = (s: SupplierSummary) => {
    void api.event('card_opened', searchId, { supplierId: s.id });
    navigate(`/supplier/${s.id}${query ? `?${encodeQuery(query)}` : ''}`);
  };
  const onCompare = (s: SupplierSummary) => {
    const r = toggleCompare(s);
    if (r === 'full') showToast(`Сравнить можно до ${MAX_COMPARE} поставщиков. Уберите одного, чтобы добавить нового`);
    else haptic('selection');
  };
  const onSave = async (s: SupplierSummary) => {
    const saved = savedSupplierIds.has(s.id);
    markSupplierSaved(s.id, !saved);
    try {
      if (saved) {
        await api.removeSupplier(s.id);
        showToast('Поставщик убран из сохранённых', {
          label: 'Вернуть',
          run: () => {
            markSupplierSaved(s.id, true);
            void api.saveSupplier(s.id, { query });
          },
        });
      } else {
        await api.saveSupplier(s.id, { query }, searchId ?? undefined);
        haptic('success');
        showToast('Поставщик сохранён', { label: 'Открыть', run: () => navigate('/saved?tab=suppliers') });
      }
    } catch (err) {
      markSupplierSaved(s.id, saved);
      showToast(err instanceof ApiError ? err.message : 'Не удалось сохранить. Проверьте соединение');
    }
  };
  return { open, onCompare, onSave, compare, savedSupplierIds };
}

export function CompareBar({ query, low }: { query: SearchQuery | null; low?: boolean }) {
  const navigate = useNavigate();
  const compare = useApp((s) => s.compare);
  if (!compare.length) return null;
  return (
    <div className={`float-bar ${low ? 'float-bar--low' : ''}`}>
      <span className="counter">{compare.length}</span>
      <span className="grow t-body">{compare.length === 1 ? 'Добавьте ещё одного для сравнения' : `Выбрано для сравнения: ${compare.length}`}</span>
      <Button
        variant="secondary"
        disabled={compare.length < 2}
        icon={<Scale size={18} strokeWidth={2} aria-hidden />}
        onClick={() => {
          void api.event('compare_opened', null, { count: compare.length });
          navigate(`/compare?ids=${compare.map((c) => c.id).join(',')}${query ? `&${encodeQuery(query)}` : ''}`);
        }}
      >
        Сравнить
      </Button>
    </div>
  );
}

/** Экран результатов (ТЗ 7.2): число найденных, активные фильтры, дата актуализации, недоступные источники. */
export function ResultsScreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const { catalog, results, cacheResults, replaceForm, savedSelectionKeys, markSelectionSaved, showToast, online } = useApp();
  const query = useMemo(() => decodeQuery(location.search), [location.search]);
  const key = query ? queryKey(query) : '';
  const cached = key ? results[key] : undefined;
  const [data, setData] = useState<SearchResponse | undefined>(cached);
  const [phase, setPhase] = useState<'loading' | 'done' | 'error' | 'offline'>(cached ? 'done' : 'loading');
  const [errorText, setErrorText] = useState('');
  const [sourcesFor, setSourcesFor] = useState<SupplierSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<SearchResponse['sources'] | null>(null);
  const actions = useSupplierActions(data?.searchId ?? null, data?.query ?? query);

  const load = useCallback(async () => {
    if (!query) return;
    setPhase('loading');
    setProgress(null);
    const started = Date.now();
    try {
      const res = await api.search(query);
      const wait = MIN_LOADING_MS - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      // Короткая пауза, чтобы показать итог по источникам
      setProgress(res.sources);
      await new Promise((r) => setTimeout(r, 350));
      cacheResults(key, res);
      setData(res);
      setPhase('done');
    } catch (err) {
      setErrorText(err instanceof ApiError ? err.message : '');
      setPhase(err instanceof NetworkError ? 'offline' : 'error');
    }
  }, [query, key, cacheResults]);

  useEffect(() => {
    if (!query) {
      navigate('/', { replace: true });
      return;
    }
    const c = results[key];
    if (c) {
      setData(c);
      setPhase('done');
    } else void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!query || !catalog) return null;

  const patch = (p: Partial<SearchQuery>) => {
    const next = { ...query, ...p };
    void api.event('filters_changed', data?.searchId ?? null, { patch: Object.keys(p) });
    replaceForm(next);
    navigate(`/results?${encodeQuery(next)}`, { replace: true });
  };

  const category = catalog.categories.find((c) => c.id === (data?.query.categoryId ?? query.categoryId));
  const regionSet = !!query.regionCode && query.regionCode !== 'RU';
  const selectionSaved = savedSelectionKeys.has(key);

  const saveSelection = async () => {
    if (!data || !data.results.length) return;
    setSaving(true);
    try {
      await api.saveSelection({ query: data.query, supplierIds: data.results.map((r) => r.id) }, data.searchId);
      markSelectionSaved(key);
      haptic('success');
      showToast('Подборка сохранена. Открыть её можно командой /saved', { label: 'Открыть', run: () => navigate('/saved') });
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Не удалось сохранить подборку');
    } finally {
      setSaving(false);
    }
  };

  const quickFilters = (
    <div className="chips chips--scroll" role="group" aria-label="Фильтры">
      <Chip selected={query.supplierType === 'MANUFACTURER_ONLY'} onClick={() => patch({ supplierType: query.supplierType === 'MANUFACTURER_ONLY' ? 'ANY' : 'MANUFACTURER_ONLY' })}>
        Только производитель
      </Chip>
      <Chip selected={query.certificate === 'REQUIRED'} onClick={() => patch({ certificate: query.certificate === 'REQUIRED' ? 'PREFERRED' : 'REQUIRED' })}>
        Нужны документы
      </Chip>
      {regionSet && (
        <Chip selected={query.strictRegion} onClick={() => patch({ strictRegion: !query.strictRegion })}>
          Строго в регионе
        </Chip>
      )}
      {(!category || category.industrial) && (
        <Chip selected={query.russianOnly} onClick={() => patch({ russianOnly: !query.russianOnly })}>
          ПП РФ №719
        </Chip>
      )}
    </div>
  );

  if (phase === 'loading') {
    return (
      <div className="screen stack-4" aria-busy="true">
        <h1 className="t-h1">Ищем поставщиков</h1>
        <p className="t-body muted" style={{ margin: 0 }}>
          Сверяем сведения по источникам. Обычно это занимает несколько секунд.
        </p>
        <SourceProgress statuses={progress} done={!!progress} />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <Button variant="text" onClick={() => navigate('/')}>
          Отменить
        </Button>
      </div>
    );
  }

  if (phase === 'offline' || (!online && !data)) {
    return (
      <div className="screen">
        <StateView title="Нет соединения" text="Проверьте интернет и попробуйте ещё раз.">
          <Button block onClick={load}>
            Повторить
          </Button>
        </StateView>
      </div>
    );
  }

  if (phase === 'error' || !data) {
    return (
      <div className="screen">
        <StateView title="Не удалось загрузить выдачу" text={errorText || 'Попробуйте ещё раз через минуту.'}>
          <Button block onClick={load}>
            Повторить
          </Button>
          <Button variant="text" onClick={() => navigate('/')}>
            Изменить параметры
          </Button>
        </StateView>
      </div>
    );
  }

  const failed = data.sources.filter((s) => s.status === 'failed');
  const label = data.queryLabel;
  const withBar = data.results.length > 0;

  return (
    <div className={`screen ${withBar ? (actions.compare.length ? 'screen--with-bar-and-float' : 'screen--with-bar') : ''}`}>
      <h1 className="t-display num">
        {data.results.length ? (
          <>
            <span className="accent">{data.total.toLocaleString('ru-RU')}</span> {suppliersWord(data.total)}
          </>
        ) : (
          'Ничего не найдено'
        )}
      </h1>
      <div className="row row--between" style={{ marginTop: 4 }}>
        <span className="t-caption muted grow">
          {label.product}, {label.region}
          {label.volume ? `, ${label.volume}` : ''}
        </span>
        <Button
          variant="text"
          onClick={() => {
            replaceForm({ ...EMPTY_QUERY, ...data.query });
            navigate('/');
          }}
        >
          Изменить
        </Button>
      </div>

      <div style={{ marginTop: 8 }}>{quickFilters}</div>

      <div className="t-caption muted num" style={{ marginTop: 8 }}>
        {data.dataDate ? `Данные на ${formatDate(data.dataDate)}` : 'Нет данных'}
        {data.total > data.results.length ? ` · показаны ${data.results.length} лучших из ${data.total}` : ''}
        {' · '}
        {label.supplierType}
      </div>

      <div className="stack-3" style={{ marginTop: 16 }}>
        {failed.length > 0 && (
          <Notice tone="warning" title="Часть сведений сейчас недоступна">
            Мы показали результаты по другим источникам. Дата последней успешной проверки указана в карточке. Не ответили: {failed.map((f) => f.name).join(', ')}.
          </Notice>
        )}
        {data.warnings
          .filter((w) => !w.startsWith('Часть сведений') && !w.startsWith('Демо'))
          .map((w) => (
            <Notice key={w} tone="info">
              {w}
            </Notice>
          ))}
        {data.demo && <Notice tone="info">Тестовые данные: сведения из ручной базы, а не из официальных реестров.</Notice>}
      </div>

      {data.empty ? (
        <StateView title={data.empty.reason === 'product_not_recognized' ? 'Не нашли такой товар' : 'По запросу ничего не найдено'} text={data.empty.reason === 'product_not_recognized' ? data.empty.message : 'Попробуйте:'}>
          {data.empty.actions.map((a) => {
            if (a.patch)
              return (
                <Button key={a.id} variant="secondary" block tall onClick={() => patch(a.patch!)}>
                  {a.label}
                </Button>
              );
            if (a.id === 'pick_category')
              return (
                <div key={a.id} style={{ textAlign: 'left', marginTop: 8 }}>
                  <div className="field__label">{a.label}</div>
                  <div className="chips">
                    {a.categories?.map((c) => (
                      <Chip key={c.id} onClick={() => patch({ categoryId: c.id, productId: null, text: c.name.toLowerCase() })}>
                        {c.name}
                      </Chip>
                    ))}
                  </div>
                </div>
              );
            if (a.id === 'edit_product')
              return (
                <Button
                  key={a.id}
                  variant="ghost"
                  block
                  onClick={() => {
                    replaceForm({ ...data.query, text: '', productId: null, categoryId: null });
                    navigate('/#product');
                  }}
                >
                  {a.label}
                </Button>
              );
            return (
              <Button
                key={a.id}
                variant="text"
                onClick={() => {
                  replaceForm(EMPTY_QUERY);
                  navigate('/');
                }}
              >
                {a.label}
              </Button>
            );
          })}
        </StateView>
      ) : (
        <>
          <div className="stack-3" style={{ marginTop: 16 }}>
            {data.results.map((s, i) => (
              <SupplierCard
                key={s.id}
                rank={i + 1}
                s={s}
                onOpen={() => actions.open(s)}
                onCompare={() => actions.onCompare(s)}
                inCompare={actions.compare.some((c) => c.id === s.id)}
                onSave={() => actions.onSave(s)}
                saved={actions.savedSupplierIds.has(s.id)}
                onSources={() => {
                  void api.event('sources_opened', data.searchId, { supplierId: s.id });
                  setSourcesFor(s);
                }}
              />
            ))}
          </div>
          <p className="fineprint">
            Порядок одинаковый для всех: совпадение товара и региона, тип поставщика, сведения из реестров и документы. Оплата на порядок не влияет, рейтинга надёжности нет.
          </p>
        </>
      )}

      {withBar && (
        <>
          <CompareBar query={data.query} />
          <StickyActionBar>
            {selectionSaved ? (
              <Button variant="secondary" tall block icon={<BookmarkCheck size={20} strokeWidth={2} aria-hidden />} onClick={() => navigate('/saved')}>
                Подборка сохранена
              </Button>
            ) : (
              <Button block loading={saving} icon={<BookmarkPlus size={20} strokeWidth={2} aria-hidden />} onClick={saveSelection}>
                Сохранить подборку
              </Button>
            )}
          </StickyActionBar>
        </>
      )}

      <SourcesSheet
        s={sourcesFor}
        onClose={() => setSourcesFor(null)}
        onDetails={() => {
          const s = sourcesFor!;
          setSourcesFor(null);
          actions.open(s);
        }}
      />
    </div>
  );
}
