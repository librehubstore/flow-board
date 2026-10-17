import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Bell,
  ChartColumn,
  ChevronDown,
  LayoutGrid,
  LogOut,
  RotateCw,
  Search,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { api, ApiError, type AppNotification } from './api';
import { Avatar, btnGhost, cx, formatDate, i18n, useDirectory, useMe, useSettings, useTimeZone } from './lib';
import { closeSocket, getSocket } from './socket';
import { Login } from './pages/Login';
import { Register, VerifyEmail } from './pages/Register';
import { ChangePassword } from './pages/ChangePassword';
import { Boards } from './pages/Boards';
import { Profile } from './pages/Profile';
import { Admin } from './pages/Admin';
import { Reports } from './pages/Reports';
import { BoardPage, WallPage } from './board/BoardPage';
import { SearchDialog } from './SearchDialog';
import { ShortcutsHelp, useShortcuts } from './Shortcuts';
import { TimerBar } from './TimerBar';

export function App() {
  const me = useMe();
  const { pathname } = useLocation();
  const settings = useSettings();

  // Langue et thème suivent le profil, sinon l'instance / le système.
  const locale = me.data?.locale ?? settings.data?.defaultLocale;
  useEffect(() => {
    if (locale && i18n.language !== locale) void i18n.changeLanguage(locale);
    document.documentElement.lang = i18n.language;
  }, [locale]);
  const theme = me.data?.theme ?? 'system';
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () =>
      document.documentElement.classList.toggle(
        'dark',
        theme === 'dark' || (theme === 'system' && media.matches),
      );
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    if (settings.data) document.title = settings.data.instanceName;
  }, [settings.data]);

  if (me.isPending) return null;
  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401)
      return (
        <Routes>
          <Route path="/register" element={<Register />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="*" element={<Login />} />
        </Routes>
      );
    return <p className="p-8 text-danger">{String(me.error.message)}</p>;
  }
  if (me.data.mustChangePassword) return <ChangePassword forced />;
  // Mode mur : hors du gabarit (ni en-tête ni barre de minuteur).
  if (/^\/boards\/[^/]+\/wall$/.test(pathname))
    return (
      <Routes>
        <Route path="/boards/:boardId/wall" element={<WallPage />} />
      </Routes>
    );
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Boards />} />
        <Route path="/boards/:boardId" element={<BoardPage />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/reports" element={<Reports />} />
        {me.data.globalRole === 'admin' && <Route path="/admin" element={<Admin />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const me = useMe().data!;
  const settings = useSettings().data;
  const qc = useQueryClient();

  useEffect(() => {
    const socket = getSocket();
    const onNotification = () => void qc.invalidateQueries({ queryKey: ['notifications'] });
    socket.on('notification', onNotification);
    return () => {
      socket.off('notification', onNotification);
    };
  }, [qc]);

  const logout = useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      closeSocket();
      qc.clear();
      location.href = '/';
    },
  });

  const [searching, setSearching] = useState(false);
  const { help, closeHelp } = useShortcuts(useCallback(() => setSearching(true), []));

  const nav = ({ isActive }: { isActive: boolean }) =>
    cx(btnGhost, 'gap-1.5 px-2.5', isActive && 'bg-surface-2 font-medium text-fg');
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:p-2"
      >
        {t('nav.skip')}
      </a>
      <header className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-surface px-3 py-1.5 sm:px-4">
        <Link to="/" className="flex items-center gap-2 rounded-md pr-1 font-semibold tracking-tight">
          <img src="/favicon.svg" alt="" className="h-6 w-6" />
          <span className="hidden max-w-48 truncate sm:inline">{settings?.instanceName ?? 'Flowboard'}</span>
        </Link>
        <span aria-hidden className="hidden h-5 w-px bg-line sm:block" />
        <nav className="flex items-center gap-0.5">
          <NavLink to="/" end className={nav}>
            <LayoutGrid size={15} />
            {t('nav.boards')}
          </NavLink>
          <NavLink to="/reports" className={nav}>
            <ChartColumn size={15} />
            {t('nav.reports')}
          </NavLink>
          {me.globalRole === 'admin' && (
            <NavLink to="/admin" className={nav}>
              <ShieldCheck size={15} />
              {t('nav.admin')}
            </NavLink>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className="inline-flex h-8 items-center gap-2 rounded-md border border-line bg-bg px-2.5 text-sm text-muted transition-colors hover:border-muted hover:text-fg sm:w-56"
            onClick={() => setSearching(true)}
            aria-label={t('search.title')}
            title="/ · Ctrl+K"
          >
            <Search size={15} />
            <span className="hidden flex-1 text-left sm:inline">{t('search.title')}…</span>
            <kbd className="hidden rounded border border-line bg-surface px-1.5 font-sans text-[11px] sm:inline">
              Ctrl K
            </kbd>
          </button>
          <NotificationsBell />
          <UserMenu onLogout={() => logout.mutate()} />
        </div>
      </header>
      <TimerBar />
      <main id="main" className="flex min-h-0 flex-1 flex-col">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
      <SearchDialog open={searching} onClose={() => setSearching(false)} />
      <ShortcutsHelp open={help} onClose={closeHelp} />
    </div>
  );
}

/** Ferme un menu déroulant au clic extérieur ou sur Échap, et rend le focus au bouton. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      close();
      ref.current?.querySelector<HTMLElement>('[aria-expanded]')?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

function UserMenu({ onLogout }: { onLogout: () => void }) {
  const { t } = useTranslation();
  const me = useMe().data!;
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const item =
    'flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm hover:bg-surface-2 focus-visible:bg-surface-2';
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className={cx(btnGhost, 'gap-2 pl-1 pr-1.5 text-fg')}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={t('nav.profile')}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar name={me.fullName} size={26} />
        <span className="hidden max-w-40 truncate sm:inline">{me.fullName}</span>
        <ChevronDown size={14} className="text-muted" />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-60 rounded-lg border border-line bg-surface p-1 shadow-lg">
          <div className="border-b border-line px-2.5 pb-2 pt-1.5">
            <p className="truncate font-medium">{me.fullName}</p>
            {me.email && <p className="truncate text-xs text-muted">{me.email}</p>}
          </div>
          <div className="pt-1">
            <Link to="/profile" className={item} onClick={close}>
              <UserRound size={15} className="text-muted" />
              {t('nav.profile')}
            </Link>
            <button type="button" className={item} onClick={onLogout}>
              <LogOut size={15} className="text-muted" />
              {t('nav.logout')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationsBell() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tz = useTimeZone();
  const users = useDirectory().data ?? [];
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ items: AppNotification[]; unread: number }>('/notifications'),
  });
  const read = useMutation({
    mutationFn: (ids?: string[]) => api('/notifications/read', { body: { ids } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = data?.unread ?? 0;
  const actor = (id?: string | null) =>
    users.find((u) => u._id === id)?.fullName ?? t('notifications.someone');

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className={cx(btnGhost, 'relative h-8 w-8 px-0')}
        aria-expanded={open}
        aria-label={`${t('nav.notifications')} (${unread})`}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={17} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-white ring-2 ring-surface">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-80 max-w-[calc(100vw-1.5rem)] rounded-lg border border-line bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <strong>{t('nav.notifications')}</strong>
            {unread > 0 && (
              <button type="button" className={btnGhost} onClick={() => read.mutate(undefined)}>
                {t('notifications.markAll')}
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-auto">
            {!data?.items.length && <li className="p-3 text-muted">{t('notifications.empty')}</li>}
            {data?.items.map((n) => (
              <li key={n._id}>
                <button
                  type="button"
                  className={cx(
                    'block w-full px-3 py-2 text-left hover:bg-surface-2',
                    !n.readAt && 'font-semibold',
                  )}
                  onClick={() => {
                    if (!n.readAt) read.mutate([n._id]);
                    setOpen(false);
                    navigate(`/boards/${n.boardId}?task=${n.taskId}`);
                  }}
                >
                  <span className="block">
                    {t(`notifications.types.${n.type}`, {
                      actor: actor(n.payload.actorId),
                      task: n.payload.taskName ?? '',
                    })}
                  </span>
                  <span className="text-xs font-normal text-muted">
                    {formatDate(n.createdAt, i18n.language, tz, true)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Une erreur de rendu affiche un message au lieu de démonter toute l'application. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="m-6 space-y-2">
        <p className="font-semibold text-danger">{i18n.t('errors.generic')}</p>
        <pre className="text-xs text-muted">{this.state.error.message}</pre>
        <button
          type="button"
          className={btnGhost}
          onClick={() => location.reload()}
          aria-label={i18n.t('common.reload')}
        >
          <RotateCw size={16} />
        </button>
      </div>
    );
  }
}
