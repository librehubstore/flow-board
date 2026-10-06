import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BOARD_ROLES, COLORS, CUSTOM_FIELD_TYPES, type BoardRole } from '@flowboard/shared';
import { api, type Board, type Column, type CustomField, type Role, type Swimlane } from '../api';
import {
  Avatar,
  btn,
  btnDanger,
  btnGhost,
  btnPrimary,
  colorHex,
  ErrorText,
  Field,
  input,
  Modal,
  useDirectory,
} from '../lib';
import { useBoard } from './context';

/** Tous les réglages du board dans un seul panneau (spec § 4.2, irritant « trop de clics »). */
export function BoardSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { can } = useBoard();
  return (
    <Modal open={open} onClose={onClose} title={t('board.settings')} wide>
      <div className="space-y-8">
        {can('board.structure') && (
          <>
            <General />
            <Items kind="columns" />
            <Items kind="swimlanes" />
            <ColorLegend />
            <CustomFields />
          </>
        )}
        {can('board.members') && <Members />}
        {can('board.structure') && (
          <>
            <CopyBoard onDone={onClose} />
            <Danger />
          </>
        )}
      </div>
    </Modal>
  );
}

/** Mutation sur le board puis rechargement (le serveur diffuse aussi `board.changed` aux autres). */
function useBoardMutation<V>(fn: (v: V) => Promise<unknown>) {
  const { data } = useBoard();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['board', data.board._id] }),
  });
}

const h2 = 'mb-3 text-base font-semibold';

function General() {
  const { t } = useTranslation();
  const { data } = useBoard();
  const { board } = data;
  const [name, setName] = useState(board.name);
  const [description, setDescription] = useState(board.description);
  const save = useBoardMutation((body: object) => api(`/boards/${board._id}`, { method: 'PATCH', body }));
  return (
    <section>
      <h3 className={h2}>{t('settings.general')}</h3>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ name, description });
        }}
      >
        <Field label={t('common.name')}>
          <input
            className={input}
            required
            maxLength={255}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label={t('common.description')}>
          <textarea className={input} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label={t('settings.completionColumn')}>
          <select
            className={input}
            // Non contrôlés (clé = valeur serveur) : pas de retour visuel à l'ancien état avant le rechargement du board.
            key={board.completionColumnId}
            defaultValue={board.completionColumnId}
            onChange={(e) => save.mutate({ completionColumnId: e.target.value })}
          >
            {board.columns.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
            {t('settings.numbering')}
          </legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              key={`n${!!board.taskNumbering?.enabled}`}
              defaultChecked={!!board.taskNumbering?.enabled}
              onChange={(e) =>
                save.mutate({
                  taskNumbering: { enabled: e.target.checked, prefix: board.taskNumbering?.prefix ?? '' },
                })
              }
            />
            {t('settings.numberingEnabled')}
          </label>
          {board.taskNumbering?.enabled && (
            <input
              className={`${input} w-40`}
              aria-label={t('settings.numberingPrefix')}
              placeholder={t('settings.numberingPrefix')}
              maxLength={10}
              defaultValue={board.taskNumbering.prefix}
              onBlur={(e) =>
                e.target.value !== board.taskNumbering!.prefix &&
                save.mutate({ taskNumbering: { enabled: true, prefix: e.target.value } })
              }
            />
          )}
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            key={`t${!!board.isTemplate}`}
            defaultChecked={!!board.isTemplate}
            onChange={(e) => save.mutate({ isTemplate: e.target.checked })}
          />
          {t('settings.isTemplate')}
        </label>
        <ErrorText error={save.error} />
        <button className={btnPrimary}>{t('common.save')}</button>
      </form>
    </section>
  );
}

/** Colonnes ou swimlanes : ajout, renommage, réordonnancement, suppression avec destination. */
function Items({ kind }: { kind: 'columns' | 'swimlanes' }) {
  const { t } = useTranslation();
  const { data } = useBoard();
  const { board } = data;
  const items: (Column | Swimlane)[] = board[kind];
  const base = `/boards/${board._id}/${kind}`;
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [destination, setDestination] = useState('');
  const add = useBoardMutation((n: string) => api(base, { body: { name: n } }));
  const update = useBoardMutation(
    ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      wipLimit?: number | null;
      wipUnit?: string;
      description?: string;
    }) => api(`${base}/${id}`, { method: 'PATCH', body }),
  );
  const reorder = useBoardMutation((ids: string[]) => api(`${base}/order`, { method: 'PUT', body: { ids } }));
  const del = useBoardMutation((v: { id: string; destinationId?: string }) =>
    api(`${base}/${v.id}`, { method: 'DELETE', body: { destinationId: v.destinationId } }),
  );
  const count = (id: string) =>
    data.tasks.filter((x) => (kind === 'columns' ? x.columnId : x.swimlaneId) === id).length;
  const moveBy = (i: number, d: number) => {
    const ids = items.map((x) => x._id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    reorder.mutate(ids);
  };
  const remove = (id: string) => {
    const needsDestination = count(id) > 0 && !(kind === 'swimlanes' && items.length === 1);
    if (needsDestination && !destination) return setDeleting(id);
    del.mutate(
      { id, destinationId: needsDestination ? destination : undefined },
      { onSuccess: () => setDeleting(null) },
    );
  };

  return (
    <section>
      <h3 className={h2}>{t(`settings.${kind}`)}</h3>
      {kind === 'swimlanes' && !items.length && (
        <p className="mb-2 text-sm text-muted">{t('settings.noSwimlanes')}</p>
      )}
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={item._id} className="flex flex-wrap items-center gap-2">
            <input
              className={`${input} min-w-40 flex-1`}
              aria-label={`${t('common.name')} — ${item.name}`}
              defaultValue={item.name}
              key={item.name}
              maxLength={255}
              onBlur={(e) =>
                e.target.value.trim() &&
                e.target.value !== item.name &&
                update.mutate({ id: item._id, name: e.target.value.trim() })
              }
            />
            {'wipLimit' in item && (
              <input
                type="number"
                min={1}
                className={`${input} w-24`}
                aria-label={`${t('board.wip')} — ${item.name}`}
                placeholder={t('board.wip')}
                defaultValue={item.wipLimit ?? ''}
                key={`w${item.wipLimit}`}
                onBlur={(e) => {
                  const v = e.target.value === '' ? null : Number(e.target.value);
                  if (v !== item.wipLimit) update.mutate({ id: item._id, wipLimit: v });
                }}
              />
            )}
            {'wipLimit' in item && (
              <select
                className={`${input} w-32`}
                aria-label={`${t('settings.wipUnit')} — ${item.name}`}
                key={`u${item.wipUnit}`}
                defaultValue={item.wipUnit ?? 'tasks'}
                onChange={(e) => update.mutate({ id: item._id, wipUnit: e.target.value })}
              >
                <option value="tasks">{t('settings.wipUnits.tasks')}</option>
                <option value="pomodoros">{t('settings.wipUnits.pomodoros')}</option>
              </select>
            )}
            <button
              type="button"
              className={btnGhost}
              disabled={i === 0}
              onClick={() => moveBy(i, -1)}
              aria-label={`${t('common.moveUp')} — ${item.name}`}
            >
              ↑
            </button>
            <button
              type="button"
              className={btnGhost}
              disabled={i === items.length - 1}
              onClick={() => moveBy(i, 1)}
              aria-label={`${t('common.moveDown')} — ${item.name}`}
            >
              ↓
            </button>
            <button
              type="button"
              className={btnGhost}
              onClick={() => remove(item._id)}
              aria-label={`${t('common.delete')} — ${item.name}`}
            >
              ✕
            </button>
            {deleting === item._id && (
              <span className="flex w-full items-center gap-2 text-sm">
                <label className="flex items-center gap-2">
                  {t('settings.destination')}
                  <select
                    className={input}
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                  >
                    <option value="">—</option>
                    {items
                      .filter((x) => x._id !== item._id)
                      .map((x) => (
                        <option key={x._id} value={x._id}>
                          {x.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  type="button"
                  className={btnDanger}
                  disabled={!destination}
                  onClick={() => remove(item._id)}
                >
                  {t('common.delete')}
                </button>
                <button type="button" className={btnGhost} onClick={() => setDeleting(null)}>
                  {t('common.cancel')}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add.mutate(name.trim(), { onSuccess: () => setName('') });
        }}
      >
        <input
          className={input}
          aria-label={t(kind === 'columns' ? 'settings.newColumn' : 'settings.newSwimlane')}
          placeholder={t(kind === 'columns' ? 'settings.newColumn' : 'settings.newSwimlane')}
          value={name}
          maxLength={255}
          onChange={(e) => setName(e.target.value)}
        />
        <button className={btn}>{t('common.add')}</button>
      </form>
      <ErrorText error={add.error ?? update.error ?? reorder.error ?? del.error} />
    </section>
  );
}

function ColorLegend() {
  const { t } = useTranslation();
  const { data } = useBoard();
  const { board } = data;
  const save = useBoardMutation((body: object) => api(`/boards/${board._id}`, { method: 'PATCH', body }));
  const [newColor, setNewColor] = useState('#2a9d8f');
  const custom = board.customColors ?? [];
  return (
    <section>
      <h3 className={h2}>{t('settings.colorLegend')}</h3>
      <ul className="grid gap-2 sm:grid-cols-2">
        {[...COLORS, ...custom].map((c) => (
          <li key={c} className="flex items-center gap-2">
            <span aria-hidden className="h-5 w-5 shrink-0 rounded-full" style={{ background: colorHex(c) }} />
            <input
              className={input}
              aria-label={custom.includes(c) ? c : t(`colors.${c}`)}
              placeholder={custom.includes(c) ? c : t(`colors.${c}`)}
              maxLength={50}
              defaultValue={board.colorLabels[c] ?? ''}
              onBlur={(e) =>
                e.target.value !== (board.colorLabels[c] ?? '') &&
                save.mutate({ colorLabels: { ...board.colorLabels, [c]: e.target.value } })
              }
            />
            {custom.includes(c) && (
              <button
                type="button"
                className={btnGhost}
                aria-label={`${t('common.delete')} — ${c}`}
                onClick={() => save.mutate({ customColors: custom.filter((x) => x !== c) })}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="color"
          aria-label={t('settings.customColor')}
          value={newColor}
          onChange={(e) => setNewColor(e.target.value)}
          className="h-8 w-10 rounded border border-line bg-surface"
        />
        <button
          type="button"
          className={btn}
          disabled={custom.includes(newColor) || custom.length >= 20}
          onClick={() => save.mutate({ customColors: [...custom, newColor] })}
        >
          {t('settings.addColor')}
        </button>
      </div>
      <ErrorText error={save.error} />
    </section>
  );
}

function Members() {
  const { t } = useTranslation();
  const { data } = useBoard();
  const users = useDirectory().data ?? [];
  const base = `/boards/${data.board._id}/members`;
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<BoardRole>('editor');
  const add = useBoardMutation(() => api(base, { body: { userId, role } }));
  const setMemberRole = useBoardMutation((v: { userId: string; role: BoardRole }) =>
    api(`${base}/${v.userId}`, { method: 'PATCH', body: { role: v.role } }),
  );
  const remove = useBoardMutation((id: string) => api(`${base}/${id}`, { method: 'DELETE' }));
  const customRoles = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/roles') }).data ?? [];
  const roleOptions = (
    <>
      {BOARD_ROLES.map((r) => (
        <option key={r} value={r}>
          {t(`settings.roles.${r}`)}
        </option>
      ))}
      {customRoles.map((r) => (
        <option key={r._id} value={r._id}>
          {r.name}
        </option>
      ))}
    </>
  );
  const candidates = users.filter(
    (u) => u.status === 'active' && !data.members.some((m) => m.userId === u._id),
  );

  return (
    <section>
      <h3 className={h2}>{t('settings.members')}</h3>
      <ul className="space-y-2">
        {data.members.map((m) => (
          <li key={m.userId} className="flex items-center gap-2">
            <Avatar name={m.fullName} />
            <span className="flex-1">
              {m.fullName} <span className="text-xs text-muted">@{m.username}</span>
              {m.status === 'disabled' && (
                <span className="text-xs text-muted"> {t('common.disabledSuffix')}</span>
              )}
            </span>
            <select
              className={`${input} w-36`}
              aria-label={`${t('admin.role')} — ${m.fullName}`}
              key={m.role}
              defaultValue={m.role}
              onChange={(e) => setMemberRole.mutate({ userId: m.userId, role: e.target.value as BoardRole })}
            >
              {roleOptions}
            </select>
            <button
              type="button"
              className={btnGhost}
              onClick={() => remove.mutate(m.userId)}
              aria-label={`${t('common.delete')} — ${m.fullName}`}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (userId) add.mutate(undefined, { onSuccess: () => setUserId('') });
        }}
      >
        <select
          className={`${input} flex-1`}
          aria-label={t('settings.addMember')}
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        >
          <option value="">{t('settings.addMember')}…</option>
          {candidates.map((u) => (
            <option key={u._id} value={u._id}>
              {u.fullName} (@{u.username})
            </option>
          ))}
        </select>
        <select
          className={`${input} w-36`}
          aria-label={t('admin.role')}
          value={role}
          onChange={(e) => setRole(e.target.value as BoardRole)}
        >
          {roleOptions}
        </select>
        <button className={btn} disabled={!userId}>
          {t('common.add')}
        </button>
      </form>
      <ErrorText error={add.error ?? setMemberRole.error ?? remove.error} />
    </section>
  );
}

/** Champs personnalisés du board (spec § 4.3) : création, renommage, options, affichage sur la carte. */
function CustomFields() {
  const { t } = useTranslation();
  const { data } = useBoard();
  const fields = data.board.customFields ?? [];
  const base = `/boards/${data.board._id}/fields`;
  const [draft, setDraft] = useState({ name: '', type: 'text' as CustomField['type'] });
  const add = useBoardMutation(() => api(base, { body: draft }));
  const update = useBoardMutation((f: CustomField) => api(`${base}/${f._id}`, { method: 'PATCH', body: f }));
  const del = useBoardMutation((id: string) => api(`${base}/${id}`, { method: 'DELETE' }));
  return (
    <section>
      <h3 className={h2}>{t('settings.customFields')}</h3>
      <ul className="space-y-3">
        {fields.map((f) => (
          <li key={f._id} className="space-y-1 rounded-md border border-line p-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                className={`${input} flex-1`}
                aria-label={`${t('common.name')} — ${f.name}`}
                defaultValue={f.name}
                key={f.name}
                maxLength={50}
                onBlur={(e) =>
                  e.target.value.trim() &&
                  e.target.value !== f.name &&
                  update.mutate({ ...f, name: e.target.value.trim() })
                }
              />
              <span className="text-xs text-muted">{t(`settings.fieldTypes.${f.type}`)}</span>
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  key={`c${f.showOnCard}`}
                  defaultChecked={f.showOnCard}
                  onChange={(e) => update.mutate({ ...f, showOnCard: e.target.checked })}
                />
                {t('settings.showOnCard')}
              </label>
              <button
                type="button"
                className={btnGhost}
                aria-label={`${t('common.delete')} — ${f.name}`}
                onClick={() => del.mutate(f._id)}
              >
                ✕
              </button>
            </div>
            {f.type === 'number' && (
              <div className="flex gap-2">
                <input
                  className={`${input} w-28`}
                  aria-label={`${t('settings.numberPrefix')} — ${f.name}`}
                  placeholder={t('settings.numberPrefix')}
                  maxLength={5}
                  defaultValue={f.numberPrefix}
                  onBlur={(e) =>
                    e.target.value !== f.numberPrefix && update.mutate({ ...f, numberPrefix: e.target.value })
                  }
                />
                <input
                  className={`${input} w-28`}
                  aria-label={`${t('settings.numberSuffix')} — ${f.name}`}
                  placeholder={t('settings.numberSuffix')}
                  maxLength={10}
                  defaultValue={f.numberSuffix}
                  onBlur={(e) =>
                    e.target.value !== f.numberSuffix && update.mutate({ ...f, numberSuffix: e.target.value })
                  }
                />
              </div>
            )}
            {f.type === 'dropdown' && (
              <div className="flex flex-wrap items-center gap-1">
                {f.options.map((o) => (
                  <span
                    key={o._id}
                    className="flex items-center gap-0.5 rounded bg-surface-2 py-0.5 pl-1.5 text-xs"
                  >
                    {o.label}
                    <button
                      type="button"
                      className="px-1"
                      aria-label={`${t('common.delete')} — ${o.label}`}
                      onClick={() =>
                        update.mutate({ ...f, options: f.options.filter((x) => x._id !== o._id) })
                      }
                    >
                      ✕
                    </button>
                  </span>
                ))}
                <input
                  className={`${input} w-40`}
                  aria-label={`${t('settings.newOption')} — ${f.name}`}
                  placeholder={t('settings.newOption')}
                  maxLength={50}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' || !e.currentTarget.value.trim()) return;
                    e.preventDefault();
                    // Nouvelle option : sans identifiant, le serveur l'attribue.
                    update.mutate({
                      ...f,
                      options: [
                        ...f.options,
                        { label: e.currentTarget.value.trim() } as CustomField['options'][number],
                      ],
                    });
                    e.currentTarget.value = '';
                  }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
      <form
        className="mt-2 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.name.trim()) add.mutate(undefined, { onSuccess: () => setDraft({ ...draft, name: '' }) });
        }}
      >
        <input
          className={`${input} flex-1`}
          aria-label={t('settings.newField')}
          placeholder={t('settings.newField')}
          maxLength={50}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <select
          className={`${input} w-40`}
          aria-label={t('settings.fieldType')}
          value={draft.type}
          onChange={(e) => setDraft({ ...draft, type: e.target.value as CustomField['type'] })}
        >
          {CUSTOM_FIELD_TYPES.map((x) => (
            <option key={x} value={x}>
              {t(`settings.fieldTypes.${x}`)}
            </option>
          ))}
        </select>
        <button className={btn}>{t('common.add')}</button>
      </form>
      <ErrorText error={add.error ?? update.error ?? del.error} />
    </section>
  );
}

/** Copie du board : structure seule ou avec les tâches (spec § 4.2). */
function CopyBoard({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { data } = useBoard();
  const navigate = useNavigate();
  const [name, setName] = useState(`${data.board.name} (${t('settings.copySuffix')})`);
  const [withTasks, setWithTasks] = useState(false);
  const copy = useMutation({
    mutationFn: () => api<Board>(`/boards/${data.board._id}/copy`, { body: { name, withTasks } }),
    onSuccess: (b) => {
      onDone();
      navigate(`/boards/${b._id}`);
    },
  });
  return (
    <section>
      <h3 className={h2}>{t('settings.copy')}</h3>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${input} flex-1`}
          aria-label={t('settings.copyName')}
          maxLength={255}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={withTasks} onChange={(e) => setWithTasks(e.target.checked)} />
          {t('settings.copyWithTasks')}
        </label>
        <button
          type="button"
          className={btn}
          disabled={!name.trim() || copy.isPending}
          onClick={() => copy.mutate()}
        >
          {t('settings.copy')}
        </button>
      </div>
      <ErrorText error={copy.error} />
    </section>
  );
}

function Danger() {
  const { t } = useTranslation();
  const { data } = useBoard();
  const navigate = useNavigate();
  const [confirmName, setConfirmName] = useState('');
  const del = useMutation({
    mutationFn: () => api(`/boards/${data.board._id}`, { method: 'DELETE', body: { confirmName } }),
    onSuccess: () => navigate('/'),
  });
  return (
    <section className="rounded-lg border border-danger p-4">
      <h3 className={`${h2} text-danger`}>{t('settings.danger')}</h3>
      <p className="mb-2 text-sm text-muted">{t('settings.deleteBoardHint')}</p>
      <div className="flex gap-2">
        <input
          className={input}
          aria-label={t('settings.deleteBoard')}
          placeholder={data.board.name}
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
        />
        <button
          type="button"
          className={btnDanger}
          disabled={confirmName !== data.board.name}
          onClick={() => del.mutate()}
        >
          {t('settings.deleteBoard')}
        </button>
      </div>
      <ErrorText error={del.error} />
    </section>
  );
}
