import { useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  COLORS,
  RECURRENCE_FREQS,
  RecurrenceInput,
  taskRef,
  type UpdateTaskBody as UpdateTaskInput,
} from '@flowboard/shared';
import { api, attachmentUrl, type Attachment, type Comment, type Label, type Task } from '../api';
import {
  Avatar,
  btn,
  btnDanger,
  btnGhost,
  btnPrimary,
  colorHex,
  colorLabel,
  ConfirmDialog,
  cx,
  ErrorText,
  Field,
  formatDate,
  fromZoned,
  i18n,
  input,
  Modal,
  toZoned,
  useErrorText,
  useSettings,
} from '../lib';
import { useBoard, useTaskMutation } from './context';
import { useDueStatus, useRecentEditor } from './TaskCard';
import { TimeSection } from './TimeSection';
import { TaskHistory } from './History';

export function TaskDialog({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { data, can } = useBoard();
  const live = data.tasks.find((x) => x._id === taskId);
  // Tâche archivée : absente du board, chargée depuis les archives.
  const archived = useQuery({
    queryKey: ['archived', data.board._id],
    queryFn: () => api<Task[]>(`/boards/${data.board._id}/tasks?archived=true`),
    enabled: !live,
  });
  const task = live ?? archived.data?.find((x) => x._id === taskId);
  const patch = useTaskMutation(
    taskId,
    (body: UpdateTaskInput) =>
      api<Task>(`/boards/${data.board._id}/tasks/${taskId}`, { method: 'PATCH', body }),
    (body) => task && { ...task, ...(body as Partial<Task>) },
  );

  if (!task)
    return (
      <Modal open onClose={onClose} title={t('task.title')}>
        {archived.isPending ? t('common.loading') : <ErrorText error={archived.error} />}
      </Modal>
    );
  const editable = can('task.edit') && !task.archivedAt;
  const save = (body: UpdateTaskInput) => patch.mutate(body);

  return (
    <Modal open onClose={onClose} title={task.name} wide>
      <TaskHeader task={task} editable={editable} save={save} />
      <ErrorText error={patch.error} />
      <div className="mt-4 grid gap-6 md:grid-cols-[1fr_16rem]">
        <div className="min-w-0 space-y-6">
          <Description task={task} editable={editable} save={save} />
          <Subtasks task={task} editable={editable} save={save} />
          <TimeSection task={task} />
          <Attachments task={task} editable={editable} />
          <Comments task={task} />
          <TaskHistory taskId={task._id} />
        </div>
        <aside className="space-y-4">
          <Sidebar task={task} editable={editable} save={save} />
          <TaskActions task={task} onClose={onClose} />
        </aside>
      </div>
    </Modal>
  );
}

type Props = { task: Task; editable: boolean; save: (b: UpdateTaskInput) => void };

function TaskHeader({ task, editable, save }: Props) {
  const { t } = useTranslation();
  const { data } = useBoard();
  const editor = useRecentEditor(task);
  const column = data.board.columns.find((c) => c._id === task.columnId);
  return (
    <div className="space-y-1">
      <input
        className={cx(input, 'text-base font-semibold')}
        aria-label={t('task.name')}
        key={task.name}
        defaultValue={task.name}
        disabled={!editable}
        maxLength={255}
        onBlur={(e) => {
          const name = e.target.value.trim();
          if (name && name !== task.name) save({ name });
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <p className="text-xs text-muted">
        {task.number && data.board.taskNumbering?.enabled && (
          <span className="mr-2 font-mono">{taskRef(data.board.taskNumbering.prefix, task.number)}</span>
        )}
        {t('task.column')} : {column?.name}
        {task.archivedAt && (
          <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5">{t('task.archivedBadge')}</span>
        )}
        {editor && <span className="ml-2 italic text-accent">{t('board.editedBy', { name: editor })}</span>}
      </p>
    </div>
  );
}

function Description({ task, editable, save }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(task.description);
  return (
    <section>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{t('task.description')}</h3>
        {editable && !editing && (
          <button
            type="button"
            className={btnGhost}
            onClick={() => {
              setText(task.description);
              setEditing(true);
            }}
          >
            {t('common.edit')}
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <textarea
            autoFocus
            className={cx(input, 'min-h-32 font-mono')}
            aria-label={t('task.description')}
            placeholder={t('task.descriptionPlaceholder')}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className={btnPrimary}
              onClick={() => {
                save({ description: text });
                setEditing(false);
              }}
            >
              {t('common.save')}
            </button>
            <button
              type="button"
              className={btn}
              onClick={() => {
                setText(task.description);
                setEditing(false);
              }}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : task.description ? (
        <div className="markdown break-words">
          <Markdown components={{ a: (p) => <a {...p} target="_blank" rel="noreferrer noopener" /> }}>
            {task.description}
          </Markdown>
        </div>
      ) : (
        <p className="text-sm text-muted">{t('task.noDescription')}</p>
      )}
    </section>
  );
}

function Subtasks({ task, editable, save }: Props) {
  const { t } = useTranslation();
  const { data } = useBoard();
  const [name, setName] = useState('');
  const list = task.subtasks;
  const update = (subtasks: Task['subtasks']) => save({ subtasks });
  const change = (id: string, p: Partial<Task['subtasks'][number]>) =>
    update(list.map((s) => (s._id === id ? { ...s, ...p } : s)));
  const moveBy = (i: number, d: number) => {
    const next = [...list];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    update(next);
  };
  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
        {t('task.subtasks')} {list.length > 0 && `${list.filter((s) => s.done).length}/${list.length}`}
      </h3>
      <ul className="space-y-1">
        {list.map((s, i) => (
          <li key={s._id} className="group flex flex-wrap items-center gap-2 rounded px-1 hover:bg-surface-2">
            {/* Non contrôlée : le cache n'est notifié qu'au tick suivant, une case contrôlée reviendrait un instant en arrière. */}
            <input
              type="checkbox"
              key={`${s._id}${s.done}`}
              defaultChecked={s.done}
              disabled={!editable}
              aria-label={s.name}
              onChange={(e) => change(s._id, { done: e.target.checked })}
            />
            <span className={cx('min-w-0 flex-1 break-words', s.done && 'text-muted line-through')}>
              {s.name}
            </span>
            {editable ? (
              <>
                <select
                  className="rounded border border-line bg-surface px-1 py-0.5 text-xs"
                  aria-label={`${t('task.assignee')} — ${s.name}`}
                  value={s.assigneeId ?? ''}
                  onChange={(e) => change(s._id, { assigneeId: e.target.value || null })}
                >
                  <option value="">{t('task.assignee')}…</option>
                  {data.members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.fullName}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  className="rounded border border-line bg-surface px-1 py-0.5 text-xs"
                  aria-label={`${t('task.due')} — ${s.name}`}
                  value={s.dueAt?.slice(0, 10) ?? ''}
                  onChange={(e) =>
                    change(s._id, { dueAt: e.target.value ? `${e.target.value}T00:00:00.000Z` : null })
                  }
                />
                <button
                  type="button"
                  className={btnGhost}
                  disabled={i === 0}
                  onClick={() => moveBy(i, -1)}
                  aria-label={`${t('common.moveUp')} — ${s.name}`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={btnGhost}
                  disabled={i === list.length - 1}
                  onClick={() => moveBy(i, 1)}
                  aria-label={`${t('common.moveDown')} — ${s.name}`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={btnGhost}
                  onClick={() => update(list.filter((x) => x._id !== s._id))}
                  aria-label={`${t('common.delete')} — ${s.name}`}
                >
                  ✕
                </button>
              </>
            ) : (
              s.assigneeId && (
                <span className="text-xs text-muted">
                  {data.members.find((m) => m.userId === s.assigneeId)?.fullName}
                </span>
              )
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <form
          className="mt-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            update([
              ...list,
              { _id: crypto.randomUUID(), name: name.trim(), done: false, assigneeId: null, dueAt: null },
            ]);
            setName('');
          }}
        >
          <input
            className={input}
            aria-label={t('task.newSubtask')}
            placeholder={t('task.newSubtask')}
            value={name}
            maxLength={255}
            onChange={(e) => setName(e.target.value)}
          />
        </form>
      )}
    </section>
  );
}

function Sidebar({ task, editable, save }: Props) {
  const { t } = useTranslation();
  const { data, tz, member } = useBoard();
  const due = useDueStatus(task);
  const dueParts = task.dueAt
    ? task.dueHasTime
      ? toZoned(task.dueAt, tz)
      : { date: task.dueAt.slice(0, 10), time: '' }
    : null;
  const setDue = (date: string, time: string) =>
    save(
      date
        ? { dueAt: time ? fromZoned(date, time, tz) : `${date}T00:00:00.000Z`, dueHasTime: !!time }
        : { dueAt: null, dueHasTime: false },
    );
  const completed = task.completedAt ? toZoned(task.completedAt, tz) : null;
  const now = toZoned(new Date().toISOString(), tz);
  const hours = task.secondsEstimate ? Math.floor(task.secondsEstimate / 3600) : '';
  const minutes = task.secondsEstimate ? Math.round((task.secondsEstimate % 3600) / 60) : '';
  const setEstimate = (h: number, m: number) => save({ secondsEstimate: h || m ? h * 3600 + m * 60 : null });

  return (
    <>
      <Field label={t('task.color')}>
        <div role="radiogroup" aria-label={t('task.color')} className="flex flex-wrap gap-1.5">
          {[...COLORS, ...(data.board.customColors ?? [])].map((c) => {
            const label = colorLabel(data.board.colorLabels, c);
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={task.color === c}
                aria-label={label}
                title={label}
                disabled={!editable}
                onClick={() => save({ color: c })}
                className={cx(
                  'h-6 w-6 rounded-full border-2',
                  task.color === c ? 'border-fg' : 'border-transparent',
                )}
                style={{ background: colorHex(c) }}
              />
            );
          })}
        </div>
        <span className="text-xs text-muted">{colorLabel(data.board.colorLabels, task.color)}</span>
      </Field>

      <CustomFields task={task} editable={editable} save={save} />

      <Field label={t('task.responsible')}>
        <select
          className={input}
          disabled={!editable}
          value={task.responsibleUserId ?? ''}
          onChange={(e) => save({ responsibleUserId: e.target.value || null })}
        >
          <option value="">{t('common.none')}</option>
          {data.members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.fullName}
              {m.status === 'disabled' ? ` ${t('common.disabledSuffix')}` : ''}
            </option>
          ))}
        </select>
      </Field>

      <fieldset>
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
          {t('task.collaborators')}
        </legend>
        <ul className="space-y-0.5">
          {data.members.map((m) => (
            <li key={m.userId}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={!editable}
                  checked={task.collaboratorIds.includes(m.userId)}
                  onChange={(e) =>
                    save({
                      collaboratorIds: e.target.checked
                        ? [...task.collaboratorIds, m.userId]
                        : task.collaboratorIds.filter((id) => id !== m.userId),
                    })
                  }
                />
                <Avatar name={m.fullName} size={18} /> {m.fullName}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <Labels task={task} editable={editable} save={save} />

      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
          {t('task.due')}
        </legend>
        <div className="flex gap-1">
          <input
            type="date"
            className={input}
            aria-label={t('task.due')}
            disabled={!editable}
            value={dueParts?.date ?? ''}
            onChange={(e) => setDue(e.target.value, dueParts?.time ?? '')}
          />
          <input
            type="time"
            className={input}
            aria-label={t('task.dueTime')}
            disabled={!editable || !dueParts}
            value={dueParts?.time ?? ''}
            onChange={(e) => dueParts && setDue(dueParts.date, e.target.value)}
          />
        </div>
        {task.dueAt && (
          <>
            <select
              className={input}
              aria-label={t('task.dueTarget')}
              disabled={!editable}
              value={task.dueTargetColumnId ?? ''}
              onChange={(e) => save({ dueTargetColumnId: e.target.value || null })}
            >
              <option value="">
                {t('task.dueTarget')} :{' '}
                {data.board.columns.find((c) => c._id === data.board.completionColumnId)?.name}
              </option>
              {data.board.columns
                .filter((c) => c._id !== data.board.completionColumnId)
                .map((c) => (
                  <option key={c._id} value={c._id}>
                    {t('task.dueTarget')} : {c.name}
                  </option>
                ))}
            </select>
            {due && <p className="text-xs text-muted">{t(`card.due.${due}`)}</p>}
            {editable && (
              <button type="button" className={btnGhost} onClick={() => setDue('', '')}>
                {t('task.clearDue')}
              </button>
            )}
          </>
        )}
      </fieldset>

      <RecurrenceEditor task={task} editable={editable} save={save} />

      <fieldset>
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
          {t('task.estimates')}
        </legend>
        <div className="grid grid-cols-3 gap-1">
          <input
            type="number"
            min={0}
            className={input}
            aria-label={t('task.hours')}
            placeholder="h"
            disabled={!editable}
            defaultValue={hours}
            key={`h${task.secondsEstimate}`}
            onBlur={(e) => setEstimate(Number(e.target.value), Number(minutes))}
          />
          <input
            type="number"
            min={0}
            max={59}
            className={input}
            aria-label={t('task.minutes')}
            placeholder="min"
            disabled={!editable}
            defaultValue={minutes}
            key={`m${task.secondsEstimate}`}
            onBlur={(e) => setEstimate(Number(hours), Number(e.target.value))}
          />
          <input
            type="number"
            min={0}
            step="0.5"
            className={input}
            aria-label={t('task.points')}
            placeholder="pts"
            disabled={!editable}
            defaultValue={task.pointsEstimate ?? ''}
            key={`p${task.pointsEstimate}`}
            onBlur={(e) => save({ pointsEstimate: e.target.value === '' ? null : Number(e.target.value) })}
          />
        </div>
      </fieldset>

      {completed && (
        <Field label={t('task.completedAt')}>
          <input
            type="datetime-local"
            className={input}
            disabled={!editable}
            max={`${now.date}T${now.time}`}
            defaultValue={`${completed.date}T${completed.time}`}
            key={task.completedAt}
            onBlur={(e) => {
              const [date, time] = e.target.value.split('T');
              if (date && time) save({ completedAt: fromZoned(date, time, tz) });
            }}
          />
        </Field>
      )}
      <p className="text-xs text-muted">
        {member(task.createdById)?.fullName} · {formatDate(task.createdAt, i18n.language, tz, true)}
      </p>
    </>
  );
}

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
/** Nom d'un jour (0 = lundi) dans la langue courante. */
const weekdayName = (d: number, style: 'narrow' | 'long') =>
  new Intl.DateTimeFormat(i18n.language, { weekday: style, timeZone: 'UTC' }).format(
    new Date(Date.UTC(2026, 9, 5 + d)),
  );

/** Éditeur de récurrence (spec § 4.4) : formulaire, jamais de RRULE brute. */
function RecurrenceEditor({ task, editable, save }: Props) {
  const { t } = useTranslation();
  const { data } = useBoard();
  const r = task.recurrence;
  const rule = r && {
    freq: r.freq,
    interval: r.interval,
    weekdays: r.weekdays,
    monthlyBy: r.monthlyBy,
    mode: r.mode,
    startColumnId: r.startColumnId,
    endType: r.endType,
    endCount: r.endCount,
    endUntil: r.endUntil,
  };
  // Règle complète (valeurs par défaut du schéma) : l'affichage optimiste a toujours tous ses champs.
  const full = (patch: object) => {
    const v = RecurrenceInput.parse({ ...rule, ...patch });
    return { ...v, endUntil: v.endUntil?.toISOString() ?? null };
  };
  const set = (patch: Partial<NonNullable<typeof rule>>) => rule && save({ recurrence: full(patch) });
  const anchor = new Date(r?.anchor ?? task.dueAt ?? task.createdAt);
  const nth = Math.ceil(anchor.getUTCDate() / 7);
  const small = 'rounded border border-line bg-surface px-1.5 py-1 text-sm';

  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
        {t('recurrence.title')}
      </legend>
      <select
        className={input}
        aria-label={t('recurrence.title')}
        disabled={!editable}
        value={r?.freq ?? ''}
        onChange={(e) => {
          const freq = e.target.value as (typeof RECURRENCE_FREQS)[number] | '';
          save({ recurrence: freq ? full({ freq }) : null });
        }}
      >
        <option value="">{t('recurrence.none')}</option>
        {RECURRENCE_FREQS.map((f) => (
          <option key={f} value={f}>
            {t(`recurrence.freqs.${f}`)}
          </option>
        ))}
      </select>
      {r && (
        <>
          {r.freq !== 'weekdays' && (
            <label className="flex items-center gap-2 text-sm">
              {t('recurrence.every')}
              <input
                type="number"
                min={1}
                max={99}
                className={`${small} w-16`}
                disabled={!editable}
                defaultValue={r.interval}
                key={`i${r.interval}`}
                onBlur={(e) =>
                  Number(e.target.value) !== r.interval &&
                  set({ interval: Math.max(1, Number(e.target.value)) })
                }
              />
              {t(`recurrence.units.${r.freq}`, { count: r.interval })}
            </label>
          )}
          {r.freq === 'weekly' && (
            <div className="flex gap-1" role="group" aria-label={t('recurrence.days')}>
              {WEEKDAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  disabled={!editable}
                  aria-pressed={r.weekdays.includes(d)}
                  aria-label={weekdayName(d, 'long')}
                  className={cx(
                    'h-7 w-7 rounded-full border text-xs',
                    r.weekdays.includes(d) ? 'border-accent bg-accent text-accent-fg' : 'border-line',
                  )}
                  onClick={() =>
                    set({
                      weekdays: r.weekdays.includes(d)
                        ? r.weekdays.filter((x) => x !== d)
                        : [...r.weekdays, d].sort(),
                    })
                  }
                >
                  {weekdayName(d, 'narrow')}
                </button>
              ))}
            </div>
          )}
          {r.freq === 'monthly' && (
            <select
              className={input}
              aria-label={t('recurrence.monthlyBy')}
              disabled={!editable}
              value={r.monthlyBy}
              onChange={(e) => set({ monthlyBy: e.target.value as 'day' | 'nth' })}
            >
              <option value="day">{t('recurrence.monthDay', { day: anchor.getUTCDate() })}</option>
              <option value="nth">
                {t(nth === 5 ? 'recurrence.lastWeekday' : 'recurrence.nthWeekday', {
                  nth,
                  weekday: weekdayName((anchor.getUTCDay() + 6) % 7, 'long'),
                })}
              </option>
            </select>
          )}
          <select
            className={input}
            aria-label={t('recurrence.mode')}
            disabled={!editable}
            value={r.mode}
            onChange={(e) => set({ mode: e.target.value as 'onCompletion' | 'fixedDate' })}
          >
            <option value="onCompletion">{t('recurrence.onCompletion')}</option>
            <option value="fixedDate">{t('recurrence.fixedDate')}</option>
          </select>
          <select
            className={input}
            aria-label={t('recurrence.startColumn')}
            disabled={!editable}
            value={r.startColumnId ?? ''}
            onChange={(e) => set({ startColumnId: e.target.value || null })}
          >
            {data.board.columns.map((c, i) => (
              <option key={c._id} value={i === 0 ? '' : c._id}>
                {t('recurrence.startColumn')} : {c.name}
              </option>
            ))}
          </select>
          <div className="flex gap-1">
            <select
              className={input}
              aria-label={t('recurrence.end')}
              disabled={!editable}
              value={r.endType}
              onChange={(e) => {
                const endType = e.target.value as 'never' | 'count' | 'until';
                set({ endType, endCount: endType === 'count' ? (r.endCount ?? 5) : null, endUntil: null });
              }}
            >
              <option value="never">{t('recurrence.never')}</option>
              <option value="count">{t('recurrence.after')}</option>
              <option value="until">{t('recurrence.until')}</option>
            </select>
            {r.endType === 'count' && (
              <input
                type="number"
                min={1}
                className={`${small} w-20`}
                aria-label={t('recurrence.occurrences')}
                disabled={!editable}
                defaultValue={r.endCount ?? 5}
                key={`c${r.endCount}`}
                onBlur={(e) => set({ endCount: Math.max(1, Number(e.target.value)) })}
              />
            )}
            {r.endType === 'until' && (
              <input
                type="date"
                className={input}
                aria-label={t('recurrence.until')}
                disabled={!editable}
                value={r.endUntil?.slice(0, 10) ?? ''}
                onChange={(e) => set({ endUntil: e.target.value ? `${e.target.value}T23:59:59.000Z` : null })}
              />
            )}
          </div>
          {r.index && <p className="text-xs text-muted">{t('recurrence.occurrence', { index: r.index })}</p>}
        </>
      )}
    </fieldset>
  );
}

/** Champs personnalisés du board (spec § 4.3) : texte, nombre avec unité, liste déroulante. */
function CustomFields({ task, editable, save }: Props) {
  const { data } = useBoard();
  const fields = data.board.customFields ?? [];
  if (!fields.length) return null;
  const value = (id: string) => task.customFields?.[id] ?? '';
  const set = (id: string, v: string | number | null) => save({ customFields: { [id]: v } });
  return (
    <>
      {fields.map((f) => (
        <Field key={f._id} label={f.name}>
          {f.type === 'dropdown' ? (
            <select
              className={input}
              disabled={!editable}
              value={String(value(f._id))}
              onChange={(e) => set(f._id, e.target.value || null)}
            >
              <option value="">—</option>
              {f.options.map((o) => (
                <option key={o._id} value={o._id}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex items-center gap-1">
              {f.numberPrefix && <span className="text-sm text-muted">{f.numberPrefix}</span>}
              <input
                className={input}
                type={f.type === 'number' ? 'number' : 'text'}
                step="any"
                disabled={!editable}
                defaultValue={value(f._id)}
                key={`${f._id}${value(f._id)}`}
                maxLength={2000}
                onBlur={(e) => {
                  const raw = e.target.value.trim();
                  const v = raw === '' ? null : f.type === 'number' ? Number(raw) : raw;
                  if ((v ?? '') !== value(f._id)) set(f._id, v);
                }}
              />
              {f.numberSuffix && <span className="text-sm text-muted">{f.numberSuffix}</span>}
            </div>
          )}
        </Field>
      ))}
    </>
  );
}

function Labels({ task, editable, save }: Props) {
  const { t } = useTranslation();
  const { data } = useBoard();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const add = useMutation({
    mutationFn: async (name: string) => {
      const existing = data.board.labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
      return existing ?? (await api<Label>(`/boards/${data.board._id}/labels`, { body: { name } }));
    },
    onSuccess: (label) => {
      void qc.invalidateQueries({ queryKey: ['board', data.board._id] });
      if (!task.labels.some((l) => l.id === label._id))
        save({ labels: [...task.labels, { id: label._id, pinned: true }] });
    },
  });
  const listId = `labels-${task._id}`;
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
        {t('task.labels')}
      </legend>
      <ul className="mb-1 flex flex-wrap gap-1">
        {task.labels.map((l) => {
          const name = data.board.labels.find((b) => b._id === l.id)?.name ?? '?';
          return (
            <li key={l.id} className="flex items-center gap-0.5 rounded bg-surface-2 py-0.5 pl-1.5 text-xs">
              <span className={cx(!l.pinned && 'text-muted')}>{name}</span>
              {editable && (
                <>
                  <button
                    type="button"
                    className="px-1"
                    title={l.pinned ? t('task.unpin') : t('task.pin')}
                    aria-label={`${l.pinned ? t('task.unpin') : t('task.pin')} — ${name}`}
                    aria-pressed={l.pinned}
                    onClick={() =>
                      save({
                        labels: task.labels.map((x) => (x.id === l.id ? { ...x, pinned: !x.pinned } : x)),
                      })
                    }
                  >
                    {l.pinned ? '📌' : '📍'}
                  </button>
                  <button
                    type="button"
                    className="px-1"
                    aria-label={t('task.removeLabel', { name })}
                    onClick={() => save({ labels: task.labels.filter((x) => x.id !== l.id) })}
                  >
                    ✕
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {editable && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) add.mutate(text.trim());
            setText('');
          }}
        >
          <input
            className={input}
            list={listId}
            aria-label={t('task.labelPlaceholder')}
            placeholder={t('task.labelPlaceholder')}
            maxLength={50}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <datalist id={listId}>
            {data.board.labels.map((l) => (
              <option key={l._id} value={l.name} />
            ))}
          </datalist>
        </form>
      )}
    </fieldset>
  );
}

function TaskActions({ task, onClose }: { task: Task; onClose: () => void }) {
  const { t } = useTranslation();
  const { data, can, upsert, remove } = useBoard();
  const qc = useQueryClient();
  const base = `/boards/${data.board._id}/tasks`;
  const refreshArchived = () => qc.invalidateQueries({ queryKey: ['archived', data.board._id] });
  const archive = useMutation({
    mutationFn: () => api(`${base}/archive`, { body: { taskIds: [task._id] } }),
    onSuccess: () => {
      remove([task._id]);
      void refreshArchived();
      onClose();
    },
  });
  const restore = useMutation({
    mutationFn: () => api<Task>(`${base}/${task._id}/restore`, { method: 'POST' }),
    onSuccess: (x) => {
      upsert(x);
      void refreshArchived();
    },
  });
  const [confirming, setConfirming] = useState(false);
  const del = useMutation({
    mutationFn: () => api(`${base}/${task._id}`, { method: 'DELETE' }),
    onSuccess: () => {
      remove([task._id]);
      void refreshArchived();
      onClose();
    },
  });
  return (
    <div className="flex flex-wrap gap-2 border-t border-line pt-3">
      {can('task.edit') &&
        (task.archivedAt ? (
          <button type="button" className={btn} onClick={() => restore.mutate()}>
            {t('task.restore')}
          </button>
        ) : (
          <button type="button" className={btn} onClick={() => archive.mutate()}>
            {t('task.archive')}
          </button>
        ))}
      {can('task.delete') && (
        <button type="button" className={btnDanger} onClick={() => setConfirming(true)}>
          {t('common.delete')}
        </button>
      )}
      <ConfirmDialog
        open={confirming}
        title={t('menu.deleteTitle')}
        message={t('menu.deleteText', { name: task.name })}
        confirmLabel={t('common.delete')}
        pending={del.isPending}
        onConfirm={() => del.mutate()}
        onClose={() => setConfirming(false)}
      />
      <ErrorText error={archive.error ?? restore.error ?? del.error} />
    </div>
  );
}

function Attachments({ task, editable }: { task: Task; editable: boolean }) {
  const { t } = useTranslation();
  const { data } = useBoard();
  const errorText = useErrorText();
  const settings = useSettings().data;
  const qc = useQueryClient();
  const key = ['attachments', task._id];
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const list = useQuery({
    queryKey: [...key, task.attachmentsCount],
    queryFn: () => api<Attachment[]>(`/boards/${data.board._id}/tasks/${task._id}/attachments`),
  });
  const upload = useMutation({
    mutationFn: (files: FileList) => {
      const form = new FormData();
      for (const f of Array.from(files)) form.append('files', f);
      return api<Attachment[]>(`/boards/${data.board._id}/tasks/${task._id}/attachments`, { body: form });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/boards/${data.board._id}/attachments/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
        {t('task.attachments')}
      </h3>
      <ul className="mb-2 grid gap-2 sm:grid-cols-2">
        {list.data?.map((a) => (
          <li key={a._id} className="flex items-center gap-2 rounded border border-line p-1.5">
            {a.mimeType.startsWith('image/') && a.mimeType !== 'image/svg+xml' ? (
              <img
                src={attachmentUrl(data.board._id, a._id)}
                alt=""
                className="h-10 w-10 rounded object-cover"
                loading="lazy"
              />
            ) : (
              <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded bg-surface-2">
                📄
              </span>
            )}
            <a
              href={attachmentUrl(data.board._id, a._id)}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 truncate text-sm underline"
            >
              {a.fileName}
            </a>
            <span className="text-xs text-muted">{Math.max(1, Math.round(a.size / 1024))} Ko</span>
            {editable && (
              <button
                type="button"
                className={btnGhost}
                aria-label={`${t('common.delete')} — ${a.fileName}`}
                onClick={() => confirm(t('task.deleteAttachment')) && del.mutate(a._id)}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files.length) upload.mutate(e.dataTransfer.files);
            }}
            className={cx(
              'w-full rounded-lg border-2 border-dashed p-3 text-sm text-muted',
              dragOver ? 'border-accent bg-accent/10' : 'border-line',
            )}
          >
            {upload.isPending ? t('task.uploading') : t('task.dropFiles')}
            {settings && (
              <span className="block text-xs">{t('task.maxSize', { mb: settings.maxAttachmentMb })}</span>
            )}
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) upload.mutate(e.target.files);
              e.target.value = '';
            }}
          />
          {(upload.error || del.error) && (
            <p className="text-sm text-danger">{errorText(upload.error ?? del.error)}</p>
          )}
        </>
      )}
    </section>
  );
}

function Comments({ task }: { task: Task }) {
  const { t } = useTranslation();
  const { data, can, meId, member, tz } = useBoard();
  const qc = useQueryClient();
  const key = ['comments', task._id];
  const base = `/boards/${data.board._id}/tasks/${task._id}/comments`;
  const list = useQuery({ queryKey: key, queryFn: () => api<Comment[]>(base) });
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const create = useMutation({
    mutationFn: () => api(base, { body: { text } }),
    onSuccess: () => {
      setText('');
      void refresh();
    },
  });
  const update = useMutation({
    mutationFn: (c: { id: string; text: string }) =>
      api(`${base}/${c.id}`, { method: 'PATCH', body: { text: c.text } }),
    onSuccess: () => {
      setEditing(null);
      void refresh();
    },
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`${base}/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  // Autocomplétion des mentions : le mot en cours commence par @.
  const partial = /(?:^|\s)@([a-z0-9._-]*)$/i.exec(text)?.[1]?.toLowerCase();
  const suggestions =
    partial !== undefined
      ? data.members.filter((m) => m.username.startsWith(partial) && m.status === 'active').slice(0, 5)
      : [];

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t('task.comments')}</h3>
      <ul className="space-y-3">
        {list.data?.map((c) => {
          const author = member(c.authorId);
          return (
            <li key={c._id} className="flex gap-2">
              <Avatar name={author?.fullName ?? '?'} size={28} />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted">
                  <strong className="text-fg">{author?.fullName ?? '?'}</strong> ·{' '}
                  {formatDate(c.createdAt, i18n.language, tz, true)}
                  {c.updatedAt && ` · ${t('task.edited')}`}
                </p>
                {editing?.id === c._id ? (
                  <form
                    className="mt-1 space-y-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      update.mutate(editing);
                    }}
                  >
                    <textarea
                      className={input}
                      aria-label={t('common.edit')}
                      value={editing.text}
                      onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                    />
                    <div className="flex gap-1">
                      <button className={btnPrimary}>{t('common.save')}</button>
                      <button type="button" className={btn} onClick={() => setEditing(null)}>
                        {t('common.cancel')}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="markdown break-words">
                    <Markdown
                      components={{ a: (p) => <a {...p} target="_blank" rel="noreferrer noopener" /> }}
                    >
                      {c.text}
                    </Markdown>
                  </div>
                )}
                {c.authorId === meId && editing?.id !== c._id && (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className={btnGhost}
                      onClick={() => setEditing({ id: c._id, text: c.text })}
                    >
                      {t('common.edit')}
                    </button>
                    <button
                      type="button"
                      className={btnGhost}
                      onClick={() => confirm(t('task.deleteComment')) && del.mutate(c._id)}
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {can('comment') && (
        <form
          className="relative mt-3 space-y-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) create.mutate();
          }}
        >
          <textarea
            className={cx(input, 'min-h-20')}
            aria-label={t('task.commentPlaceholder')}
            placeholder={t('task.commentPlaceholder')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) =>
              e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.currentTarget.form?.requestSubmit()
            }
          />
          {suggestions.length > 0 && (
            <ul className="flex flex-wrap gap-1" aria-label="@">
              {suggestions.map((m) => (
                <li key={m.userId}>
                  <button
                    type="button"
                    className={cx(btn, 'py-0.5 text-xs')}
                    onClick={() => setText(text.replace(/@([a-z0-9._-]*)$/i, `@${m.username} `))}
                  >
                    @{m.username} · {m.fullName}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <ErrorText error={create.error ?? update.error ?? del.error} />
          <button className={btnPrimary} disabled={!text.trim() || create.isPending}>
            {t('task.send')}
          </button>
        </form>
      )}
    </section>
  );
}
