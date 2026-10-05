import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { LOCALES, NOTIFICATION_TYPES, THEMES, type UpdateProfileInput } from '@flowboard/shared';
import { api, type User } from '../api';
import { btnPrimary, card, ErrorText, Field, input, useMe } from '../lib';
import { ChangePassword } from './ChangePassword';

const TIMEZONES: string[] = Intl.supportedValuesOf?.('timeZone') ?? [];

export function Profile() {
  const { t } = useTranslation();
  const me = useMe().data!;
  const qc = useQueryClient();
  const [form, setForm] = useState<UpdateProfileInput>({
    fullName: me.fullName,
    email: me.email,
    locale: me.locale,
    timezone: me.timezone,
    theme: me.theme,
    notificationPrefs: me.notificationPrefs ?? {},
  });
  const save = useMutation({
    mutationFn: () => api<User>('/me', { method: 'PATCH', body: form }),
    onSuccess: (u) => qc.setQueryData(['me'], u),
  });
  const set = (patch: UpdateProfileInput) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-bold">{t('profile.title')}</h1>
      <form
        className={`${card} space-y-4 p-5`}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <p className="text-sm text-muted">@{me.username}</p>
        <Field label={t('profile.fullName')}>
          <input
            className={input}
            required
            maxLength={100}
            value={form.fullName ?? ''}
            onChange={(e) => set({ fullName: e.target.value })}
          />
        </Field>
        <Field label={t('profile.email')}>
          <input
            className={input}
            type="email"
            value={form.email ?? ''}
            onChange={(e) => set({ email: e.target.value || null })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('profile.locale')}>
            <select
              className={input}
              value={form.locale ?? ''}
              onChange={(e) => set({ locale: (e.target.value || null) as UpdateProfileInput['locale'] })}
            >
              <option value="">{t('profile.default')}</option>
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {l === 'fr' ? 'Français' : 'English'}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('profile.timezone')}>
            <input
              className={input}
              list="timezones"
              placeholder={t('profile.default')}
              value={form.timezone ?? ''}
              onChange={(e) => set({ timezone: e.target.value || null })}
            />
            <datalist id="timezones">
              {TIMEZONES.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </Field>
          <Field label={t('profile.theme')}>
            <select
              className={input}
              value={form.theme}
              onChange={(e) => set({ theme: e.target.value as UpdateProfileInput['theme'] })}
            >
              {THEMES.map((th) => (
                <option key={th} value={th}>
                  {t(`profile.themes.${th}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <fieldset className="space-y-1">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
            {t('profile.notifications')}
          </legend>
          {NOTIFICATION_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.notificationPrefs?.[type] !== false}
                onChange={(e) => set({ notificationPrefs: { ...form.notificationPrefs, [type]: e.target.checked } })}
              />
              {t(`notifications.prefs.${type}`)}
            </label>
          ))}
        </fieldset>
        <ErrorText error={save.error} />
        <div className="flex items-center gap-3">
          <button className={btnPrimary} disabled={save.isPending}>
            {t('common.save')}
          </button>
          {save.isSuccess && (
            <span role="status" className="text-sm text-ok">
              {t('common.saved')}
            </span>
          )}
        </div>
      </form>
      <section className={`${card} p-5`}>
        <h2 className="mb-3 text-lg font-semibold">{t('password.title')}</h2>
        <ChangePassword />
      </section>
    </div>
  );
}
