import { useEffect, useState, type KeyboardEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from 'react-i18next';
import { dueStatus, type DueStatus } from '@flowboard/shared';
import { api, type Task } from '../api';
import { Avatar, COLOR_HEX, cx, formatDuration, formatDue, i18n } from '../lib';
import { useBoard, useTaskMutation } from './context';

export function SortableCard({ task, disabled }: { task: Task; disabled: boolean }) {
  const { openTask } = useBoard();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task._id, disabled });
  // Entrée ouvre le détail ; Espace (sur la carte elle-même) démarre le déplacement clavier.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      openTask(task._id);
    } else listeners?.onKeyDown?.(e);
  };
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onKeyDown={onKeyDown}
      onClick={() => openTask(task._id)}
      className={cx('touch-manipulation rounded-lg outline-offset-2', isDragging && 'opacity-40')}
      data-task={task.name}
      aria-label={task.name}
    >
      <TaskCard task={task} />
    </div>
  );
}

/** Statut d'échéance : la cible est la colonne choisie, ou la colonne de complétion par défaut. */
export function useDueStatus(task: Task): DueStatus | null {
  const { data } = useBoard();
  if (!task.dueAt) return null;
  const target = task.dueTargetColumnId ?? data.board.completionColumnId;
  const reached = target === data.board.completionColumnId ? task.completedAt : task.dueReachedAt;
  return dueStatus(new Date(task.dueAt), task.dueHasTime, reached ? new Date(reached) : null, new Date());
}

/** « modifié par X à l'instant » pendant 10 s après une modification par quelqu'un d'autre. */
export function useRecentEditor(task: Task) {
  const { meId, member } = useBoard();
  const [recent, setRecent] = useState(false);
  useEffect(() => {
    const remaining = 10_000 - (Date.now() - new Date(task.updatedAt).getTime());
    const show = setTimeout(() => setRecent(task.updatedById !== meId && remaining > 0), 0);
    const hide = setTimeout(() => setRecent(false), Math.max(remaining, 0));
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [task.updatedAt, task.updatedById, meId]);
  return recent ? (member(task.updatedById)?.fullName ?? '?') : null;
}

const DUE_STYLE: Record<DueStatus, string> = {
  met: 'border-ok text-ok',
  missed: 'border-danger text-danger',
  overdue: 'border-danger bg-danger text-white dark:text-black',
  soon: 'border-warn bg-warn text-white dark:text-black',
  pending: 'border-line text-muted',
};

export function TaskCard({ task, overlay }: { task: Task; overlay?: boolean }) {
  const { t } = useTranslation();
  const { data, member, can, tz } = useBoard();
  const [showSubtasks, setShowSubtasks] = useState(false);
  const due = useDueStatus(task);
  const editor = useRecentEditor(task);
  const responsible = member(task.responsibleUserId);
  const colorName = data.board.colorLabels[task.color] || t(`colors.${task.color}`);
  const pinned = task.labels.filter((l) => l.pinned).map((l) => data.board.labels.find((b) => b._id === l.id)?.name).filter(Boolean);
  const done = task.subtasks.filter((s) => s.done).length;

  const toggle = useTaskMutation(
    task._id,
    (subtasks: Task['subtasks']) => api<Task>(`/boards/${task.boardId}/tasks/${task._id}`, { method: 'PATCH', body: { subtasks } }),
    (subtasks) => ({ ...task, subtasks }),
  );

  return (
    <article
      className={cx(
        'relative cursor-pointer overflow-hidden rounded-lg border border-line bg-surface py-2 pl-3 pr-2 text-sm shadow-sm hover:border-muted',
        overlay && 'shadow-xl ring-2 ring-accent',
      )}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ background: COLOR_HEX[task.color] }} />
      <span className="sr-only">{colorName}. </span>
      <h3 className="break-words font-medium leading-snug">{task.name}</h3>
      {pinned.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1">
          {pinned.map((name) => (
            <li key={name} className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">
              {name}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted empty:hidden">
        {task.dueAt && due && (
          <span className={cx('rounded border px-1.5 py-0.5 font-medium', DUE_STYLE[due])}>
            {t(`card.due.${due}`)} · {formatDue(task.dueAt, task.dueHasTime, i18n.language, tz)}
          </span>
        )}
        {task.subtasks.length > 0 && (
          <button
            type="button"
            className={cx('rounded border border-line px-1.5 py-0.5', done === task.subtasks.length && 'text-ok')}
            aria-expanded={showSubtasks}
            onClick={(e) => {
              e.stopPropagation();
              setShowSubtasks((s) => !s);
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            ☑ {done}/{task.subtasks.length}
            <span className="sr-only"> {t('card.subtasks', { done, total: task.subtasks.length })}</span>
          </button>
        )}
        {task.secondsEstimate ? <span title={t('card.estimate')}>⏱ {formatDuration(task.secondsEstimate)}</span> : null}
        {task.pointsEstimate !== null && <span title={t('task.points')}>{task.pointsEstimate} pt</span>}
        {task.commentsCount > 0 && <span aria-label={t('card.comments', { count: task.commentsCount })}>💬 {task.commentsCount}</span>}
        {task.attachmentsCount > 0 && (
          <span aria-label={t('card.attachments', { count: task.attachmentsCount })}>📎 {task.attachmentsCount}</span>
        )}
        {responsible && (
          <span className="ml-auto" aria-label={t('card.responsible', { name: responsible.fullName })}>
            <Avatar name={responsible.fullName} size={22} />
          </span>
        )}
      </div>
      {showSubtasks && (
        <ul className="mt-2 space-y-1 border-t border-line pt-2" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          {task.subtasks.map((s) => (
            <li key={s._id}>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  key={`${s._id}${s.done}`}
                  defaultChecked={s.done}
                  disabled={!can('task.edit')}
                  onChange={(e) => toggle.mutate(task.subtasks.map((x) => (x._id === s._id ? { ...x, done: e.target.checked } : x)))}
                />
                <span className={cx(s.done && 'text-muted line-through')}>{s.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {editor && <p className="mt-1 text-xs italic text-accent">{t('board.editedBy', { name: editor })}</p>}
    </article>
  );
}
