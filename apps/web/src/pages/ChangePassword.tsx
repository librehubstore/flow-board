import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { btn, btnPrimary, card, ErrorText, Field, input } from '../lib';

/** Changement de mot de passe ; `forced` = écran bloquant après création ou réinitialisation du compte. */
export function ChangePassword({ forced = false }: { forced?: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const change = useMutation({
    mutationFn: () => api('/auth/password', { body: { currentPassword: current, newPassword: next } }),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setConfirm('');
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const logout = () => api('/auth/logout', { method: 'POST' }).then(() => (location.href = '/'));

  const form = (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setMismatch(next !== confirm);
        if (next === confirm) change.mutate();
      }}
    >
      {forced && (
        <>
          <h1 className="text-lg font-bold">{t('password.forcedTitle')}</h1>
          <p className="text-sm text-muted">{t('password.forcedHint')}</p>
        </>
      )}
      <Field label={t('password.current')}>
        <input
          className={input}
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </Field>
      <Field label={t('password.next')}>
        <input
          className={input}
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </Field>
      <Field label={t('password.confirm')}>
        <input
          className={input}
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </Field>
      {mismatch && (
        <p role="alert" className="text-sm text-danger">
          {t('password.mismatch')}
        </p>
      )}
      <ErrorText error={change.error} />
      {change.isSuccess && !forced && (
        <p role="status" className="text-sm text-ok">
          {t('password.changed')}
        </p>
      )}
      <div className="flex gap-2">
        <button className={btnPrimary} disabled={change.isPending}>
          {t('common.save')}
        </button>
        {forced && (
          <button type="button" className={btn} onClick={() => void logout()}>
            {t('nav.logout')}
          </button>
        )}
      </div>
    </form>
  );
  if (!forced) return form;
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className={`${card} w-full max-w-sm p-6`}>{form}</div>
    </main>
  );
}
