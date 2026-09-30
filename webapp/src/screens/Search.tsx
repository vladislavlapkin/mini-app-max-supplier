import { Bookmark, ChevronDown, ChevronRight, Search as SearchIcon, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { HistoryItem, SearchQuery, SupplierTypePref } from '../api/types';
import { EMPTY_QUERY } from '../api/types';
import { haptic } from '../bridge';
import { MissingProductSheet, RegionSheet } from '../components/sheets';
import { BrandSquares, Button, Chip, ICON, ICON_S, IconButton, StickyActionBar, Toggle } from '../components/ui';
import { encodeQuery, useApp } from '../store';
import { formatDate } from '../utils';

const SUPPLIER_TYPES: { value: SupplierTypePref; label: string }[] = [
  { value: 'ANY', label: 'Любой' },
  { value: 'MANUFACTURER_OR_DISTRIBUTOR', label: 'Производитель или дистрибьютор' },
  { value: 'MANUFACTURER_ONLY', label: 'Только производитель' },
];

type Suggestion = { productId: string | null; categoryId: string; name: string; categoryName: string };

/** Hero: что делает сервис и на каких данных. */
function Hero() {
  const session = useApp((s) => s.session);
  const imports = session?.data?.imports ?? [];
  const rsmp = imports.find((i) => i.dataset === 'rsmp');
  const real = session?.data?.mode !== 'test' && !!rsmp;
  return (
    <section className="hero" aria-labelledby="hero-title">
      <h1 className="t-hero hero__title" id="hero-title">
        Найдём поставщика
      </h1>
      <p className="hero__lead">3–5 компаний под ваш запрос. Объясним, почему они в подборке и откуда взяты сведения.</p>
      <div className="hero__stats">
        <div>
          <div className="hero__stat-value num">{real ? rsmp!.rowsMatched.toLocaleString('ru-RU') : '63'}</div>
          <div className="hero__stat-label">{real ? 'компаний в базе' : 'тестовые компании'}</div>
        </div>
        <div>
          <div className="hero__stat-value num">{real ? formatDate(rsmp!.dataDate) : '—'}</div>
          <div className="hero__stat-label">{real ? 'реестр МСП ФНС' : 'не из реестров'}</div>
        </div>
      </div>
      <p className="hero__note">Официальные открытые данные ФНС. ЕГРЮЛ, ГИСП и Росаккредитация пока не подключены.</p>
    </section>
  );
}

/** Экран поиска (ТЗ 7.1). Параметры предзаполняются из search_token, профиль компании не запрашивается. */
export function SearchScreen() {
  const navigate = useNavigate();
  const { catalog, form, setForm, replaceForm } = useApp();
  const [suggest, setSuggest] = useState<Suggestion[]>([]);
  const [focus, setFocus] = useState(false);
  const [regionOpen, setRegionOpen] = useState(false);
  const [missingOpen, setMissingOpen] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const initial = useRef(JSON.stringify(form));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.history().then((r) => setHistory(r.items)).catch(() => undefined);
    api.selections().then((r) => setSavedCount(r.items.length)).catch(() => undefined);
    if (window.location.hash === '#product') inputRef.current?.focus();
  }, []);

  // Подсказки с debounce
  useEffect(() => {
    const q = form.text.trim();
    if (q.length < 2 || form.productId) {
      setSuggest([]);
      return;
    }
    const t = setTimeout(() => {
      api.suggest(q).then((r) => setSuggest(r.items)).catch(() => setSuggest([]));
    }, 250);
    return () => clearTimeout(t);
  }, [form.text, form.productId]);

  const category = catalog?.categories.find((c) => c.id === form.categoryId) ?? null;
  const region = catalog?.regions.find((r) => r.code === form.regionCode) ?? null;
  const canSearch = form.text.trim().length >= 2 || !!form.categoryId;
  const unitDefault = category?.defaultUnit ?? 't';

  const [volumeText, setVolumeText] = useState(form.volume ? String(form.volume.value).replace('.', ',') : '');
  const setVolume = (patch: Partial<{ value: number | null; unit: string; operator: 'lte' | 'gte' | 'eq' }>) => {
    const cur = form.volume ?? { value: 0, unit: unitDefault, operator: 'lte' as const };
    const next = { ...cur, ...patch };
    setForm({ volume: next.value ? { value: next.value, unit: next.unit, operator: next.operator } : null });
  };
  const [volumeUnit, setVolumeUnit] = useState(form.volume?.unit ?? unitDefault);
  const [volumeOp, setVolumeOp] = useState<'lte' | 'gte' | 'eq'>(form.volume?.operator ?? 'lte');

  const pickCategory = (id: string) => {
    haptic('selection');
    const c = catalog!.categories.find((x) => x.id === id)!;
    if (form.categoryId === id && !form.productId) setForm({ categoryId: null, productId: null, text: '' });
    else setForm({ categoryId: id, productId: null, text: c.name.toLowerCase(), russianOnly: c.industrial ? form.russianOnly : false });
    if (!form.volume) setVolumeUnit(c.defaultUnit);
  };

  const pickProduct = (productId: string, categoryId: string, name: string) => {
    haptic('selection');
    setForm({ productId, categoryId, text: name.toLowerCase() });
    setSuggest([]);
  };

  const submit = () => {
    if (!canSearch) return;
    const q: SearchQuery = { ...form, text: form.text.trim() };
    if (JSON.stringify(q) !== initial.current) void api.event('filters_changed', null, { from: 'search_form' });
    replaceForm(q);
    navigate(`/results?${encodeQuery(q)}`);
  };

  const recent = useMemo(() => history.slice(0, 3), [history]);

  if (!catalog) return null;

  return (
    <div className="screen screen--with-bar">
      <header className="brandbar">
        <span className="wordmark">
          <BrandSquares size={9} />
          Проверенный поставщик
        </span>
        <IconButton label="Сохранённые подборки" filled onClick={() => navigate('/saved')}>
          <Bookmark {...ICON_S} />
        </IconButton>
      </header>

      <Hero />

      <div className="form">
        <div>
          <label className="field__label" htmlFor="product">
            Товар
          </label>
          <div className="input-wrap">
            <input
              id="product"
              ref={inputRef}
              className="input"
              placeholder="Например, строительная краска"
              value={form.text}
              autoComplete="off"
              enterKeyHint="search"
              onFocus={() => setFocus(true)}
              onBlur={() => setTimeout(() => setFocus(false), 150)}
              onChange={(e) => setForm({ text: e.target.value, productId: null, categoryId: null })}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
            {form.text && (
              <IconButton label="Очистить" className="input-wrap__clear" onClick={() => setForm({ text: '', productId: null, categoryId: null })}>
                <X {...ICON_S} />
              </IconButton>
            )}
          </div>
          {focus && suggest.length > 0 && (
            <div className="suggest" role="listbox" aria-label="Подсказки">
              {suggest.map((s) => (
                <button
                  key={`${s.categoryId}:${s.productId}`}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="suggest__item"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => (s.productId ? pickProduct(s.productId, s.categoryId, s.name) : pickCategory(s.categoryId))}
                >
                  <span className="t-body">{s.name}</span>
                  <span className="t-caption muted">{s.productId ? s.categoryName : 'Вся категория'}</span>
                </button>
              ))}
            </div>
          )}
          <p className="field__hint">ОКВЭД и отрасль вашей компании не нужны.</p>
        </div>

        <div>
          <span className="field__label">Или категория</span>
          <div className="tiles" role="group" aria-label="Категории">
            {catalog.categories.map((c, i) => (
              <button key={c.id} type="button" className={`tile ${form.categoryId === c.id ? 'tile--selected' : ''}`} aria-pressed={form.categoryId === c.id} onClick={() => pickCategory(c.id)}>
                <span className="tile__index num" aria-hidden>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span>{c.name}</span>
              </button>
            ))}
          </div>
        </div>

        {category && (
          <div className="fade-in">
            <div className="field__label">Товар в категории</div>
            <div className="chips">
              {category.products.map((p) => (
                <Chip key={p.id} selected={form.productId === p.id} onClick={() => (form.productId === p.id ? setForm({ productId: null, text: category.name.toLowerCase() }) : pickProduct(p.id, category.id, p.name))}>
                  {p.name}
                </Chip>
              ))}
            </div>
          </div>
        )}

        <div>
          <span className="field__label">Регион</span>
          <button type="button" className="select-field" onClick={() => setRegionOpen(true)} aria-haspopup="dialog">
            <span className={`select-field__value ${region ? '' : 'select-field__placeholder'}`}>{region?.name ?? 'Вся Россия'}</span>
            <ChevronDown {...ICON_S} aria-hidden />
          </button>
          {region && region.code !== 'RU' && (
            <Toggle
              checked={form.strictRegion}
              onChange={(v) => setForm({ strictRegion: v })}
              label="Только в этом регионе"
              hint={form.strictRegion ? 'Компании из соседних регионов не попадут в подборку' : 'Соседние регионы тоже покажем, но ниже'}
            />
          )}
        </div>

        <div>
          <span className="field__label">Тип поставщика</span>
          <div className="chips">
            {SUPPLIER_TYPES.map((t) => (
              <Chip
                key={t.value}
                selected={form.supplierType === t.value}
                onClick={() => {
                  haptic('selection');
                  setForm({ supplierType: t.value });
                }}
              >
                {t.label}
              </Chip>
            ))}
          </div>
          <p className="field__hint">Статус производителя определяем по документам и ГИСП, а не только по ОКВЭД.</p>
        </div>

        <div>
          <span className="field__label">Объём</span>
          <div className="volume-row">
            <select
              className="native-select"
              aria-label="Условие объёма"
              value={volumeOp}
              onChange={(e) => {
                const op = e.target.value as 'lte' | 'gte' | 'eq';
                setVolumeOp(op);
                if (form.volume) setVolume({ operator: op });
              }}
            >
              <option value="lte">до</option>
              <option value="gte">от</option>
              <option value="eq">ровно</option>
            </select>
            <input
              className="input num"
              inputMode="decimal"
              placeholder="Не важно"
              aria-label="Объём"
              value={volumeText}
              onChange={(e) => {
                const raw = e.target.value.replace(/[^\d.,]/g, '').slice(0, 12);
                setVolumeText(raw);
                const v = Number(raw.replace(',', '.'));
                setVolume({ value: Number.isFinite(v) && v > 0 ? v : null, unit: volumeUnit, operator: volumeOp });
              }}
            />
            <select
              className="native-select"
              aria-label="Единица измерения"
              value={volumeUnit}
              onChange={(e) => {
                setVolumeUnit(e.target.value);
                if (form.volume) setVolume({ unit: e.target.value });
              }}
            >
              {catalog.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.short}
                </option>
              ))}
            </select>
          </div>
          <p className="field__hint">Объём передаём поставщику как ориентир: наличие и минимальную партию уточняйте у него.</p>
        </div>

        <div className="group">
          <Toggle
            checked={form.certificate === 'REQUIRED'}
            onChange={(v) => setForm({ certificate: v ? 'REQUIRED' : 'PREFERRED' })}
            label="Нужны документы"
            hint="Только компании с действующей декларацией или сертификатом на товар"
          />
          {(!category || category.industrial) && (
            <Toggle
              checked={form.russianOnly}
              onChange={(v) => setForm({ russianOnly: v })}
              label="Российская промышленная продукция"
              hint="Только продукция из реестра ГИСП по ПП РФ №719"
            />
          )}
        </div>

        <button type="button" className="btn btn--text" style={{ padding: 0 }} onClick={() => setMissingOpen(true)}>
          Нет вашего товара? Напишите нам
        </button>
      </div>

      {recent.length > 0 && (
        <section className="section" aria-labelledby="recent-title">
          <h2 className="t-h2 section__title" id="recent-title">
            Недавние поиски
          </h2>
          <div className="list-card">
            {recent.map((h, i) => (
              <button
                key={i}
                type="button"
                className="list-row"
                onClick={() => {
                  replaceForm({ ...EMPTY_QUERY, ...h.query });
                  navigate(`/results?${encodeQuery({ ...EMPTY_QUERY, ...h.query })}`);
                }}
              >
                <SearchIcon {...ICON_S} className="list-row__icon" aria-hidden />
                <span className="grow">
                  {h.queryLabel.product}, {h.queryLabel.region}
                  <span className="t-caption muted" style={{ display: 'block' }}>
                    {h.queryLabel.supplierType}
                  </span>
                </span>
                <ChevronRight {...ICON_S} className="list-row__chevron" aria-hidden />
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="section list-card">
        <button type="button" className="list-row" onClick={() => navigate('/saved')}>
          <Bookmark {...ICON} className="list-row__icon" aria-hidden />
          <span className="grow t-strong">
            Сохранённые подборки
            {savedCount !== null && <span className="t-caption muted" style={{ display: 'block', fontWeight: 400 }}>{savedCount ? `Сохранено: ${savedCount}` : 'Пока пусто'}</span>}
          </span>
          <ChevronRight {...ICON_S} className="list-row__chevron" aria-hidden />
        </button>
      </section>

      <p className="fineprint">
        Сервис не гарантирует надёжность поставщика, качество или наличие товара. Он показывает найденные сведения и их источники.
      </p>

      <StickyActionBar>
        <Button block disabled={!canSearch} onClick={submit} icon={<SearchIcon size={20} strokeWidth={2} aria-hidden />}>
          Найти
        </Button>
      </StickyActionBar>

      <RegionSheet open={regionOpen} catalog={catalog} value={form.regionCode ?? 'RU'} onSelect={(code) => setForm({ regionCode: code === 'RU' ? null : code, strictRegion: code === 'RU' ? false : form.strictRegion })} onClose={() => setRegionOpen(false)} />
      <MissingProductSheet open={missingOpen} onClose={() => setMissingOpen(false)} />
    </div>
  );
}
