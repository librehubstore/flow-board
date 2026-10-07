import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type User } from '../api';
import { btn, btnPrimary, card, ErrorText, Field, input, useSettings } from '../lib';

function Shell({ children }: { children: React.ReactNode }) {
  const settings = useSettings().data;
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className={`${card} w-full max-w-sm space-y-4 p-6 shadow-sm`}>
        <div className="flex items-center gap-2">
          <img src="/favicon.svg" alt="" className="h-8 w-8" />
          <span className="text-xl font-bold">{settings?.instanceName ?? 'Flowboard'}</span>
        </div>
        {children}
      </div>
    </main>
  );
}

/** Inscription email + mot de passe (onboarding ouvert) : le compte s'active par le lien reçu par email. */
export function Register() {
  const { t } = useTranslation();
  const [form, setForm] = useState({ email: '', fullName: '', password: '', confirm: '' });
  const [mismatch, setMismatch] = useState(false);
  const register = useMutation({
    mutationFn: () =>
      api('/auth/register', {
        body: { email: form.email, fullName: form.fullName, password: form.password },
      }),
  });
  const resend = useMutation({
    mutationFn: () => api('/auth/resend-verification', { body: { email: form.email } }),
  });

  if (register.isSuccess)
    return (
      <Shell>
        <h1 className="text-base font-semibold">{t('register.checkTitle')}</h1>
        <p role="status" className="text-sm">
          {t('register.checkText', { email: form.email })}
        </p>
        <button type="button" className={btn} disabled={resend.isPending} onClick={() => resend.mutate()}>
          {resend.isSuccess ? t('register.resent') : t('register.resend')}
        </button>
        <ErrorText error={resend.error} />
        <Link to="/" className="block text-sm underline">
          {t('register.backToLogin')}
        </Link>
      </Shell>
    );

  return (
    <Shell>
      <h1 className="text-base font-semibold">{t('register.title')}</h1>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setMismatch(form.password !== form.confirm);
          if (form.password === form.confirm) register.mutate();
        }}
      >
        <Field label={t('register.email')}>
          <input
            className={input}
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>
        <Field label={t('profile.fullName')}>
          <input
            className={input}
            autoComplete="name"
            required
            maxLength={100}
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
        </Field>
        <Field label={t('password.next')}>
          <input
            className={input}
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>
        <Field label={t('password.confirm')}>
          <input
            className={input}
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            value={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.value })}
          />
        </Field>
        {mismatch && (
          <p role="alert" className="text-sm text-danger">
            {t('password.mismatch')}
          </p>
        )}
        <ErrorText error={register.error} />
        <button className={`${btnPrimary} w-full`} disabled={register.isPending}>
          {t('register.submit')}
        </button>
      </form>
      <Link to="/" className="block text-sm underline">
        {t('register.backToLogin')}
      </Link>
    </Shell>
  );
}

/** Lien de validation reçu par email : active le compte et connecte l'utilisateur. */
export function VerifyEmail() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const verify = useMutation({
    mutationFn: () => api<User>('/auth/verify-email', { body: { token: params.get('token') ?? '' } }),
    onSuccess: (user) => {
      qc.setQueryData(['me'], user);
      navigate('/', { replace: true });
    },
  });
  // Une seule tentative, même si React rejoue l'effet en développement : le jeton est à usage unique.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    verify.mutate();
  }, [verify]);
  return (
    <Shell>
      <h1 className="text-base font-semibold">{t('register.verifyTitle')}</h1>
      {verify.isError ? (
        <>
          <ErrorText error={verify.error} />
          <Link to="/register" className="block text-sm underline">
            {t('register.title')}
          </Link>
        </>
      ) : (
        <p role="status" className="text-sm text-muted">
          {t('common.loading')}
        </p>
      )}
    </Shell>
  );
}
