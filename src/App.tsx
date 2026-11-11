import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Command,
  ExternalLink,
  FolderLock,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  Palette,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { Client } from './client';
import { Context, type Route } from './context';
import { Demo } from './demo';
import { Overview } from './Overview';
import { Sandboxes } from './Sandboxes';
import { ActivityPage, AppearancePage, Guide, Models, SecurityPage } from './Settings';
import { Badge, Button } from './ui';
import { statusLabels, type Appearance, type PanelData, type Session, type Status } from './types';

const navigation = [
  { id: 'overview', label: 'Обзор', icon: LayoutDashboard },
  { id: 'sandboxes', label: 'Песочницы', icon: FolderLock },
  { id: 'models', label: 'Модели и ИИ', icon: Sparkles },
  { id: 'activity', label: 'Активность', icon: Activity },
  { id: 'appearance', label: 'Внешний вид', icon: Palette },
  { id: 'security', label: 'Безопасность', icon: ShieldCheck },
  { id: 'guide', label: 'Как это работает', icon: BookOpen },
] as const;
const defaults: Appearance = {
  theme: 'light',
  accent: 'mint',
  density: 'comfortable',
  title: 'Моё пространство',
  refresh: 30,
};
function storedAppearance(): Appearance {
  try {
    const saved = JSON.parse(localStorage.getItem('sova-appearance') || '{}');
    return {
      theme: ['light', 'dark', 'system'].includes(saved.theme) ? saved.theme : defaults.theme,
      accent: ['mint', 'blue', 'amber'].includes(saved.accent) ? saved.accent : defaults.accent,
      density: saved.density === 'compact' ? 'compact' : 'comfortable',
      title: typeof saved.title === 'string' ? saved.title.slice(0, 40) : defaults.title,
      refresh: [0, 15, 30, 60].includes(saved.refresh) ? saved.refresh : 30,
    };
  } catch {
    return defaults;
  }
}
function initialRoute(): Route {
  const hash = location.hash.slice(1);
  return navigation.some((n) => n.id === hash) ? (hash as Route) : 'overview';
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState('');
  const [client, setClient] = useState(() => new Client());
  const [demo, setDemo] = useState(false);
  const [data, setData] = useState<PanelData | null>(null);
  const [route, setRoute] = useState<Route>(initialRoute);
  const [menu, setMenu] = useState(false);
  const [days, setDays] = useState(7);
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 800px)').matches);
  const [names, setNames] = useState<Record<number, string>>({});
  const [appearance, setAppearance] = useState(storedAppearance);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const sequence = useRef(0);
  const mounted = useRef(true);
  const notify = useCallback((text: string, error = false) => setToast({ text, error }), []);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const query = matchMedia('(max-width: 800px)');
    const change = () => setMobile(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        appearance.theme === 'system' ? (media.matches ? 'dark' : 'light') : appearance.theme;
      document.documentElement.dataset.accent = appearance.accent;
      document.documentElement.dataset.density = appearance.density;
    };
    apply();
    media.addEventListener('change', apply);
    try {
      localStorage.setItem('sova-appearance', JSON.stringify(appearance));
    } catch {
      /* preferences are optional */
    }
    return () => media.removeEventListener('change', apply);
  }, [appearance]);
  useEffect(() => {
    const change = () => setRoute(initialRoute());
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    let active = true;
    fetch('/api/session', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
      .then(async (response) => {
        let result: Partial<Session> & { detail?: string };
        try {
          result = (await response.json()) as typeof result;
        } catch {
          throw new Error(
            'Подключите сайт к Cloudflare Pages Functions, чтобы открыть личную панель.',
          );
        }
        if (!response.ok) throw new Error(result.detail || 'Войдите с учётной записью владельца.');
        if (typeof result.email !== 'string' || result.access !== 'owner')
          throw new Error('Не удалось подтвердить сессию владельца.');
        if (active)
          setSession({
            email: result.email,
            access: result.access,
            backend_configured: !!result.backend_configured,
          });
      })
      .catch((e) => {
        if (active) setAuthError(e.message);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const navigate = useCallback((next: Route) => {
    location.hash = next;
    setRoute(next);
    setMenu(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);
  const refresh = useCallback(async () => {
    const version = ++sequence.current;
    setRefreshing(true);
    try {
      const loaded = await client.load(days);
      if (mounted.current && version === sequence.current) {
        setData(loaded);
        setConnectionError('');
      }
    } catch (e) {
      if (version === sequence.current) setConnectionError((e as Error).message);
      throw e;
    } finally {
      if (version === sequence.current) setRefreshing(false);
    }
  }, [client, days]);
  useEffect(() => {
    if (!session && !demo) return;
    void refresh().catch(() => {});
  }, [session, demo, refresh]);
  useEffect(() => {
    if ((!session && !demo) || !appearance.refresh) return;
    const timer = setInterval(() => {
      if (!document.hidden) void refresh().catch(() => {});
    }, appearance.refresh * 1000);
    return () => clearInterval(timer);
  }, [session, demo, refresh, appearance.refresh]);
  const run = useCallback(
    async (task: () => Promise<unknown>, message: string) => {
      try {
        await task();
        await refresh();
        notify(message);
        return true;
      } catch (e) {
        notify((e as Error).message, true);
        return false;
      }
    },
    [refresh, notify],
  );
  function enterDemo() {
    const instance = new Demo();
    setDemo(true);
    setClient(new Client(instance));
    setNames({ ...instance.titles });
    setData(null);
    setConnectionError('');
    navigate('overview');
  }
  function exitDemo() {
    sequence.current++;
    setDemo(false);
    setClient(new Client());
    setNames({});
    setData(null);
    setConnectionError('');
  }
  if (!session && !demo) return <Login checking={checking} error={authError} onDemo={enterDemo} />;
  if (!data)
    return (
      <div className="boot-screen">
        <Brand />
        <div className="boot-card">
          {connectionError ? (
            <>
              <CloudError />
              <h1>Нет связи с ботом</h1>
              <p>{connectionError}</p>
              <Button onClick={() => void refresh().catch(() => {})} busy={refreshing}>
                Повторить подключение
              </Button>
              <Button variant="ghost" onClick={enterDemo}>
                Посмотреть демонстрацию
              </Button>
              <a
                href="https://github.com/alter413/site_on_chatgpt/blob/main/DEPLOYMENT.md"
                target="_blank"
                rel="noreferrer"
              >
                Инструкция подключения <ExternalLink size={14} />
              </a>
            </>
          ) : (
            <>
              <LoaderCircle className="spin" size={30} />
              <h1>Открываем ваше пространство</h1>
              <p>Получаем настройки и проверяем соединение с ботом…</p>
            </>
          )}
        </div>
      </div>
    );
  return (
    <Context.Provider
      value={{
        data,
        client,
        demo,
        days,
        setDays,
        names,
        setNames,
        appearance,
        setAppearance,
        navigate,
        refresh,
        run,
        notify,
      }}
    >
      <a className="skip-link" href="#main-content">
        Перейти к содержимому
      </a>
      <div className="app-shell">
        <button
          className={`nav-backdrop ${menu ? 'visible' : ''}`}
          aria-label="Закрыть меню"
          onClick={() => setMenu(false)}
          tabIndex={menu ? 0 : -1}
        />
        <aside className={`sidebar ${menu ? 'open' : ''}`} inert={mobile && !menu}>
          <div className="sidebar-top">
            <Brand />
            <button
              className="icon-button mobile-close"
              aria-label="Закрыть меню"
              onClick={() => setMenu(false)}
            >
              <X size={19} />
            </button>
          </div>
          <div className="workspace">
            <span className="workspace-icon">
              <Command size={18} />
            </span>
            <div>
              <strong>{appearance.title || 'Моё пространство'}</strong>
              <small>Личный аккаунт</small>
            </div>
            <ShieldCheck size={15} />
          </div>
          <div className="nav-label">УПРАВЛЕНИЕ</div>
          <nav aria-label="Основная навигация">
            {navigation.map((item, i) => (
              <div key={item.id}>
                {i === 4 && <div className="nav-label secondary-label">ПРОСТРАНСТВО</div>}
                <button
                  onClick={() => navigate(item.id)}
                  className={`nav-item ${route === item.id ? 'active' : ''}`}
                  aria-current={route === item.id ? 'page' : undefined}
                >
                  <item.icon size={18} />
                  <span>{item.label}</span>
                  {item.id === 'sandboxes' && <small>{data.chats.length}</small>}
                  {item.id === 'overview' && <span className="nav-active-dot" />}
                </button>
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="isolation-note">
              <span className="isolation-symbol">
                <ShieldCheck size={19} />
              </span>
              <strong>Приватность по умолчанию</strong>
              <p>
                Только выбранные чаты.
                <br />
                Только разрешённые данные.
              </p>
              <span>
                <i />
                Контекст изолирован
              </span>
            </div>
            <div className="owner-row">
              <span className="owner-avatar">
                {demo ? 'Д' : session?.email[0]?.toUpperCase() || 'Я'}
              </span>
              <div>
                <strong>{demo ? 'Демонстрация' : 'Владелец'}</strong>
                <small>{demo ? 'Без подключения к аккаунту' : session?.email}</small>
              </div>
              {demo ? (
                <button className="icon-button" aria-label="Выйти из деморежима" onClick={exitDemo}>
                  <LogOut size={16} />
                </button>
              ) : (
                <a
                  href="/cdn-cgi/access/logout"
                  className="icon-button"
                  aria-label="Выйти из аккаунта"
                >
                  <LogOut size={16} />
                </a>
              )}
            </div>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="breadcrumb">
              <button
                className="icon-button menu-button"
                aria-label="Открыть меню"
                onClick={() => setMenu(true)}
              >
                <Menu size={20} />
              </button>
              <span>Пространство</span>
              <ChevronDown size={12} className="breadcrumb-chevron" />
              <strong>{navigation.find((n) => n.id === route)?.label}</strong>
            </div>
            <div className="topbar-actions">
              <span
                className={`connection-dot ${data.health.telegram_connected ? 'connected' : ''}`}
                title={data.health.telegram_connected ? 'Telegram подключён' : 'Telegram отключён'}
              />
              <button
                className="icon-button"
                aria-label="Обновить данные"
                disabled={refreshing}
                onClick={() => void refresh().catch((e) => notify(e.message, true))}
              >
                <RefreshCw size={16} className={refreshing ? 'spin' : ''} />
              </button>
              <span className="topbar-divider" />
              <label className={`status-picker ${data.status === 'online' ? 'paused' : 'running'}`}>
                <span className="status-dot" />
                <span className="sr-only">Ручной статус аккаунта</span>
                <select
                  value={data.status}
                  onChange={(e) =>
                    void run(
                      () =>
                        client.request('/status', {
                          method: 'PUT',
                          body: { status: e.target.value as Status },
                        }),
                      'Ручной статус изменён',
                    )
                  }
                >
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="icon-button help-button"
                aria-label="Открыть справку"
                onClick={() => navigate('guide')}
              >
                <CircleHelp size={19} />
              </button>
            </div>
          </header>
          {demo && (
            <div className="demo-banner">
              <span>
                <Sparkles size={14} />
                <strong>Деморежим</strong> · Пример данных. Аккаунт не подключён, изменения не
                сохраняются.
              </span>
              <button onClick={exitDemo}>
                Выйти <ArrowRight size={14} />
              </button>
            </div>
          )}
          {connectionError && (
            <div className="connection-banner" role="alert">
              <span>{connectionError} Отображаются последние полученные данные.</span>
              <a href="/">Войти заново</a>
            </div>
          )}
          <main id="main-content" className="page-content" key={route}>
            {route === 'overview' ? (
              <Overview />
            ) : route === 'sandboxes' ? (
              <Sandboxes />
            ) : route === 'models' ? (
              <Models />
            ) : route === 'activity' ? (
              <ActivityPage />
            ) : route === 'appearance' ? (
              <AppearancePage />
            ) : route === 'security' ? (
              <SecurityPage />
            ) : (
              <Guide />
            )}
            <footer className="page-footer">
              <span>
                Sova <i /> Личный ассистент, личные границы
              </span>
              <span>
                Ваш статус задаёте только вы <ShieldCheck size={13} />
              </span>
            </footer>
          </main>
        </div>
      </div>
      {toast && (
        <div
          className={`toast ${toast.error ? 'error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          <span>{toast.error ? '!' : <Check size={16} />}</span>
          {toast.text}
          <button
            className="icon-button"
            aria-label="Закрыть уведомление"
            onClick={() => setToast(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </Context.Provider>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="M10 11l14 7 14-7v17c0 12-28 12-28 0z" fill="currentColor" />
        <circle cx="17" cy="24" r="4.5" fill="var(--brand-eye)" />
        <circle cx="31" cy="24" r="4.5" fill="var(--brand-eye)" />
        <path d="M20 30h8l-4 5z" fill="var(--brand-eye)" />
      </svg>
      <span>
        sova<span className="brand-period">.</span>
      </span>
      <small>PERSONAL AGENT</small>
    </div>
  );
}
function CloudError() {
  return (
    <div className="login-lock">
      <Zap size={28} />
    </div>
  );
}
function Login({
  checking,
  error,
  onDemo,
}: {
  checking: boolean;
  error: string;
  onDemo: () => void;
}) {
  return (
    <div className="login-page">
      <section className="login-story">
        <Brand />
        <div>
          <div className="eyebrow">НА СВЯЗИ. НА ВАШИХ УСЛОВИЯХ.</div>
          <h1>
            Ваши разговоры.
            <br />
            Ваши границы<span>.</span>
          </h1>
          <p>
            Пока вы заняты — Sova отвечает.
            <br />
            Только тем, кому вы разрешили.
            <br />
            Только то, чем вы готовы поделиться.
          </p>
          <div className="login-tags">
            <span>
              <ShieldCheck size={15} />
              Изоляция контекста
            </span>
            <span>
              <FolderLock size={15} />
              Личные песочницы
            </span>
          </div>
        </div>
        <span className="login-story-footer">Чуть меньше уведомлений. Чуть больше жизни.</span>
        <div className="login-orbit" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      </section>
      <section className="login-form-side">
        <div className="login-form">
          <div className="login-lock">
            <ShieldCheck size={26} />
          </div>
          <Badge tone="green">Личный доступ</Badge>
          <h2>Добро пожаловать домой</h2>
          <p>
            Панель доступна только владельцу.
            <br />
            Войдите через защищённый Cloudflare Access.
          </p>
          {checking ? (
            <div className="login-check">
              <LoaderCircle size={17} className="spin" />
              Проверяем вашу сессию…
            </div>
          ) : (
            <>
              <a className="button primary login-button" href="/">
                Войти через Cloudflare Access
                <ArrowRight size={17} />
              </a>
              {error && (
                <div className="login-notice">
                  <ShieldCheck size={16} />
                  <span>{error}</span>
                </div>
              )}
            </>
          )}
          <div className="login-divider">
            <span>пока подключаете аккаунт</span>
          </div>
          <Button variant="secondary" onClick={onDemo} className="login-button">
            Посмотреть демопанель <ExternalLink size={15} />
          </Button>
          <small className="login-help">
            Настраиваете впервые?{' '}
            <a
              href="https://github.com/alter413/site_on_chatgpt/blob/main/DEPLOYMENT.md"
              target="_blank"
              rel="noreferrer"
            >
              Инструкция подключения
            </a>
          </small>
        </div>
        <div className="login-security">
          <ShieldCheck size={14} />
          Секреты аккаунта не хранятся в браузере
        </div>
      </section>
    </div>
  );
}
