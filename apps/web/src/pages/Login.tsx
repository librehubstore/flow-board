import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type User } from '../api';
import { btn, btnPrimary, card, ErrorText, Field, input, useSettings } from '../lib';

/** Logo Google officiel (« G » multicolore), exigé par les consignes de marque des boutons Google. */
function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

export function Login() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const settings = useSettings().data;
  const [params] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api<User>('/auth/login', { body: { username, password } }),
    onSuccess: (user) => qc.setQueryData(['me'], user),
  });
  const open = settings?.onboarding === 'open';
  const google = !!(settings?.googleAvailable && settings.registration.google);
  const authError = params.get('auth_error');

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className={`${card} w-full max-w-sm space-y-4 p-6 shadow-sm`}>
        <div className="flex items-center gap-2">
          <img src="/favicon.svg" alt="" className="h-8 w-8" />
          <h1 className="text-xl font-bold">{settings?.instanceName ?? 'Flowboard'}</h1>
        </div>
        <h2 className="text-base font-semibold">{t('login.title')}</h2>
        {authError && (
          <p role="alert" className="text-sm text-danger">
            {t(`errors.${authError}`, { defaultValue: t('errors.generic') })}
          </p>
        )}
        {google && (
          <>
            {/* Navigation complète (pas de fetch) : Google redirige ensuite vers /api/auth/google/callback. */}
            <a href="/api/auth/google" className={`${btn} w-full py-2`}>
              <GoogleLogo />
              {t('login.google')}
            </a>
            <p className="flex items-center gap-2 text-xs text-muted before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
              {t('login.or')}
            </p>
          </>
        )}
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate();
          }}
        >
          <Field label={open ? t('login.usernameOrEmail') : t('login.username')}>
            <input
              className={input}
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>
          <Field label={t('login.password')}>
            <input
              className={input}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <ErrorText error={login.error} />
          <button className={`${btnPrimary} w-full`} disabled={login.isPending}>
            {t('login.submit')}
          </button>
        </form>
        {open && settings?.registration.password ? (
          <p className="text-sm">
            {t('login.noAccount')}{' '}
            <Link to="/register" className="font-semibold text-accent underline">
              {t('register.title')}
            </Link>
          </p>
        ) : (
          <p className="text-xs text-muted">{t('login.hint')}</p>
        )}
      </div>
    </main>
  );
}
