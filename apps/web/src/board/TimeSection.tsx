import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { DEFAULT_POMODORO } from '@flowboard/shared';
import { api, type Task } from '../api';
import {
  btn,
  btnGhost,
  btnPrimary,
  ErrorText,
  formatDate,
  formatDuration,
  fromZoned,
  i18n,
  input,
  toZoned,
  useMe,
} from '../lib';
import { useTimer } from '../TimerBar';
import { useBoard } from './context';

interface Entry {
  _id: string;
  userId: string;
  type: 'pomodoro' | 'stopwatch' | 'manual';
  startAt: string;
  endAt: string | null;
  running: boolean;
  parts: { taskId: string; startAt: string; endAt: string | null }[];
  comment: string;
  timeLabels: string[];
  success: boolean | null;
}

/** Temps passé sur la tâche (spec § 4.6) : lancement du minuteur, entrées, saisie manuelle. */
export function TimeSection({ task }: { task: Task }) {
  const { t } = useTranslation();
  const { data, can, member, meId, tz } = useBoard();
  const me = useMe().data!;
  const pomodoro = { ...DEFAULT_POMODORO, ...me.pomodoro };
  const qc = useQueryClient();
  const { timer, action } = useTimer();
  const key = ['time', task._id, task.spentSeconds ?? 0];
  const entries = useQuery({
    queryKey: key,
    queryFn: () => api<Entry[]>(`/boards/${data.board._id}/tasks/${task._id}/time-entries`),
  });
  const labels = useQuery({ queryKey: ['timeLabels'], queryFn: () => api<string[]>('/time-entries/labels') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['time', task._id] });
  const del = useMutation({
    mutationFn: (id: string) => api(`/time-entries/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  const today = toZoned(new Date().toISOString(), tz);
  const [form, setForm] = useState({
    date: today.date,
    start: '09:00',
    minutes: '30',
    comment: '',
    label: '',
  });
  const add = useMutation({
    mutationFn: () =>
      api('/time-entries', {
        body: {
          taskId: task._id,
          startAt: fromZoned(form.date, form.start, tz),
          durationSeconds: Number(form.minutes) * 60,
          comment: form.comment,
          timeLabels: form.label ? [form.label] : [],
        },
      }),
    onSuccess: () => {
      setForm({ ...form, comment: '' });
      void refresh();
      void qc.invalidateQueries({ queryKey: ['timeLabels'] });
    },
  });

  const onThisTask = timer?.phase === 'work' && timer.taskId === task._id;
  const canTrack = can('time.track') && !task.archivedAt;
  const seconds = (e: Entry) =>
    e.parts
      .filter((p) => p.taskId === task._id && p.endAt)
      .reduce((sum, p) => sum + (Date.parse(p.endAt!) - Date.parse(p.startAt)) / 1000, 0);

  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
        {t('time.title')} · {formatDuration(task.spentSeconds ?? 0)}
        {task.secondsEstimate ? ` / ${formatDuration(task.secondsEstimate)}` : ''}
      </h3>
      {canTrack && (
        <div className="mb-2 flex flex-wrap gap-2">
          {onThisTask ? (
            <span className="text-sm text-accent">{t('time.running')}</span>
          ) : timer?.kind === 'stopwatch' ? (
            <button
              type="button"
              className={btn}
              onClick={() => action.mutate({ path: 'switch', body: { taskId: task._id } })}
            >
              ⏱ {t('time.switchHere')}
            </button>
          ) : !timer || timer.phase !== 'work' ? (
            <>
              {pomodoro.enabled && (
                <button
                  type="button"
                  className={btn}
                  onClick={() => {
                    if (pomodoro.notify && 'Notification' in window && Notification.permission === 'default')
                      void Notification.requestPermission();
                    action.mutate({ path: 'start', body: { kind: 'pomodoro', taskId: task._id } });
                  }}
                >
                  🍅 {t('time.startPomodoro')}
                </button>
              )}
              <button
                type="button"
                className={btn}
                onClick={() =>
                  action.mutate({ path: 'start', body: { kind: 'stopwatch', taskId: task._id } })
                }
              >
                ⏱ {t('time.startStopwatch')}
              </button>
            </>
          ) : null}
        </div>
      )}
      <ErrorText error={action.error ?? del.error} />
      <ul className="mb-2 space-y-1 text-sm">
        {entries.data
          ?.filter((e) => !e.running)
          .map((e) => (
            <li key={e._id} className="flex flex-wrap items-center gap-2">
              <span className="w-16 font-mono tabular-nums">{formatDuration(seconds(e))}</span>
              <span className="text-xs text-muted">
                {e.type === 'pomodoro' ? (e.success ? '🍅' : '🍅✗') : e.type === 'stopwatch' ? '⏱' : '✎'}{' '}
                {formatDate(e.startAt, i18n.language, tz, true)} · {member(e.userId)?.fullName ?? '?'}
              </span>
              {e.comment && <span className="min-w-0 truncate">{e.comment}</span>}
              {e.timeLabels.map((l) => (
                <span key={l} className="rounded bg-surface-2 px-1.5 text-xs">
                  {l}
                </span>
              ))}
              {e.userId === meId && (
                <button
                  type="button"
                  className={`${btnGhost} ml-auto`}
                  aria-label={`${t('common.delete')} — ${formatDuration(seconds(e))}`}
                  onClick={() => del.mutate(e._id)}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
      </ul>
      {canTrack && (
        <details>
          <summary className="cursor-pointer text-sm text-muted">{t('time.addManual')}</summary>
          <form
            className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <input
              type="date"
              className={input}
              aria-label={t('time.date')}
              required
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
            <input
              type="time"
              className={input}
              aria-label={t('time.start')}
              required
              value={form.start}
              onChange={(e) => setForm({ ...form, start: e.target.value })}
            />
            <input
              type="number"
              min={1}
              max={1440}
              className={input}
              aria-label={t('time.minutes')}
              required
              value={form.minutes}
              onChange={(e) => setForm({ ...form, minutes: e.target.value })}
            />
            <input
              className={input}
              list="time-labels"
              aria-label={t('time.label')}
              placeholder={t('time.label')}
              maxLength={30}
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
            <datalist id="time-labels">
              {['Facturable', ...(labels.data ?? [])].map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
            <input
              className={`${input} col-span-2 sm:col-span-3`}
              aria-label={t('time.comment')}
              placeholder={t('time.comment')}
              maxLength={200}
              value={form.comment}
              onChange={(e) => setForm({ ...form, comment: e.target.value })}
            />
            <button className={btnPrimary} disabled={add.isPending}>
              {t('common.add')}
            </button>
          </form>
          <ErrorText error={add.error} />
        </details>
      )}
    </section>
  );
}
