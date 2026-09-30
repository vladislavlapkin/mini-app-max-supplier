import { ChevronLeft } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createBrowserRouter, Outlet, RouterProvider, ScrollRestoration, useLocation, useNavigate } from 'react-router-dom';
import { ApiError, api, NetworkError } from './api/client';
import { backButton, isInMax } from './bridge';
import { Button, CardSkeleton, Skeleton, StateView, ToastHost } from './components/ui';
import { CompareScreen } from './screens/Compare';
import { ResultsScreen } from './screens/Results';
import { SavedScreen, SelectionScreen } from './screens/Saved';
import { SearchScreen } from './screens/Search';
import { SupplierScreen } from './screens/Supplier';
import { encodeQuery, useApp } from './store';

function useBackButton() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    // Системная кнопка «Назад» MAX: на всех экранах, кроме главного
    if (location.pathname === '/') backButton.hide();
    else backButton.show();
  }, [location.pathname]);

  useEffect(() => {
    const onBack = () => {
      const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
      if (idx > 0) navigate(-1);
      else navigate('/', { replace: true });
    };
    backButton.onClick(onBack);
    return () => backButton.offClick(onBack);
  }, [navigate]);
}

/** Вне MAX системной кнопки «Назад» нет — показываем свою, только когда есть куда вернуться. */
function TopBar() {
  const [visible, setVisible] = useState(backButton.visible);
  useEffect(() => {
    const unsub = backButton.subscribe(setVisible);
    return () => {
      unsub();
    };
  }, []);
  if (isInMax() || !visible) return null;
  return (
    <nav className="topbar" aria-label="Навигация">
      <button type="button" className="topbar__back" onClick={() => backButton.press()}>
        <ChevronLeft size={22} strokeWidth={2} aria-hidden />
        Назад
      </button>
    </nav>
  );
}

function BootSkeleton() {
  return (
    <div className="screen stack-4" aria-busy="true">
      <Skeleton h={40} w="80%" />
      <Skeleton h={18} w="60%" />
      <Skeleton h={52} />
      <CardSkeleton />
    </div>
  );
}

function Layout() {
  const { session, catalog, bootError, setBoot, setBootError, setOnline, setSavedSuppliers, replaceForm, showToast } = useApp();
  const navigate = useNavigate();
  const launched = useRef(false);
  const [loading, setLoading] = useState(!session);
  useBackButton();

  const boot = useCallback(async () => {
    setLoading(true);
    try {
      const [s, c] = await Promise.all([api.session(), api.catalog()]);
      setBoot(s, c);
      api
        .savedSuppliers()
        .then((r) => setSavedSuppliers(r.items.map((i) => i.supplierId)))
        .catch(() => undefined);
      if (!launched.current) {
        launched.current = true;
        const launch = s.launch;
        if (launch?.type === 'search') {
          replaceForm(launch.query);
          navigate(`/results?${encodeQuery(launch.query)}`, { replace: true });
        } else if (launch?.type === 'selection') {
          navigate(`/saved/${launch.id}`, { replace: true });
        } else if (launch?.type === 'search_expired') {
          showToast('Ссылка на подборку устарела. Задайте параметры заново');
        }
      }
    } catch (err) {
      setBootError(err instanceof NetworkError ? 'offline' : err instanceof ApiError ? err.message : 'error');
    } finally {
      setLoading(false);
    }
  }, [navigate, replaceForm, setBoot, setBootError, setSavedSuppliers, showToast]);

  useEffect(() => {
    if (!session) void boot();
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  let content;
  if (loading && !session) content = <BootSkeleton />;
  else if (bootError || !session || !catalog)
    content = (
      <div className="screen">
        {bootError === 'offline' ? (
          <StateView title="Нет соединения" text="Проверьте интернет и попробуйте ещё раз.">
            <Button block onClick={boot}>
              Повторить
            </Button>
          </StateView>
        ) : (
          <StateView title="Что-то пошло не так" text={bootError && bootError !== 'error' ? bootError : 'Попробуйте через минуту.'}>
            <Button block onClick={boot}>
              Повторить
            </Button>
          </StateView>
        )}
      </div>
    );
  else content = <Outlet />;

  return (
    <div className="app">
      <TopBar />
      {content}
      <ToastHost />
      <ScrollRestoration getKey={(location) => location.pathname + location.search} />
    </div>
  );
}

function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="screen">
      <StateView title="Страница не найдена" text="Возможно, ссылка устарела.">
        <Button block onClick={() => navigate('/', { replace: true })}>
          К поиску
        </Button>
      </StateView>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <SearchScreen /> },
      { path: '/results', element: <ResultsScreen /> },
      { path: '/supplier/:id', element: <SupplierScreen /> },
      { path: '/compare', element: <CompareScreen /> },
      { path: '/saved', element: <SavedScreen /> },
      { path: '/saved/:id', element: <SelectionScreen /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
