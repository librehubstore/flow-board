import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from 'react-i18next';
import { dueStatus, taskRef, type DueStatus } from '@flowboard/shared';
import { api, type Task } from '../api';
import { Avatar, colorHex, colorLabel, cx, formatDuration, formatDue, i18n } from '../lib';
import { useBoard, useTaskMutation } from './context';

/**
 * Carte déplaçable. Souris et tactile : toute la carte. Clavier et lecteurs d'écran : la poignée (le titre),
 * seul élément interactif « déplaçable » — la carte contient d'autres boutons et ne peut pas être elle-même un bouton.
 */
export function SortableCard({ task, disabled }: { task: Task; disabled: boolean }) {
  const { openTask, openMenu } = useBoard();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({
      id: task._id,
      disabled,
    });
  const { onKeyDown: dndKeyDown, ...pointerListeners } = listeners ?? {};
  // Entrée ouvre le détail ; Espace démarre le déplacement clavier.
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      openTask(task._id);
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      // Équivalent clavier du clic droit : menu sous la carte.
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      openMenu(task, r.left, r.bottom);
    } else dndKeyDown?.(e);
  };
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      onKeyDown={onKeyDown}
      data-handle
      className="w-full cursor-pointer break-words text-left font-medium leading-snug outline-offset-2"
    >
      {task.name}
    </button>
  );
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...pointerListeners}
      onClick={() => openTask(task._id)}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu(task, e.clientX, e.clientY);
      }}
      className={cx('touch-manipulation rounded-lg', isDragging && 'opacity-40')}
      data-task={task.name}
      data-task-id={task._id}
    >
      <TaskCard task={task} handle={handle} />
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
    // Cas courant (la plupart des cartes) : rien à afficher, aucun minuteur.
    if (task.updatedById === meId || remaining <= 0) {
      if (!recent) return;
      const reset = setTimeout(() => setRecent(false), 0);
      return () => clearTimeout(reset);
    }
    const show = setTimeout(() => setRecent(true), 0);
    const hide = setTimeout(() => setRecent(false), Math.max(remaining, 0));
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [task.updatedAt, task.updatedById, meId, recent]);
  return recent ? (member(task.updatedById)?.fullName ?? '?') : null;
}

const DUE_STYLE: Record<DueStatus, string> = {
  met: 'border-ok text-ok',
  missed: 'border-danger text-danger',
  overdue: 'border-danger bg-danger text-white dark:text-black',
  soon: 'border-warn bg-warn text-white dark:text-black',
  pending: 'border-line text-muted',
};

export function TaskCard({ task, overlay, handle }: { task: Task; overlay?: boolean; handle?: ReactNode }) {
  const { t } = useTranslation();
  const { data, member, tz } = useBoard();
  const [showSubtasks, setShowSubtasks] = useState(false);
  const due = useDueStatus(task);
  const editor = useRecentEditor(task);
  const responsible = member(task.responsibleUserId);
  const colorName = colorLabel(data.board.colorLabels, task.color);
  const pinned = task.labels
    .filter((l) => l.pinned)
    .map((l) => data.board.labels.find((b) => b._id === l.id)?.name)
    .filter(Boolean);
  const done = task.subtasks.filter((s) => s.done).length;
  // Champs personnalisés affichés sur la carte (option par champ, spec § 4.3).
  const fieldsOnCard = (data.board.customFields ?? [])
    .filter((f) => f.showOnCard && task.customFields?.[f._id] !== undefined)
    .map((f) => {
      const v = task.customFields![f._id];
      const text =
        f.type === 'dropdown'
          ? (f.options.find((o) => o._id === v)?.label ?? '')
          : f.type === 'number'
            ? `${f.numberPrefix}${Number(v).toLocaleString(i18n.language)}${f.numberSuffix ? ` ${f.numberSuffix}` : ''}`
            : String(v);
      return [f.name, text] as const;
    });

  return (
    <article
      className={cx(
        'relative cursor-pointer overflow-hidden rounded-lg border border-line bg-surface py-2 pl-3 pr-2 text-sm shadow-sm hover:border-muted',
        overlay && 'shadow-xl ring-2 ring-accent',
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1.5"
        style={{ background: colorHex(task.color) }}
      />
      <span className="sr-only">{colorName}. </span>
      {data.board.taskNumbering?.enabled && task.number && (
        <span className="block font-mono text-xs text-muted">
          {taskRef(data.board.taskNumbering.prefix, task.number)}
        </span>
      )}
      <h3 className="break-words font-medium leading-snug">{handle ?? task.name}</h3>
      {fieldsOnCard.length > 0 && (
        <dl className="mt-1 space-y-0.5 text-xs">
          {fieldsOnCard.map(([name, value]) => (
            <div key={name} className="flex gap-1">
              <dt className="text-muted">{name} :</dt>
              <dd className="min-w-0 truncate">{value}</dd>
            </div>
          ))}
        </dl>
      )}
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
            className={cx(
              'rounded border border-line px-1.5 py-0.5',
              done === task.subtasks.length && 'text-ok',
            )}
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
        {task.recurrence && <span title={t('recurrence.title')}>↻</span>}
        {!!(task.secondsEstimate || task.spentSeconds) && (
          <span title={`${t('card.spent')} / ${t('card.estimate')}`}>
            ⏱ {formatDuration(task.spentSeconds ?? 0)}
            {task.secondsEstimate ? ` / ${formatDuration(task.secondsEstimate)}` : ''}
          </span>
        )}
        {task.pointsEstimate !== null && <span title={t('task.points')}>{task.pointsEstimate} pt</span>}
        {task.commentsCount > 0 && (
          <span aria-label={t('card.comments', { count: task.commentsCount })}>💬 {task.commentsCount}</span>
        )}
        {task.attachmentsCount > 0 && (
          <span aria-label={t('card.attachments', { count: task.attachmentsCount })}>
            📎 {task.attachmentsCount}
          </span>
        )}
        {responsible && (
          <span className="ml-auto" aria-label={t('card.responsible', { name: responsible.fullName })}>
            <Avatar name={responsible.fullName} size={22} />
          </span>
        )}
      </div>
      {showSubtasks && <CardSubtasks task={task} />}
      {editor && <p className="mt-1 text-xs italic text-accent">{t('board.editedBy', { name: editor })}</p>}
    </article>
  );
}

/**
 * Sous-tâches cochables depuis la carte. Composant séparé : la mutation n'existe que pour la carte dépliée
 * (un observateur par carte coûterait cher sur un board de 1 000 tâches).
 */
function CardSubtasks({ task }: { task: Task }) {
  const { can } = useBoard();
  const toggle = useTaskMutation(
    task._id,
    (subtasks: Task['subtasks']) =>
      api<Task>(`/boards/${task.boardId}/tasks/${task._id}`, { method: 'PATCH', body: { subtasks } }),
    (subtasks) => ({ ...task, subtasks }),
  );
  return (
    <ul
      className="mt-2 space-y-1 border-t border-line pt-2"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {task.subtasks.map((s) => (
        <li key={s._id}>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              key={`${s._id}${s.done}`}
              defaultChecked={s.done}
              disabled={!can('task.edit')}
              onChange={(e) =>
                toggle.mutate(
                  task.subtasks.map((x) => (x._id === s._id ? { ...x, done: e.target.checked } : x)),
                )
              }
            />
            <span className={cx(s.done && 'text-muted line-through')}>{s.name}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}
