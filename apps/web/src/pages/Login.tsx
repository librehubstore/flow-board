import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type User } from '../api';
import { btnPrimary, card, ErrorText, Field, input, useSettings } from '../lib';

export function Login() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const settings = useSettings().data;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api<User>('/auth/login', { body: { username, password } }),
    onSuccess: (user) => qc.setQueryData(['me'], user),
  });

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form
        className={`${card} w-full max-w-sm space-y-4 p-6 shadow-sm`}
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate();
        }}
      >
        <div className="flex items-center gap-2">
          <img src="/favicon.svg" alt="" className="h-8 w-8" />
          <h1 className="text-xl font-bold">{settings?.instanceName ?? 'Flowboard'}</h1>
        </div>
        <h2 className="text-base font-semibold">{t('login.title')}</h2>
        <Field label={t('login.username')}>
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
        <p className="text-xs text-muted">{t('login.hint')}</p>
      </form>
    </main>
  );
}
