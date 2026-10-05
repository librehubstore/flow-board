import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, ApiError, type AppNotification } from './api';
import { Avatar, btnGhost, cx, formatDate, i18n, useDirectory, useMe, useSettings, useTimeZone } from './lib';
import { closeSocket, getSocket } from './socket';
import { Login } from './pages/Login';
import { ChangePassword } from './pages/ChangePassword';
import { Boards } from './pages/Boards';
import { Profile } from './pages/Profile';
import { Admin } from './pages/Admin';
import { BoardPage } from './board/BoardPage';

export function App() {
  const me = useMe();
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
    const apply = () => document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && media.matches));
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    if (settings.data) document.title = settings.data.instanceName;
  }, [settings.data]);

  if (me.isPending) return null;
  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401) return <Login />;
    return <p className="p-8 text-danger">{String(me.error.message)}</p>;
  }
  if (me.data.mustChangePassword) return <ChangePassword forced />;
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Boards />} />
        <Route path="/boards/:boardId" element={<BoardPage />} />
        <Route path="/profile" element={<Profile />} />
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

  const nav = ({ isActive }: { isActive: boolean }) => cx(btnGhost, isActive && 'bg-surface-2 text-fg');
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:p-2">
        {t('nav.skip')}
      </a>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-surface px-3 py-2">
        <Link to="/" className="mr-2 flex items-center gap-2 font-bold">
          <img src="/favicon.svg" alt="" className="h-6 w-6" />
          <span className="hidden sm:inline">{settings?.instanceName ?? 'Flowboard'}</span>
        </Link>
        <nav className="flex items-center gap-1">
          <NavLink to="/" end className={nav}>
            {t('nav.boards')}
          </NavLink>
          {me.globalRole === 'admin' && (
            <NavLink to="/admin" className={nav}>
              {t('nav.admin')}
            </NavLink>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <NotificationsBell />
          <NavLink to="/profile" className={nav} aria-label={t('nav.profile')}>
            <Avatar name={me.fullName} />
            <span className="hidden sm:inline">{me.fullName}</span>
          </NavLink>
          <button type="button" className={btnGhost} onClick={() => logout.mutate()}>
            {t('nav.logout')}
          </button>
        </div>
      </header>
      <main id="main" className="flex min-h-0 flex-1 flex-col">
        {children}
      </main>
    </div>
  );
}

function NotificationsBell() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
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
  const actor = (id?: string | null) => users.find((u) => u._id === id)?.fullName ?? t('notifications.someone');

  return (
    <div className="relative">
      <button
        type="button"
        className={cx(btnGhost, 'relative')}
        aria-expanded={open}
        aria-label={`${t('nav.notifications')} (${unread})`}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-white">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-80 rounded-lg border border-line bg-surface shadow-xl">
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
                  className={cx('block w-full px-3 py-2 text-left hover:bg-surface-2', !n.readAt && 'font-semibold')}
                  onClick={() => {
                    if (!n.readAt) read.mutate([n._id]);
                    setOpen(false);
                    navigate(`/boards/${n.boardId}?task=${n.taskId}`);
                  }}
                >
                  <span className="block">
                    {t(`notifications.types.${n.type}`, { actor: actor(n.payload.actorId), task: n.payload.taskName ?? '' })}
                  </span>
                  <span className="text-xs font-normal text-muted">{formatDate(n.createdAt, i18n.language, tz, true)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
