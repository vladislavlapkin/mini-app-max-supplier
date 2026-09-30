import { Bookmark, BookmarkCheck, Copy, Globe, Mail, Phone, Scale } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api, NetworkError } from '../api/client';
import type { DocumentDto, Financials, SupplierCard as Card } from '../api/types';
import { copyText, haptic, openExternal } from '../bridge';
import { EvidenceBadges, RoleBadge } from '../components/SupplierCard';
import { Button, CardSkeleton, ExternalLinkButton, FactRow, ICON, ICON_S, IconButton, Notice, ProvenanceLine, ReasonList, Section, Skeleton, StateView, StickyActionBar } from '../components/ui';
import { decodeQuery, MAX_COMPARE, useApp } from '../store';
import { formatDate, formatThousandRub } from '../utils';

function DocumentItem({ d }: { d: DocumentDto }) {
  const tone = d.isOfficiallyVerified ? 'badge--ok' : d.isActive ? 'badge--test' : 'badge--danger';
  const match = { product: 'На запрошенный товар', category: 'На другой товар этой категории', other: 'Не совпадает с запрошенным товаром' }[d.match];
  return (
    <div className="card card--flat">
      <div className="t-strong break">
        {d.type === 'DECLARATION' ? 'Декларация о соответствии' : 'Сертификат соответствия'}
      </div>
      <div className="t-caption num break" style={{ marginTop: 2 }}>
        {d.number}
      </div>
      <div className="badges" style={{ marginTop: 8 }}>
        <span className={`badge ${tone}`}>{d.statusLabel}</span>
        <span className={`badge ${d.match === 'other' ? 'badge--warn' : ''}`}>{match}</span>
      </div>
      <dl className="kv">
        {d.productName && (
          <>
            <dt>Продукция</dt>
            <dd>{d.productName}</dd>
          </>
        )}
        <dt>Срок действия</dt>
        <dd className="num">
          {formatDate(d.validFrom)} — {formatDate(d.validTo)}
        </dd>
        {d.manufacturer && (
          <>
            <dt>Изготовитель</dt>
            <dd>{d.manufacturer}</dd>
          </>
        )}
        {d.applicant && d.applicant !== d.manufacturer && (
          <>
            <dt>Заявитель</dt>
            <dd>{d.applicant}</dd>
          </>
        )}
        {d.techRegulation && (
          <>
            <dt>Основание</dt>
            <dd>{d.techRegulation}</dd>
          </>
        )}
        {d.certificationBody && (
          <>
            <dt>Орган</dt>
            <dd>{d.certificationBody}</dd>
          </>
        )}
      </dl>
      {!d.isOfficiallyVerified && d.isActive && (
        <p className="t-caption" style={{ color: 'var(--warning)', margin: '8px 0 0' }}>
          Документ не считается действующим без проверки в реестре Росаккредитации.
        </p>
      )}
      <ProvenanceLine p={d.provenance} />
    </div>
  );
}

function FinancialsBlock({ id }: { id: string }) {
  const [state, setState] = useState<'idle' | 'loading' | Financials | 'error'>('idle');
  const load = async () => {
    setState('loading');
    try {
      setState(await api.financials(id));
    } catch {
      setState('error');
    }
  };
  if (state === 'idle')
    return (
      <div className="stack-2">
        <p className="t-caption muted" style={{ margin: 0 }}>
          Показываем только по запросу. Финансовые показатели не используются для оценки надёжности и не влияют на порядок выдачи.
        </p>
        <Button variant="secondary" block onClick={load}>
          Показать бухгалтерскую отчётность
        </Button>
      </div>
    );
  if (state === 'loading') return <Skeleton h={120} r={12} />;
  if (state === 'error') return <Notice tone="warning">Не удалось загрузить раздел. <button className="btn btn--text" onClick={load}>Повторить</button></Notice>;
  if (state.status !== 'ok')
    return (
      <div className="stack-2">
        <Notice tone={state.status === 'unavailable' ? 'warning' : 'info'}>{state.message}</Notice>
        {state.link && <ExternalLinkButton href={state.link}>Открыть ГИР БО</ExternalLinkButton>}
      </div>
    );
  const allRows: [string, keyof Financials['periods'][number]][] = [
    ['Выручка (доходы)', 'revenue'],
    ['Расходы', 'expenses'],
    ['Прибыль / убыток', 'profit'],
    ['Активы', 'assets'],
    ['Обязательства', 'liabilities'],
    ['Капитал', 'capital'],
  ];
  // Показываем только те показатели, которые есть в источнике
  const rows = allRows.filter(([, k]) => state.periods.some((p) => p[k] !== null && p[k] !== undefined));
  const money = (v: number | null, unit: 'RUB' | 'THOUSAND_RUB') => (v === null || v === undefined ? '—' : formatThousandRub(unit === 'RUB' ? Math.round(v / 1000) : v));
  return (
    <div className="card card--flat">
      <table className="fin-table">
        <thead>
          <tr>
            <th>Показатель</th>
            {state.periods.map((p) => (
              <th key={p.year}>{p.year}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, k]) => (
            <tr key={k}>
              <td>{label}</td>
              {state.periods.map((p) => (
                <td key={p.year}>{money(p[k] as number | null, p.unit)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ProvenanceLine p={state.periods[0]?.provenance} />
    </div>
  );
}

/** Карточка поставщика (ТЗ 7.3): у каждого факта — источник и дата. */
export function SupplierScreen() {
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const query = useMemo(() => decodeQuery(location.search), [location.search]);
  const { savedSupplierIds, markSupplierSaved, compare, toggleCompare, showToast, lastSearchId } = useApp();
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState<'offline' | 'error' | 'not_found' | null>(null);
  const [note, setNote] = useState('');
  const [noteDirty, setNoteDirty] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const c = await api.supplier(id, query);
      setCard(c);
      setNote(c.saved?.note ?? '');
      markSupplierSaved(id, !!c.saved);
    } catch (err) {
      setError(err instanceof NetworkError ? 'offline' : err instanceof ApiError && err.status === 404 ? 'not_found' : 'error');
    }
  }, [id, query, markSupplierSaved]);

  useEffect(() => {
    void load();
  }, [load]);

  const saved = savedSupplierIds.has(id);
  const inCompare = compare.some((c) => c.id === id);

  if (error)
    return (
      <div className="screen">
        <StateView title={error === 'offline' ? 'Нет соединения' : error === 'not_found' ? 'Поставщик не найден' : 'Не удалось загрузить карточку'} text={error === 'not_found' ? 'Возможно, запись удалена из базы.' : 'Попробуйте ещё раз.'}>
          {error !== 'not_found' && (
            <Button block onClick={load}>
              Повторить
            </Button>
          )}
          <Button variant="text" onClick={() => navigate('/')}>
            К поиску
          </Button>
        </StateView>
      </div>
    );

  if (!card)
    return (
      <div className="screen stack-4" aria-busy="true">
        <Skeleton h={26} w="85%" />
        <Skeleton h={16} w="55%" />
        <Skeleton h={120} r={12} />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );

  const s = card.summary;
  const g = card.general;
  const failed = card.sourceStatuses.filter((x) => x.status === 'failed');
  const gispUncovered = s.uncovered?.includes('GISP');
  const fsaUncovered = s.uncovered?.includes('FSA_DECL') && s.uncovered?.includes('FSA_CERT');
  const egrulEmpty = s.uncovered?.includes('FNS_EGRUL') ? 'Нет данных: ЕГРЮЛ не подключён — проверьте на egrul.nalog.ru' : undefined;

  const toggleSave = async () => {
    markSupplierSaved(id, !saved);
    try {
      if (saved) {
        await api.removeSupplier(id);
        showToast('Поставщик убран из сохранённых');
      } else {
        await api.saveSupplier(id, { query, note: note || null }, lastSearchId ?? undefined);
        haptic('success');
        showToast('Поставщик сохранён. Можно добавить заметку ниже');
      }
    } catch (err) {
      markSupplierSaved(id, saved);
      showToast(err instanceof ApiError ? err.message : 'Не удалось сохранить');
    }
  };

  const saveNote = async () => {
    try {
      await api.updateSupplierNote(id, note.trim() || null);
      setNoteDirty(false);
      showToast('Заметка сохранена');
    } catch {
      showToast('Не удалось сохранить заметку');
    }
  };

  const contact = (url: string, kind: string) => {
    void api.event('contact_link_opened', lastSearchId, { supplierId: id, kind });
    openExternal(url);
  };

  const onCompare = () => {
    const r = toggleCompare(s);
    if (r === 'full') {
      showToast(`Сравнить можно до ${MAX_COMPARE} поставщиков. Уберите одного, чтобы добавить нового`);
      return;
    }
    haptic('selection');
    const ids = useApp.getState().compare.map((c) => c.id);
    const action = ids.length >= 2 ? { label: 'Сравнить', run: () => navigate(`/compare?ids=${ids.join(',')}`) } : undefined;
    showToast(r === 'added' ? 'Добавлено к сравнению' : 'Убрано из сравнения', action);
  };

  return (
    <div className="screen screen--with-bar">
      {/* Шапка */}
      <h1 className="t-title break">{g.name}</h1>
      <button
        type="button"
        className="btn btn--text num"
        style={{ padding: 0, minHeight: 32, color: 'var(--text-secondary)', fontWeight: 400, fontSize: 13 }}
        onClick={async () => {
          if (await copyText(g.inn)) showToast('ИНН скопирован');
        }}
        aria-label={`Скопировать ИНН ${g.inn}`}
      >
        ИНН {g.inn} · ОГРН{g.entityType === 'IP' ? 'ИП' : ''} {g.ogrn} <Copy size={14} strokeWidth={2} aria-hidden />
      </button>
      <div className="supplier-card__meta" style={{ marginTop: 4 }}>
        <RoleBadge type={s.supplierType} label={s.supplierTypeLabel} />
        <span>
          {s.city ? `${s.city}, ` : ''}
          {s.region.name}
        </span>
      </div>
      {s.supplierTypeBasis && (
        <p className="t-caption muted" style={{ margin: '8px 0 0' }}>
          Основание: {s.supplierTypeBasis}
        </p>
      )}
      <div style={{ marginTop: 10 }}>
        <EvidenceBadges s={s} max={5} />
      </div>

      <div className="stack-3" style={{ marginTop: 16 }}>
        {s.isManualTestData ? (
          <Notice tone="info">Тестовые данные: вымышленная компания из ручной базы. В официальных реестрах её нет.</Notice>
        ) : (
          <Notice tone="info" title="Реальная компания из открытых данных ФНС">
            Реестр МСП, численность, налоговые режимы, задолженность и доходы/расходы — официальные сведения. ЕГРЮЛ, ГИСП, Росаккредитация и РНП не подключены: проверьте их по ссылкам в разделе «Источники».
          </Notice>
        )}
        {card.risks.map((r, i) => (
          <Notice key={i} tone="danger" title={`Официальный факт: ${r.title.toLowerCase()}`}>
            {r.details} Это не вывод о надёжности — проверьте информацию перед сделкой.
          </Notice>
        ))}
        {card.discrepancies.length > 0 && (
          <Notice tone="warning" title="В источниках есть расхождение">
            {card.discrepancies.join('. ')}. Рекомендуем проверить информацию перед сделкой.
          </Notice>
        )}
        {failed.length > 0 && (
          <Notice tone="warning" title="Часть сведений сейчас недоступна">
            Не ответили: {failed.map((f) => f.name).join(', ')}. Показаны данные последней успешной проверки.
          </Notice>
        )}
      </div>

      <Section title="Почему в подборке" tone="sky" id="why">
        <ReasonList reasons={s.reasons} />
      </Section>

      <Section title="Общее" id="general">
        <div className="facts">
          <FactRow label="Статус деятельности" value={g.legalStatus.refreshed ? g.legalStatus.label : `${g.legalStatus.label} (не обновлено: источник недоступен)`} p={g.legalStatus.provenance} />
          <FactRow label={g.entityType === 'IP' ? 'ИНН / ОГРНИП' : 'ИНН / ОГРН / КПП'} value={<span className="num">{[g.inn, g.ogrn, g.kpp].filter(Boolean).join(' / ')}</span>} p={g.legalStatus.provenance} />
          <FactRow label="Дата регистрации" value={formatDate(g.registrationDate.value)} p={g.registrationDate.provenance} empty={egrulEmpty} />
          <FactRow label="Регион" value={g.region} />
          <FactRow label="Адрес" value={g.address.value} p={g.address.provenance} />
          <FactRow label={g.entityType === 'IP' ? 'Индивидуальный предприниматель' : 'Руководитель'} value={g.director.value} p={g.director.provenance} empty={egrulEmpty} />
          <FactRow label="Дата проверки" value={formatDate(g.checkedAt)} />
        </div>
      </Section>

      <Section title="Профиль деятельности" id="activity">
        <div className="facts">
          <FactRow
            label="Основной ОКВЭД"
            value={card.activity.okvedMain.value ? `${card.activity.okvedMain.value.code} ${card.activity.okvedMain.value.name}` : '—'}
            p={card.activity.okvedMain.provenance}
          />
          <FactRow
            label="Дополнительные ОКВЭД"
            value={card.activity.okvedAdditional.value.length ? card.activity.okvedAdditional.value.map((o) => `${o.code} ${o.name}`).join('; ') : '—'}
            p={card.activity.okvedAdditional.provenance}
          />
          <FactRow label="Соответствие запросу" value={card.activity.note} />
        </div>
      </Section>

      <Section title="МСП" id="sme">
        <div className="facts">
          <FactRow label="Категория" value={card.sme.status.label} p={card.sme.status.provenance} />
          {card.sme.includedAt.value && <FactRow label="Дата включения в реестр" value={formatDate(card.sme.includedAt.value)} p={card.sme.includedAt.provenance} />}
        </div>
        {card.transparency && (
          <div className="facts" style={{ marginTop: 12 }}>
            <FactRow label="Среднесписочная численность" value={card.transparency.employees.value ? `${card.transparency.employees.value} чел.` : '—'} p={card.transparency.employees.provenance} />
            <FactRow label="Налоговый режим" value={card.transparency.taxRegime.value} p={card.transparency.taxRegime.provenance} />
            <FactRow label="Налоговая задолженность" value={card.transparency.taxDebt.value} p={card.transparency.taxDebt.provenance} />
          </div>
        )}
      </Section>

      <Section title="Продукция" id="products">
        <div className="stack-3">
          {card.products.map((p, i) => (
            <div className="card card--flat" key={i}>
              <div className="row row--between" style={{ alignItems: 'flex-start' }}>
                <div className="t-strong grow break">{p.title}</div>
                {p.matchesQuery && <span className="badge badge--role-manufacturer">по запросу</span>}
              </div>
              <div className="t-caption muted">{p.categoryName}</div>
              <dl className="kv">
                {p.brand && (
                  <>
                    <dt>Бренд / модель</dt>
                    <dd>
                      {p.brand}
                      {p.model ? ` / ${p.model}` : ''}
                    </dd>
                  </>
                )}
                {p.okpd2 && (
                  <>
                    <dt>ОКПД2</dt>
                    <dd className="num">{p.okpd2}</dd>
                  </>
                )}
                {Object.entries(p.characteristics).map(([k, v]) => (
                  <div key={k} style={{ display: 'contents' }}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
                <dt>ГИСП</dt>
                <dd>{p.gispRecordNumber ? `запись ${p.gispRecordNumber}` : gispUncovered ? 'не проверялось: ГИСП не подключён' : 'совпадение не найдено'}</dd>
                <dt>ПП РФ №719</dt>
                <dd>{p.pp719RecordNumber ? `реестровая запись ${p.pp719RecordNumber}` : gispUncovered ? 'не проверялось' : 'записи нет'}</dd>
              </dl>
              {p.provenance ? (
                <ProvenanceLine p={p.provenance} />
              ) : (
                <div className="prov">{s.isManualTestData ? 'Источник: ручная тестовая база' : 'Источник: реестр МСП ФНС (основной ОКВЭД или заявленная продукция)'} · наличие на складе не подтверждено</div>
              )}
            </div>
          ))}
        </div>
        <p className="t-caption muted">Карточка продукции в ГИСП не подтверждает наличие товара на складе.</p>
      </Section>

      <Section title="Документы" id="docs">
        {card.documents.length ? (
          <div className="stack-3">
            {card.documents.map((d) => (
              <DocumentItem d={d} key={d.number} />
            ))}
          </div>
        ) : fsaUncovered ? (
          <Notice tone="warning" title="Документы не проверялись">
            Реестр Росаккредитации не подключён: у него нет открытого API, а скрейпинг запрещён ТЗ. Запросите декларацию или сертификат у поставщика и проверьте номер на pub.fsa.gov.ru.
          </Notice>
        ) : (
          <Notice tone="warning">Сертификаты и декларации в подключённых источниках не найдены. Если документ обязателен для вашей закупки, запросите его у поставщика.</Notice>
        )}
      </Section>

      {card.requirements && (
        <Section title="Что запросить" id="request">
          <p className="t-caption muted" style={{ marginTop: 0 }}>
            Обычно для категории «{card.requirements.categoryName}» запрашивают:
          </p>
          <div className="card card--flat">
            {card.requirements.documents.map((d, i) => (
              <div className="checkbox-row" key={i}>
                <span className="counter" style={{ background: 'var(--bg-subtle)', color: 'var(--text-primary)' }}>
                  {i + 1}
                </span>
                <div>
                  <div className="t-body">{d.title}</div>
                  <div className="t-caption muted">{d.hint}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="t-caption muted">
            Не является юридическим заключением. Требования уточняйте на ресурсе «
            <a
              href={card.requirements.sourceUrl}
              onClick={(e) => {
                e.preventDefault();
                openExternal(card.requirements!.sourceUrl);
              }}
            >
              {card.requirements.sourceName}
            </a>
            ».
          </p>
        </Section>
      )}

      <Section title="Финансы" id="finance">
        <FinancialsBlock id={id} />
      </Section>

      <Section title="Риск-сигналы" id="risks">
        {card.risks.length ? (
          <div className="stack-3">
            {card.risks.map((r, i) => (
              <div className="card card--flat" key={i}>
                <div className="t-strong">{r.title}</div>
                {r.details && <div className="t-caption" style={{ marginTop: 4 }}>{r.details}</div>}
                <dl className="kv">
                  {r.recordNumber && (
                    <>
                      <dt>Номер записи</dt>
                      <dd className="num">{r.recordNumber}</dd>
                    </>
                  )}
                  {r.publishedAt && (
                    <>
                      <dt>Дата</dt>
                      <dd className="num">{formatDate(r.publishedAt)}</dd>
                    </>
                  )}
                </dl>
                <ProvenanceLine p={r.provenance} />
              </div>
            ))}
          </div>
        ) : card.riskSourcesChecked.every((r) => r.status === 'not_configured') ? (
          <Notice tone="warning" title="Риск-сигналы не проверялись">
            ЕГРЮЛ, реестр недобросовестных поставщиков и ЕФРСБ для этой компании не подключены. Проверьте ИНН по ссылкам в разделе «Источники».
          </Notice>
        ) : (
          <Notice tone="info">Официальных записей о РНП, банкротстве и недостоверности сведений в подключённых источниках не найдено.</Notice>
        )}
        <div className="t-caption muted" style={{ marginTop: 8 }}>
          Источники: {card.riskSourcesChecked.map((r) => `${r.name}${r.status === 'not_configured' ? ' — не подключён' : r.status !== 'ok' ? ' — не ответил' : ''}`).join('; ')}. Показываем только найденные официальные факты, без оценок.
        </div>
      </Section>

      <Section title="Контакты" id="contacts">
        <div className="card card--flat" style={{ padding: '0 16px' }}>
          {card.contacts.website && (
            <button type="button" className="list-row" onClick={() => contact(card.contacts.website!, 'website')}>
              <Globe {...ICON_S} className="list-row__icon" aria-hidden />
              <span className="grow break">{card.contacts.website}</span>
            </button>
          )}
          {card.contacts.phone && (
            <a className="list-row" href={`tel:${card.contacts.phone.replace(/[^\d+]/g, '')}`} onClick={() => void api.event('contact_link_opened', lastSearchId, { supplierId: id, kind: 'phone' })}>
              <Phone {...ICON_S} className="list-row__icon" aria-hidden />
              <span className="grow num">{card.contacts.phone}</span>
            </a>
          )}
          {card.contacts.email && (
            <a className="list-row" href={`mailto:${card.contacts.email}`} onClick={() => void api.event('contact_link_opened', lastSearchId, { supplierId: id, kind: 'email' })}>
              <Mail {...ICON_S} className="list-row__icon" aria-hidden />
              <span className="grow break">{card.contacts.email}</span>
            </a>
          )}
          {!card.contacts.website && !card.contacts.phone && !card.contacts.email && (
            <p className="muted">{card.contacts.isManualTestData ? 'Контакты не указаны.' : 'В реестре МСП контакты не публикуются. Найдите сайт и телефон компании по ИНН.'}</p>
          )}
        </div>
        <p className="t-caption muted">{card.contacts.isManualTestData ? 'Вымышленные контакты из тестовой базы.' : 'Из открытых источников, могут быть неполными.'} Цена, наличие и сроки не подтверждены.</p>
      </Section>

      <Section title="Источники и ограничения" id="sources">
        <div className="stack-3">
          {card.sources.map((src) => (
            <div className="card card--flat" key={src.source}>
              <div className="row row--between" style={{ alignItems: 'flex-start' }}>
                <div className="t-strong grow">{src.name}</div>
                <span className={`badge ${src.status === 'failed' ? 'badge--warn' : src.sourceType === 'OFFICIAL' ? 'badge--ok' : 'badge--test'}`}>
                  {src.status === 'failed' ? 'не ответил' : src.status === 'not_configured' ? 'не подключён' : src.sourceType === 'OFFICIAL' ? 'официальный' : 'тестовые данные'}
                </span>
              </div>
              {src.fields.length > 0 && <div className="t-caption" style={{ marginTop: 4 }}>{src.fields.join(', ')}</div>}
              <div className="prov">
                <span className="num">{src.checkedAt ? `Проверено ${formatDate(src.checkedAt)}` : 'Дата проверки неизвестна'}</span>
                {src.url && (
                  <a
                    href={src.url}
                    onClick={(e) => {
                      e.preventDefault();
                      void api.event('source_link_opened', lastSearchId, { supplierId: id, source: src.source });
                      openExternal(src.url!);
                    }}
                  >
                    Открыть источник
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>

        <h3 className="t-headline" style={{ marginTop: 24 }}>
          Ограничения
        </h3>
        <ul className="t-body" style={{ paddingLeft: 20, margin: '8px 0 0' }}>
          {card.limitations.map((l, i) => (
            <li key={i} style={{ marginBottom: 6 }}>
              {l}
            </li>
          ))}
        </ul>

        <h3 className="t-headline" style={{ marginTop: 24 }}>
          Проверить самостоятельно
        </h3>
        <div>
          {card.externalLinks.map((l) => (
            <button
              key={l.source}
              type="button"
              className="list-row"
              onClick={() => {
                void api.event('source_link_opened', lastSearchId, { supplierId: id, source: l.source });
                openExternal(l.url);
              }}
            >
              <span className="grow">{l.name}</span>
            </button>
          ))}
        </div>
      </Section>

      {saved && (
        <Section title="Заметка" id="note">
          <textarea
            className="input"
            placeholder="Например: запросить паспорт качества, условия доставки"
            value={note}
            maxLength={1000}
            onChange={(e) => {
              setNote(e.target.value);
              setNoteDirty(true);
            }}
            aria-label="Заметка о поставщике"
          />
          {noteDirty && (
            <Button variant="secondary" block onClick={saveNote} style={{ marginTop: 8 }}>
              Сохранить заметку
            </Button>
          )}
        </Section>
      )}

      <p className="t-caption muted" style={{ marginTop: 32 }}>
        Сведения собраны из доступных источников и не являются гарантией надёжности, качества, наличия товара или исполнения договора. Проверяйте документы перед сделкой.
      </p>

      <StickyActionBar
        side={
          <IconButton
            label={inCompare ? 'Убрать из сравнения' : 'Добавить к сравнению'}
            active={inCompare}
            filled
            large
            onClick={onCompare}
          >
            <Scale {...ICON} />
          </IconButton>
        }
      >
        {saved ? (
          <Button variant="secondary" tall block icon={<BookmarkCheck size={20} strokeWidth={2} aria-hidden />} onClick={toggleSave}>
            Сохранено
          </Button>
        ) : (
          <Button block icon={<Bookmark size={20} strokeWidth={2} aria-hidden />} onClick={toggleSave}>
            Сохранить
          </Button>
        )}
      </StickyActionBar>
    </div>
  );
}
