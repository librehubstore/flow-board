import { useMemo, useState } from 'react';
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { completionGroup, estimatedPomodoros } from '@flowboard/shared';
import { api, type Column, type Swimlane, type Task, type User } from '../api';
import { btnGhost, cx, formatDate, i18n, input, useErrorText, useMe, useNow } from '../lib';
import { useBoard, useTaskMutation } from './context';
import { SortableCard, TaskCard } from './TaskCard';

type Cells = Record<string, string[]>;
const cellKey = (columnId: string, laneId: string | null) => `${columnId}|${laneId ?? ''}`;
const parseKey = (key: string) => {
  const [columnId, lane] = key.split('|');
  return { columnId, swimlaneId: lane || null };
};
const findCell = (cells: Cells, id: string) =>
  id in cells ? id : Object.keys(cells).find((k) => cells[k].includes(id));

export function BoardGrid() {
  const { t } = useTranslation();
  const { data, can, matches } = useBoard();
  const { board, tasks } = data;
  const qc = useQueryClient();
  const errorText = useErrorText();
  const me = useMe().data!;
  const [error, setError] = useState<string | null>(null);
  const lanes = useMemo<(Swimlane | null)[]>(
    () => (board.swimlanes.length ? board.swimlanes : [null]),
    [board.swimlanes],
  );
  const byId = useMemo(() => new Map(tasks.map((x) => [x._id, x])), [tasks]);
  // Occurrences récurrentes à venir : hors des cellules et des compteurs WIP jusqu'à leur date de début.
  const now = useNow();
  const visible = useMemo(
    () => tasks.filter((x) => !x.startAt || Date.parse(x.startAt) <= now),
    [tasks, now],
  );

  // Cellules colonne × swimlane ; la colonne de complétion est triée par date de complétion décroissante.
  // `fullCells` : toutes les tâches (sert aux compteurs WIP et aux index envoyés au serveur) ; `baseCells` : filtrées.
  const fullCells = useMemo(() => {
    const cells: Cells = {};
    for (const c of board.columns) for (const l of lanes) cells[cellKey(c._id, l?._id ?? null)] = [];
    const sorted = [...visible].sort((a, b) =>
      a.columnId === board.completionColumnId && b.columnId === board.completionColumnId
        ? (b.completedAt ?? '').localeCompare(a.completedAt ?? '')
        : a.position - b.position,
    );
    for (const x of sorted) cells[cellKey(x.columnId, x.swimlaneId)]?.push(x._id);
    return cells;
  }, [visible, board.columns, board.completionColumnId, lanes]);
  const baseCells = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(fullCells).map(([k, ids]) => [k, ids.filter((x) => matches(byId.get(x)!))]),
      ),
    [fullCells, matches, byId],
  );

  // `droppedOn` : instantané des tâches au lâcher. Le cache n'est notifié qu'au tick suivant ; on garde la disposition
  // glissée jusqu'à ce qu'il change, sinon la carte revient une image à son point de départ.
  const [drag, setDrag] = useState<{ id: string; cells: Cells; droppedOn?: Task[] } | null>(null);
  if (drag?.droppedOn && drag.droppedOn !== tasks) setDrag(null);
  const cells = drag?.cells ?? baseCells;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  );

  const move = useTaskMutation(
    (v: { id: string; optimistic: Task; index: number }) => v.id,
    (v) =>
      api<Task>(`/boards/${board._id}/tasks/${v.id}/move`, {
        body: { columnId: v.optimistic.columnId, swimlaneId: v.optimistic.swimlaneId, index: v.index },
      }),
    (v) => v.optimistic,
  );

  const onDragStart = ({ active }: DragStartEvent) => {
    setError(null);
    setDrag({ id: String(active.id), cells: baseCells });
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    setDrag((d) => {
      if (!d) return d;
      const from = findCell(d.cells, String(active.id));
      const to = findCell(d.cells, String(over.id));
      if (!from || !to || from === to) return d;
      const target = d.cells[to];
      const overIndex = target.indexOf(String(over.id));
      const index = overIndex >= 0 ? overIndex : target.length;
      return {
        ...d,
        cells: {
          ...d.cells,
          [from]: d.cells[from].filter((x) => x !== active.id),
          [to]: [...target.slice(0, index), String(active.id), ...target.slice(index)],
        },
      };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const d = drag;
    const id = String(active.id);
    if (!d || !over) return setDrag(null);
    let final = d.cells;
    const to = findCell(final, String(over.id));
    if (!to) return setDrag(null);
    const oldIndex = final[to].indexOf(id);
    const overIndex = final[to].indexOf(String(over.id));
    if (overIndex >= 0 && oldIndex !== overIndex)
      final = { ...final, [to]: arrayMove(final[to], oldIndex, overIndex) };
    const index = final[to].indexOf(id);
    const task = byId.get(id)!;
    const { columnId, swimlaneId } = parseKey(to);
    const unchanged = cellKey(task.columnId, task.swimlaneId) === to && baseCells[to].indexOf(id) === index;
    // Index dans la cellule complète (tâches masquées par le filtre comprises), juste après le voisin visible précédent.
    const full = fullCells[to].filter((x) => x !== id);
    const prev = final[to][index - 1];
    const serverIndex = prev ? full.indexOf(prev) + 1 : 0;
    if (unchanged) return setDrag(null);
    // Mise à jour optimiste : position entre les voisins, complétion selon la colonne d'arrivée.
    const before = byId.get(final[to][index - 1])?.position;
    const after = byId.get(final[to][index + 1])?.position;
    const position =
      before === undefined ? (after ?? 0) - 1024 : after === undefined ? before + 1024 : (before + after) / 2;
    const completedAt =
      columnId === task.columnId
        ? task.completedAt
        : columnId === board.completionColumnId
          ? new Date().toISOString()
          : null;
    move.mutate(
      { id, index: serverIndex, optimistic: { ...task, columnId, swimlaneId, position, completedAt } },
      { onError: (e) => setError(errorText(e)) },
    );
    setDrag({ ...d, cells: final, droppedOn: tasks });
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => t('board.dnd.start', { name: byId.get(String(active.id))?.name }),
    onDragOver: ({ active, over }) =>
      over
        ? t('board.dnd.over', {
            name: byId.get(String(active.id))?.name,
            target: describeTarget(String(over.id)),
          })
        : undefined,
    onDragEnd: ({ active }) => t('board.dnd.end', { name: byId.get(String(active.id))?.name }),
    onDragCancel: ({ active }) => t('board.dnd.cancel', { name: byId.get(String(active.id))?.name }),
  };
  function describeTarget(overId: string) {
    const key = findCell(cells, overId);
    if (!key) return '';
    const { columnId, swimlaneId } = parseKey(key);
    const col = board.columns.find((c) => c._id === columnId)?.name ?? '';
    const lane = board.swimlanes.find((s) => s._id === swimlaneId)?.name;
    return lane ? `${col} / ${lane}` : col;
  }

  const collapse = useMutation({
    mutationFn: (v: { columnId: string; collapsed: boolean }) =>
      api('/me/collapsed-columns', { method: 'PUT', body: v }),
    onMutate: (v) =>
      qc.setQueryData<User>(
        ['me'],
        (u) =>
          u && {
            ...u,
            collapsedColumns: v.collapsed
              ? [...u.collapsedColumns, v.columnId]
              : u.collapsedColumns.filter((c) => c !== v.columnId),
          },
      ),
  });
  const collapsed = new Set(me.collapsedColumns);
  const template = board.columns
    .map((c) => (collapsed.has(c._id) ? '2.75rem' : 'minmax(17rem, 1fr)'))
    .join(' ');
  const activeTask = drag ? byId.get(drag.id) : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error && (
        <p role="alert" className="no-print mx-4 mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDrag(null)}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: t('board.dnd.instructions') },
        }}
      >
        <div className="print-board min-h-0 flex-1 overflow-auto p-3">
          <div className="grid gap-x-3" style={{ gridTemplateColumns: template }}>
            {board.columns.map((c) => (
              <ColumnHeader
                key={c._id}
                column={c}
                tasks={visible.filter((x) => x.columnId === c._id)}
                collapsed={collapsed.has(c._id)}
                onToggle={() => collapse.mutate({ columnId: c._id, collapsed: !collapsed.has(c._id) })}
              />
            ))}
            {lanes.map((lane) => (
              <Lane key={lane?._id ?? 'none'} lane={lane} span={board.columns.length}>
                {board.columns.map((c) =>
                  collapsed.has(c._id) ? (
                    <div key={c._id} />
                  ) : (
                    <Cell
                      key={c._id}
                      id={cellKey(c._id, lane?._id ?? null)}
                      ids={cells[cellKey(c._id, lane?._id ?? null)] ?? []}
                      column={c}
                      laneId={lane?._id ?? null}
                      canDrag={can('task.move')}
                    />
                  ),
                )}
              </Lane>
            ))}
          </div>
        </div>
        <DragOverlay>{activeTask && <TaskCard task={activeTask} overlay />}</DragOverlay>
      </DndContext>
    </div>
  );
}

function Lane({ lane, span, children }: { lane: Swimlane | null; span: number; children: React.ReactNode }) {
  return (
    <>
      {lane && (
        <h2
          className="sticky left-0 mt-3 border-t border-line pt-2 text-sm font-semibold text-muted"
          style={{ gridColumn: `1 / span ${span}` }}
        >
          {lane.name}
        </h2>
      )}
      {children}
    </>
  );
}

function ColumnHeader({
  column,
  tasks,
  collapsed,
  onToggle,
}: {
  column: Column;
  tasks: Task[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const { data, can, upsert, wall } = useBoard();
  const me = useMe().data!;
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const count = tasks.length;
  // Limite WIP en tâches, ou en pomodoros estimés (spec § 4.2).
  const pomodoros = column.wipUnit === 'pomodoros';
  const load = pomodoros ? tasks.reduce((sum, x) => sum + estimatedPomodoros(x.secondsEstimate), 0) : count;
  const over = column.wipLimit !== null && load > column.wipLimit;
  const watched = !!me.watchedColumns?.includes(column._id);
  const watch = useMutation({
    mutationFn: () =>
      api('/me/watched-columns', { method: 'PUT', body: { columnId: column._id, watched: !watched } }),
    onMutate: () =>
      qc.setQueryData<User>(
        ['me'],
        (u) =>
          u && {
            ...u,
            watchedColumns: watched
              ? (u.watchedColumns ?? []).filter((c) => c !== column._id)
              : [...(u.watchedColumns ?? []), column._id],
          },
      ),
  });
  if (collapsed)
    return (
      <div className="">
        <button
          type="button"
          onClick={onToggle}
          aria-label={t('board.expand', { name: column.name })}
          className="flex h-full min-h-40 w-full flex-col items-center gap-2 rounded-lg bg-surface-2 py-3 text-sm font-semibold"
        >
          <span>{count}</span>
          <span className="[writing-mode:vertical-rl]">{column.name}</span>
        </button>
      </div>
    );
  return (
    <div className="sticky top-0 z-10 bg-bg pb-1">
      <div
        className={cx(
          'flex items-center gap-1 rounded-t-lg border-b-2 px-1 py-1.5',
          over ? 'border-danger' : 'border-line',
        )}
      >
        <h2
          className={cx('min-w-0 truncate font-semibold', over && 'text-danger')}
          title={column.description || undefined}
        >
          {column.name}
        </h2>
        <span className={cx('text-xs tabular-nums', over ? 'font-bold text-danger' : 'text-muted')}>
          {column.wipLimit !== null ? `${load}${pomodoros ? ' 🍅' : ''} / ${column.wipLimit}` : count}
        </span>
        {over && <span className="text-xs font-semibold text-danger">· {t('board.wipExceeded')}</span>}
        <span className={cx('ml-auto flex items-center', wall && 'hidden')}>
          <button
            type="button"
            className={cx(btnGhost, watched && 'text-accent')}
            aria-pressed={watched}
            aria-label={`${t('board.watch')} — ${column.name}`}
            title={t('board.watch')}
            onClick={() => watch.mutate()}
          >
            {watched ? '●' : '○'}
          </button>
          {can('task.create') && !data.board.swimlanes.length && (
            <button
              type="button"
              className={btnGhost}
              onClick={() => setAdding(true)}
              title={t('board.addTaskTop')}
              aria-label={`${t('board.addTaskTop')} — ${column.name}`}
            >
              +
            </button>
          )}
          <button
            type="button"
            className={btnGhost}
            onClick={onToggle}
            aria-label={`${t('board.collapse')} — ${column.name}`}
          >
            ‹
          </button>
        </span>
      </div>
      {adding && (
        <QuickAdd
          columnId={column._id}
          laneId={null}
          top
          onClose={() => setAdding(false)}
          onCreated={upsert}
        />
      )}
    </div>
  );
}

function ArchiveBefore() {
  const { t } = useTranslation();
  const { data, remove: onArchived } = useBoard();
  const [date, setDate] = useState('');
  const [result, setResult] = useState<number | null>(null);
  const archive = useMutation({
    mutationFn: () =>
      api<{ archived: number }>(`/boards/${data.board._id}/tasks/archive-completed`, {
        body: { before: new Date(date) },
      }),
    onSuccess: (r) => {
      setResult(r.archived);
      const limit = new Date(date).getTime();
      onArchived(
        data.tasks
          .filter(
            (x) =>
              x.columnId === data.board.completionColumnId &&
              x.completedAt &&
              new Date(x.completedAt).getTime() < limit,
          )
          .map((x) => x._id),
      );
    },
  });
  return (
    <details className="no-print px-1 text-xs text-muted">
      <summary className="cursor-pointer py-1">{t('board.archiveBefore')}…</summary>
      <form
        className="flex gap-1 pb-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (date) archive.mutate();
        }}
      >
        <input
          type="date"
          className={input}
          aria-label={t('board.archiveBefore')}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <button className={btnGhost}>{t('common.confirm')}</button>
      </form>
      {result !== null && <p role="status">{t('board.archiveBeforeDone', { count: result })}</p>}
    </details>
  );
}

function Cell({
  id,
  ids,
  column,
  laneId,
  canDrag,
}: {
  id: string;
  ids: string[];
  column: Column;
  laneId: string | null;
  canDrag: boolean;
}) {
  const { t } = useTranslation();
  const { data, can, upsert, tz } = useBoard();
  const { setNodeRef, isOver } = useDroppable({ id });
  const [adding, setAdding] = useState(false);
  const byId = new Map(data.tasks.map((x) => [x._id, x]));
  const isCompletion = column._id === data.board.completionColumnId;
  const laneName = data.board.swimlanes.find((l) => l._id === laneId)?.name;

  // Colonne de complétion : groupes Aujourd'hui / Hier / par date ; les plus anciens repliés par défaut.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(['today', 'yesterday']));
  const groups: { key: string; ids: string[] }[] = [];
  if (isCompletion) {
    const now = new Date();
    for (const taskId of ids) {
      const done = byId.get(taskId)?.completedAt;
      const key = done ? completionGroup(new Date(done), now, tz) : 'today';
      const g = groups.at(-1);
      if (g?.key === key) g.ids.push(taskId);
      else groups.push({ key, ids: [taskId] });
    }
  }
  const visible = isCompletion ? groups.flatMap((g) => (openGroups.has(g.key) ? g.ids : [])) : ids;
  const label = (key: string) =>
    key === 'today'
      ? t('board.today')
      : key === 'yesterday'
        ? t('board.yesterday')
        : formatDate(`${key}T12:00:00Z`, i18n.language, 'UTC');

  const cards = (list: string[]) =>
    list.map((taskId) => {
      const task = byId.get(taskId);
      return task ? <SortableCard key={taskId} task={task} disabled={!canDrag} /> : null;
    });

  return (
    <div
      ref={setNodeRef}
      role="group"
      aria-label={laneName ? `${column.name} / ${laneName}` : column.name}
      className={cx(
        'flex min-h-24 flex-col gap-2 rounded-lg p-1.5 transition-colors',
        isOver ? 'bg-accent/10' : 'bg-surface-2/60',
      )}
    >
      {isCompletion && can('task.edit') && laneId === (data.board.swimlanes[0]?._id ?? null) && (
        <ArchiveBefore />
      )}
      <SortableContext id={id} items={visible} strategy={verticalListSortingStrategy}>
        {isCompletion
          ? groups.map((g) => (
              <section key={g.key} className="space-y-2">
                <button
                  type="button"
                  aria-expanded={openGroups.has(g.key)}
                  className="flex w-full items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted"
                  onClick={() =>
                    setOpenGroups((s) => {
                      const n = new Set(s);
                      if (n.has(g.key)) n.delete(g.key);
                      else n.add(g.key);
                      return n;
                    })
                  }
                >
                  <span aria-hidden>{openGroups.has(g.key) ? '▾' : '▸'}</span>
                  {label(g.key)} <span className="font-normal">({g.ids.length})</span>
                </button>
                {openGroups.has(g.key) && cards(g.ids)}
              </section>
            ))
          : cards(ids)}
      </SortableContext>
      <Upcoming columnId={column._id} laneId={laneId} />
      {can('task.create') &&
        (adding ? (
          <QuickAdd
            columnId={column._id}
            laneId={laneId}
            onClose={() => setAdding(false)}
            onCreated={upsert}
          />
        ) : (
          <button
            type="button"
            className={cx(btnGhost, 'no-print justify-start')}
            onClick={() => setAdding(true)}
            data-new-task={
              column._id === data.board.columns[0]._id && laneId === (data.board.swimlanes[0]?._id ?? null)
                ? ''
                : undefined
            }
          >
            + {t('board.addTask')}
          </button>
        ))}
    </div>
  );
}

/** Occurrences à venir de la cellule, repliées ; cliquables pour ouvrir le détail. */
function Upcoming({ columnId, laneId }: { columnId: string; laneId: string | null }) {
  const { t } = useTranslation();
  const { data, openTask, tz } = useBoard();
  const now = useNow();
  const list = data.tasks
    .filter(
      (x) => x.columnId === columnId && x.swimlaneId === laneId && x.startAt && Date.parse(x.startAt) > now,
    )
    .sort((a, b) => a.startAt!.localeCompare(b.startAt!));
  if (!list.length) return null;
  return (
    <details className="text-xs text-muted">
      <summary className="cursor-pointer py-1">{t('board.upcoming', { count: list.length })}</summary>
      <ul className="space-y-1">
        {list.map((x) => (
          <li key={x._id}>
            <button
              type="button"
              className={cx(btnGhost, 'w-full justify-between')}
              onClick={() => openTask(x._id)}
            >
              <span className="truncate">↻ {x.name}</span>
              <span>{formatDate(x.startAt!, i18n.language, tz)}</span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Création en rafale : Entrée crée la tâche et garde le champ prêt pour la suivante ; Échap ferme. */
function QuickAdd({
  columnId,
  laneId,
  top,
  onClose,
  onCreated,
}: {
  columnId: string;
  laneId: string | null;
  top?: boolean;
  onClose: () => void;
  onCreated: (t: Task) => void;
}) {
  const { t } = useTranslation();
  const { data } = useBoard();
  const errorText = useErrorText();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: (n: string) =>
      api<Task>(`/boards/${data.board._id}/tasks`, { body: { name: n, columnId, swimlaneId: laneId, top } }),
    onSuccess: onCreated,
  });
  return (
    <form
      className="space-y-1"
      onSubmit={(e) => {
        e.preventDefault();
        const n = name.trim();
        if (!n) return;
        create.mutate(n);
        setName('');
      }}
    >
      <input
        autoFocus
        className={input}
        aria-label={t('board.newTaskPlaceholder')}
        placeholder={t('board.newTaskPlaceholder')}
        value={name}
        maxLength={255}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        onBlur={() => !name && onClose()}
      />
      {create.error && <p className="text-xs text-danger">{errorText(create.error)}</p>}
    </form>
  );
}
