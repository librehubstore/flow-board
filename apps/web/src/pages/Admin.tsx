import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  LOCALES,
  ONBOARDING_MODES,
  PERMISSIONS,
  type Permission,
  type UpdateSettingsInput,
} from '@flowboard/shared';
import { api, type Board, type Role, type Settings, type User } from '../api';
import {
  btn,
  btnGhost,
  btnPrimary,
  card,
  cx,
  ErrorText,
  Field,
  formatDate,
  i18n,
  input,
  useDirectory,
  useSettings,
  useTimeZone,
} from '../lib';

const TABS = ['users', 'boards', 'customRoles', 'settings', 'audit'] as const;

export function Admin() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<(typeof TABS)[number]>('users');
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6">
      <h1 className="text-2xl font-bold">{t('admin.title')}</h1>
      <div role="tablist" className="flex gap-1 border-b border-line">
        {TABS.map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            className={cx(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
              tab === k ? 'border-accent text-fg' : 'border-transparent text-muted',
            )}
            onClick={() => setTab(k)}
          >
            {t(`admin.${k}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'users' && <Users />}
        {tab === 'boards' && <AdminBoards />}
        {tab === 'settings' && <InstanceSettings />}
        {tab === 'customRoles' && <Roles />}
        {tab === 'audit' && <Audit />}
      </div>
    </div>
  );
}

function Users() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const tz = useTimeZone();
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api<User[]>('/admin/users') });
  const [form, setForm] = useState({ username: '', fullName: '', password: '', globalRole: 'user' });
  const [temp, setTemp] = useState<{ user: string; password: string } | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    void qc.invalidateQueries({ queryKey: ['users'] });
  };
  const create = useMutation({
    mutationFn: () => api('/admin/users', { body: form }),
    onSuccess: () => {
      setForm({ username: '', fullName: '', password: '', globalRole: 'user' });
      refresh();
    },
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; status?: string; globalRole?: string }) =>
      api(`/admin/users/${id}`, { method: 'PATCH', body }),
    onSuccess: refresh,
  });
  const reset = useMutation({
    mutationFn: (u: User) =>
      api<{ temporaryPassword: string }>(`/admin/users/${u._id}/reset-password`, { method: 'POST' }).then(
        (r) => ({
          user: u.username,
          password: r.temporaryPassword,
        }),
      ),
    onSuccess: setTemp,
  });

  return (
    <div className="space-y-4">
      <form
        className={`${card} grid gap-3 p-4 sm:grid-cols-5 sm:items-end`}
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label={t('admin.username')}>
          <input
            className={input}
            required
            pattern="[a-zA-Z0-9._\-]{3,50}"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
        </Field>
        <Field label={t('admin.fullName')}>
          <input
            className={input}
            required
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
        </Field>
        <Field label={t('admin.initialPassword')}>
          <input
            className={input}
            required
            minLength={10}
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>
        <Field label={t('admin.role')}>
          <select
            className={input}
            value={form.globalRole}
            onChange={(e) => setForm({ ...form, globalRole: e.target.value })}
          >
            <option value="user">{t('admin.roles.user')}</option>
            <option value="admin">{t('admin.roles.admin')}</option>
          </select>
        </Field>
        <button className={btnPrimary} disabled={create.isPending}>
          {t('admin.newUser')}
        </button>
      </form>
      <ErrorText error={create.error ?? update.error ?? reset.error} />
      {temp && (
        <p role="status" className="rounded-md border border-warn p-3 text-sm">
          {t('admin.tempPassword', { user: temp.user, password: temp.password })}{' '}
          <button type="button" className={btnGhost} onClick={() => setTemp(null)}>
            {t('common.close')}
          </button>
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-muted">
            <tr>
              <th className="p-2">{t('admin.username')}</th>
              <th className="p-2">{t('admin.fullName')}</th>
              <th className="p-2">{t('admin.role')}</th>
              <th className="p-2">{t('admin.status')}</th>
              <th className="p-2">{t('admin.lastLogin')}</th>
              <th className="p-2">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.data?.map((u) => (
              <tr key={u._id} className={cx('border-t border-line', u.status === 'disabled' && 'text-muted')}>
                <td className="p-2 font-mono">{u.username}</td>
                <td className="p-2">{u.fullName}</td>
                <td className="p-2">
                  <select
                    className={input}
                    aria-label={`${t('admin.role')} ${u.username}`}
                    value={u.globalRole}
                    onChange={(e) => update.mutate({ id: u._id, globalRole: e.target.value })}
                  >
                    <option value="user">{t('admin.roles.user')}</option>
                    <option value="admin">{t('admin.roles.admin')}</option>
                  </select>
                </td>
                <td className="p-2">{t(`admin.statuses.${u.status}`)}</td>
                <td className="p-2">
                  {u.lastLoginAt ? formatDate(u.lastLoginAt, i18n.language, tz, true) : t('admin.never')}
                </td>
                <td className="flex flex-wrap gap-1 p-2">
                  <button
                    type="button"
                    className={btn}
                    onClick={() =>
                      update.mutate({ id: u._id, status: u.status === 'active' ? 'disabled' : 'active' })
                    }
                  >
                    {u.status === 'active' ? t('admin.disable') : t('admin.enable')}
                  </button>
                  <button type="button" className={btn} onClick={() => reset.mutate(u)}>
                    {t('admin.resetPassword')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminBoards() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const tz = useTimeZone();
  const users = useDirectory().data ?? [];
  const boards = useQuery({ queryKey: ['admin', 'boards'], queryFn: () => api<Board[]>('/admin/boards') });
  const done = () => void qc.invalidateQueries({ queryKey: ['admin', 'boards'] });
  const restore = useMutation({
    mutationFn: (id: string) => api(`/admin/boards/${id}/restore`, { method: 'POST' }),
    onSuccess: done,
  });
  const transfer = useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string }) =>
      api(`/admin/boards/${id}/transfer`, { body: { userId } }),
    onSuccess: done,
  });
  const name = (id: string) => users.find((u) => u._id === id)?.fullName ?? '?';

  return (
    <div className="space-y-2">
      <ErrorText error={restore.error ?? transfer.error} />
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-muted">
          <tr>
            <th className="p-2">{t('common.name')}</th>
            <th className="p-2">{t('admin.owners')}</th>
            <th className="p-2">{t('common.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {boards.data?.map((b) => (
            <tr key={b._id} className="border-t border-line">
              <td className="p-2">
                {b.name}
                {b.deletedAt && (
                  <span className="ml-2 text-xs text-danger">
                    {t('admin.trash')} · {formatDate(b.deletedAt, i18n.language, tz)}
                  </span>
                )}
              </td>
              <td className="p-2">
                {b.members
                  .filter((m) => m.role === 'owner')
                  .map((m) => name(m.userId))
                  .join(', ')}
              </td>
              <td className="flex gap-2 p-2">
                {b.deletedAt ? (
                  <button type="button" className={btn} onClick={() => restore.mutate(b._id)}>
                    {t('admin.restore')}
                  </button>
                ) : (
                  <select
                    className={input}
                    aria-label={`${t('admin.transfer')} ${b.name}`}
                    value=""
                    onChange={(e) => e.target.value && transfer.mutate({ id: b._id, userId: e.target.value })}
                  >
                    <option value="">{t('admin.transfer')}</option>
                    {users
                      .filter((u) => u.status === 'active')
                      .map((u) => (
                        <option key={u._id} value={u._id}>
                          {u.fullName} (@{u.username})
                        </option>
                      ))}
                  </select>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InstanceSettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const current = useSettings().data;
  const [form, setForm] = useState<UpdateSettingsInput | null>(null);
  // Valeurs serveur + modifications en cours (le formulaire ne garde que les champs modifiés).
  const value = current && { ...current, ...form };
  const save = useMutation({
    mutationFn: () => api<Settings>('/admin/settings', { method: 'PATCH', body: form }),
    onSuccess: (s) => {
      qc.setQueryData(['settings'], s);
      setForm(null);
    },
  });
  if (!value) return null;
  const set = (p: UpdateSettingsInput) => setForm({ ...(form ?? {}), ...p });
  return (
    <form
      className={`${card} max-w-lg space-y-3 p-4`}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field label={t('admin.instanceName')}>
        <input
          className={input}
          required
          value={value.instanceName}
          onChange={(e) => set({ instanceName: e.target.value })}
        />
      </Field>
      <Field label={t('admin.defaultLocale')}>
        <select
          className={input}
          value={value.defaultLocale}
          onChange={(e) => set({ defaultLocale: e.target.value as 'fr' })}
        >
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {l === 'fr' ? 'Français' : 'English'}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('admin.defaultTimezone')}>
        <input
          className={input}
          value={value.defaultTimezone}
          onChange={(e) => set({ defaultTimezone: e.target.value })}
        />
      </Field>
      <Field label={t('admin.maxAttachmentMb')}>
        <input
          className={input}
          type="number"
          min={1}
          max={1024}
          value={value.maxAttachmentMb}
          onChange={(e) => set({ maxAttachmentMb: Number(e.target.value) })}
        />
      </Field>
      <fieldset className="space-y-2 border-t border-line pt-3">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
          {t('admin.onboarding')}
        </legend>
        {ONBOARDING_MODES.map((m) => (
          <label key={m} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="onboarding"
              className="mt-1"
              checked={value.onboarding === m}
              onChange={() => set({ onboarding: m })}
            />
            <span>
              <strong className="block">{t(`admin.onboardingModes.${m}`)}</strong>
              <span className="text-muted">{t(`admin.onboardingHints.${m}`)}</span>
            </span>
          </label>
        ))}
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          {t('admin.registrationMethods')}
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.registration.password}
            onChange={(e) => set({ registration: { ...value.registration, password: e.target.checked } })}
          />
          {t('admin.methodPassword')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.registration.google}
            disabled={!current?.googleAvailable}
            onChange={(e) => set({ registration: { ...value.registration, google: e.target.checked } })}
          />
          {t('admin.methodGoogle')}
          {!current?.googleAvailable && (
            <span className="text-xs text-muted">({t('admin.googleNotConfigured')})</span>
          )}
        </label>
        <Field label={t('admin.allowedDomains')} hint={t('admin.allowedDomainsHint')}>
          <input
            className={input}
            placeholder="librehub.store"
            defaultValue={value.allowedDomains.join(', ')}
            onBlur={(e) =>
              set({
                allowedDomains: e.target.value
                  .split(/[\s,;]+/)
                  .map((d) => d.trim().toLowerCase())
                  .filter(Boolean),
              })
            }
          />
        </Field>
      </fieldset>
      <ErrorText error={save.error} />
      <button className={btnPrimary} disabled={!form || save.isPending}>
        {t('common.save')}
      </button>
    </form>
  );
}

function Audit() {
  const { t } = useTranslation();
  const tz = useTimeZone();
  const users = useDirectory().data ?? [];
  const audit = useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: () =>
      api<{ _id: string; actorId: string; action: string; targetId: string | null; at: string }[]>(
        '/admin/audit',
      ),
  });
  const name = (id: string | null) => users.find((u) => u._id === id)?.username ?? id ?? '';
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs uppercase text-muted">
        <tr>
          <th className="p-2">{t('admin.when')}</th>
          <th className="p-2">{t('admin.actor')}</th>
          <th className="p-2">{t('admin.action')}</th>
          <th className="p-2">{t('admin.target')}</th>
        </tr>
      </thead>
      <tbody>
        {audit.data?.map((a) => (
          <tr key={a._id} className="border-t border-line">
            <td className="p-2">{formatDate(a.at, i18n.language, tz, true)}</td>
            <td className="p-2">{name(a.actorId)}</td>
            <td className="p-2 font-mono">{a.action}</td>
            <td className="p-2">{name(a.targetId)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Rôles personnalisés (spec § 4.10) : un ensemble de permissions unitaires, attribuable dans tout board. */
function Roles() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/roles') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['roles'] });
  const [draft, setDraft] = useState<{ name: string; permissions: Permission[] }>({
    name: '',
    permissions: ['board.view'],
  });
  const create = useMutation({
    mutationFn: () => api('/admin/roles', { body: draft }),
    onSuccess: () => {
      setDraft({ name: '', permissions: ['board.view'] });
      void refresh();
    },
  });
  const update = useMutation({
    mutationFn: (r: Role) =>
      api(`/admin/roles/${r._id}`, { method: 'PATCH', body: { name: r.name, permissions: r.permissions } }),
    onSuccess: refresh,
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/admin/roles/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
  const toggle = (list: Permission[], p: Permission) =>
    list.includes(p) ? list.filter((x) => x !== p) : [...list, p];
  const checkboxes = (value: Permission[], onChange: (v: Permission[]) => void, name: string) => (
    <div className="grid gap-1 sm:grid-cols-3">
      {PERMISSIONS.map((p) => (
        <label key={p} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            aria-label={`${t(`permissions.${p}`)} — ${name}`}
            checked={value.includes(p)}
            disabled={p === 'board.view'}
            onChange={() => onChange(toggle(value, p))}
          />
          {t(`permissions.${p}`)}
        </label>
      ))}
    </div>
  );
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t('admin.rolesHint')}</p>
      {roles.data?.map((r) => (
        <div key={r._id} className={`${card} space-y-2 p-4`}>
          <div className="flex items-center gap-2">
            <input
              className={`${input} flex-1`}
              aria-label={`${t('common.name')} — ${r.name}`}
              defaultValue={r.name}
              key={r.name}
              maxLength={50}
              onBlur={(e) =>
                e.target.value.trim() &&
                e.target.value !== r.name &&
                update.mutate({ ...r, name: e.target.value.trim() })
              }
            />
            <button type="button" className={btn} onClick={() => del.mutate(r._id)}>
              {t('common.delete')}
            </button>
          </div>
          {checkboxes(r.permissions, (permissions) => update.mutate({ ...r, permissions }), r.name)}
        </div>
      ))}
      <form
        className={`${card} space-y-2 p-4`}
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.name.trim()) create.mutate();
        }}
      >
        <Field label={t('admin.newRole')}>
          <input
            className={input}
            required
            maxLength={50}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </Field>
        {checkboxes(
          draft.permissions,
          (permissions) => setDraft({ ...draft, permissions }),
          t('admin.newRole'),
        )}
        <button className={btnPrimary}>{t('common.create')}</button>
      </form>
      <ErrorText error={create.error ?? update.error ?? del.error ?? roles.error} />
    </div>
  );
}
