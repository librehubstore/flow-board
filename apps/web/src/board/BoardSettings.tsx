import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BOARD_ROLES, COLORS, type BoardRole } from '@flowboard/shared';
import { api, type Column, type Swimlane } from '../api';
import { Avatar, btn, btnDanger, btnGhost, btnPrimary, COLOR_HEX, ErrorText, Field, input, Modal, useDirectory } from '../lib';
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
          </>
        )}
        {can('board.members') && <Members />}
        {can('board.structure') && <Danger />}
      </div>
    </Modal>
  );
}

/** Mutation sur le board puis rechargement (le serveur diffuse aussi `board.changed` aux autres). */
function useBoardMutation<V>(fn: (v: V) => Promise<unknown>) {
  const { data } = useBoard();
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['board', data.board._id] }) });
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
          <input className={input} required maxLength={255} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('common.description')}>
          <textarea className={input} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label={t('settings.completionColumn')}>
          <select className={input} value={board.completionColumnId} onChange={(e) => save.mutate({ completionColumnId: e.target.value })}>
            {board.columns.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
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
  const update = useBoardMutation(({ id, ...body }: { id: string; name?: string; wipLimit?: number | null; description?: string }) =>
    api(`${base}/${id}`, { method: 'PATCH', body }),
  );
  const reorder = useBoardMutation((ids: string[]) => api(`${base}/order`, { method: 'PUT', body: { ids } }));
  const del = useBoardMutation((v: { id: string; destinationId?: string }) =>
    api(`${base}/${v.id}`, { method: 'DELETE', body: { destinationId: v.destinationId } }),
  );
  const count = (id: string) => data.tasks.filter((x) => (kind === 'columns' ? x.columnId : x.swimlaneId) === id).length;
  const moveBy = (i: number, d: number) => {
    const ids = items.map((x) => x._id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    reorder.mutate(ids);
  };
  const remove = (id: string) => {
    const needsDestination = count(id) > 0 && !(kind === 'swimlanes' && items.length === 1);
    if (needsDestination && !destination) return setDeleting(id);
    del.mutate({ id, destinationId: needsDestination ? destination : undefined }, { onSuccess: () => setDeleting(null) });
  };

  return (
    <section>
      <h3 className={h2}>{t(`settings.${kind}`)}</h3>
      {kind === 'swimlanes' && !items.length && <p className="mb-2 text-sm text-muted">{t('settings.noSwimlanes')}</p>}
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={item._id} className="flex flex-wrap items-center gap-2">
            <input
              className={`${input} min-w-40 flex-1`}
              aria-label={`${t('common.name')} — ${item.name}`}
              defaultValue={item.name}
              key={item.name}
              maxLength={255}
              onBlur={(e) => e.target.value.trim() && e.target.value !== item.name && update.mutate({ id: item._id, name: e.target.value.trim() })}
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
            <button type="button" className={btnGhost} disabled={i === 0} onClick={() => moveBy(i, -1)} aria-label={`${t('common.moveUp')} — ${item.name}`}>
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
            <button type="button" className={btnGhost} onClick={() => remove(item._id)} aria-label={`${t('common.delete')} — ${item.name}`}>
              ✕
            </button>
            {deleting === item._id && (
              <span className="flex w-full items-center gap-2 text-sm">
                <label className="flex items-center gap-2">
                  {t('settings.destination')}
                  <select className={input} value={destination} onChange={(e) => setDestination(e.target.value)}>
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
                <button type="button" className={btnDanger} disabled={!destination} onClick={() => remove(item._id)}>
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
  const save = useBoardMutation((colorLabels: object) => api(`/boards/${board._id}`, { method: 'PATCH', body: { colorLabels } }));
  return (
    <section>
      <h3 className={h2}>{t('settings.colorLegend')}</h3>
      <ul className="grid gap-2 sm:grid-cols-2">
        {COLORS.map((c) => (
          <li key={c} className="flex items-center gap-2">
            <span aria-hidden className="h-5 w-5 shrink-0 rounded-full" style={{ background: COLOR_HEX[c] }} />
            <input
              className={input}
              aria-label={t(`colors.${c}`)}
              placeholder={t(`colors.${c}`)}
              maxLength={50}
              defaultValue={board.colorLabels[c] ?? ''}
              onBlur={(e) => e.target.value !== (board.colorLabels[c] ?? '') && save.mutate({ ...board.colorLabels, [c]: e.target.value })}
            />
          </li>
        ))}
      </ul>
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
  const setMemberRole = useBoardMutation((v: { userId: string; role: BoardRole }) => api(`${base}/${v.userId}`, { method: 'PATCH', body: { role: v.role } }));
  const remove = useBoardMutation((id: string) => api(`${base}/${id}`, { method: 'DELETE' }));
  const candidates = users.filter((u) => u.status === 'active' && !data.members.some((m) => m.userId === u._id));

  return (
    <section>
      <h3 className={h2}>{t('settings.members')}</h3>
      <ul className="space-y-2">
        {data.members.map((m) => (
          <li key={m.userId} className="flex items-center gap-2">
            <Avatar name={m.fullName} />
            <span className="flex-1">
              {m.fullName} <span className="text-xs text-muted">@{m.username}</span>
              {m.status === 'disabled' && <span className="text-xs text-muted"> {t('common.disabledSuffix')}</span>}
            </span>
            <select
              className={`${input} w-36`}
              aria-label={`${t('admin.role')} — ${m.fullName}`}
              value={m.role}
              onChange={(e) => setMemberRole.mutate({ userId: m.userId, role: e.target.value as BoardRole })}
            >
              {BOARD_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`settings.roles.${r}`)}
                </option>
              ))}
            </select>
            <button type="button" className={btnGhost} onClick={() => remove.mutate(m.userId)} aria-label={`${t('common.delete')} — ${m.fullName}`}>
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
        <select className={`${input} flex-1`} aria-label={t('settings.addMember')} value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">{t('settings.addMember')}…</option>
          {candidates.map((u) => (
            <option key={u._id} value={u._id}>
              {u.fullName} (@{u.username})
            </option>
          ))}
        </select>
        <select className={`${input} w-36`} aria-label={t('admin.role')} value={role} onChange={(e) => setRole(e.target.value as BoardRole)}>
          {BOARD_ROLES.map((r) => (
            <option key={r} value={r}>
              {t(`settings.roles.${r}`)}
            </option>
          ))}
        </select>
        <button className={btn} disabled={!userId}>
          {t('common.add')}
        </button>
      </form>
      <ErrorText error={add.error ?? setMemberRole.error ?? remove.error} />
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
        <input className={input} aria-label={t('settings.deleteBoard')} placeholder={data.board.name} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
        <button type="button" className={btnDanger} disabled={confirmName !== data.board.name} onClick={() => del.mutate()}>
          {t('settings.deleteBoard')}
        </button>
      </div>
      <ErrorText error={del.error} />
    </section>
  );
}
