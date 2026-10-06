import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { EMPTY_FILTER, isFilterActive, matchesFilter, type BoardFilter } from '@flowboard/shared';
import { api, type BoardPayload, type Comment, type Task, type User } from '../api';
import { btn, ErrorText, useMe, useNow, useTimeZone } from '../lib';
import { getSocket } from '../socket';
import { BoardCtx, pendingTasks, type BoardContext } from './context';
import { BoardGrid } from './BoardGrid';
import { TaskDialog } from './TaskDialog';
import { BoardSettings } from './BoardSettings';
import { ArchivedPanel } from './ArchivedPanel';
import { FilterBar } from './FilterBar';
import { BoardJournal } from './History';
import { CardMenu, type MenuState } from './CardMenu';

/** Prédicat de filtre : contexte calculé une fois ; sans filtre actif, tout passe sans calcul. */
function matcher(data: BoardPayload, filter: BoardFilter, me: string, now: number, timeZone: string) {
  if (!isFilterActive(filter)) return () => true;
  const ctx = {
    me,
    now: new Date(now),
    timeZone,
    labelNames: new Map(data.board.labels.map((l) => [l._id, l.name])),
    taskPrefix: data.board.taskNumbering?.prefix,
  };
  return (task: Task) => matchesFilter(task, filter, ctx);
}

/** Un composant par board : l'état local (filtre, panneaux) repart de zéro quand on change de board. */
export function BoardPage() {
  const { boardId = '' } = useParams();
  return <BoardView key={boardId} boardId={boardId} />;
}

/** Mode mur (spec § 4.2) : plein écran, lecture seule, temps réel, sans en-tête de l'application. */
export function WallPage() {
  const { boardId = '' } = useParams();
  return <BoardView key={boardId} boardId={boardId} wall />;
}

function BoardView({ boardId, wall = false }: { boardId: string; wall?: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const me = useMe().data!;
  const tz = useTimeZone();
  const [panel, setPanel] = useState<'settings' | 'archived' | 'journal' | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const key = useMemo(() => ['board', boardId], [boardId]);
  const query = useQuery({ queryKey: key, queryFn: () => api<BoardPayload>(`/boards/${boardId}`) });

  const upsert = useCallback(
    (task: Task) =>
      qc.setQueryData<BoardPayload>(key, (d) => {
        if (!d) return d;
        const tasks = d.tasks.filter((x) => x._id !== task._id);
        return { ...d, tasks: task.archivedAt ? tasks : [...tasks, task] };
      }),
    [qc, key],
  );
  const remove = useCallback(
    (ids: string[]) =>
      qc.setQueryData<BoardPayload>(
        key,
        (d) => d && { ...d, tasks: d.tasks.filter((x) => !ids.includes(x._id)) },
      ),
    [qc, key],
  );

  // Temps réel : rejoindre la room du board, appliquer les changements au cache, resynchroniser à la reconnexion.
  useEffect(() => {
    const socket = getSocket();
    const join = () => void socket.emit('join', boardId);
    const onReconnect = () => {
      join();
      void qc.invalidateQueries({ queryKey: key });
    };
    // Écho d'une tâche que l'on est en train de modifier : la réponse de notre propre requête fera foi.
    const onTask = (task: Task) => task.boardId === boardId && !pendingTasks.has(task._id) && upsert(task);
    const onRemoved = (ids: string[]) => remove(ids);
    const onChanged = () => void qc.invalidateQueries({ queryKey: key });
    const onDeleted = () => navigate('/');
    const onComment = (c: Comment) => void qc.invalidateQueries({ queryKey: ['comments', c.taskId] });
    join();
    socket.io.on('reconnect', onReconnect);
    socket.on('task', onTask);
    socket.on('tasks.removed', onRemoved);
    socket.on('board.changed', onChanged);
    socket.on('board.deleted', onDeleted);
    socket.on('comment', onComment);
    socket.on('comment.removed', onComment);
    return () => {
      socket.io.off('reconnect', onReconnect);
      socket.off('task', onTask);
      socket.off('tasks.removed', onRemoved);
      socket.off('board.changed', onChanged);
      socket.off('board.deleted', onDeleted);
      socket.off('comment', onComment);
      socket.off('comment.removed', onComment);
    };
  }, [boardId, key, qc, upsert, remove, navigate]);

  // Filtre mémorisé par utilisateur et par board, enregistré 400 ms après la dernière modification.
  const stored = useMemo(
    () => ({ ...EMPTY_FILTER, ...me.boardFilters?.[boardId] }),
    [me.boardFilters, boardId],
  );
  const [filter, setFilter] = useState<BoardFilter>(stored);
  useEffect(() => {
    if (JSON.stringify(filter) === JSON.stringify(stored)) return;
    const timer = setTimeout(() => {
      void api(`/me/board-filters/${boardId}`, { method: 'PUT', body: filter });
      qc.setQueryData<User>(
        ['me'],
        (u) => u && { ...u, boardFilters: { ...u.boardFilters, [boardId]: filter } },
      );
    }, 400);
    return () => clearTimeout(timer);
  }, [filter, stored, boardId, qc]);
  const now = useNow();

  const data = query.data;
  const ctx = useMemo<BoardContext | null>(
    () =>
      data
        ? {
            data,
            // Le mur est en lecture seule, quels que soient les droits.
            can: (p) => (wall ? p === 'board.view' : data.permissions.includes(p)),
            wall,
            member: (id) => data.members.find((m) => m.userId === id),
            upsert,
            remove,
            openTask: (id) => !wall && setParams({ task: id }),
            // Pas de menu en mode mur (lecture seule).
            openMenu: (task, x, y) => !wall && setMenu({ task, x, y }),
            meId: me._id,
            tz,
            filter,
            setFilter,
            matches: matcher(data, filter, me._id, now, tz),
          }
        : null,
    [data, upsert, remove, setParams, me._id, tz, filter, setFilter, now, wall],
  );

  if (query.error)
    return (
      <div className="p-6">
        <ErrorText error={query.error} />
      </div>
    );
  if (!ctx || !data) return <p className="p-6 text-muted">{t('common.loading')}</p>;
  const taskId = params.get('task');

  if (wall)
    return (
      <BoardCtx.Provider value={{ ...ctx, filter: EMPTY_FILTER, matches: () => true }}>
        <div className="flex min-h-screen flex-col">
          <div className="no-print flex items-center gap-3 border-b border-line bg-surface px-4 py-2">
            <h1 className="text-xl font-bold">{data.board.name}</h1>
            <span className="ml-auto flex gap-2">
              <button
                type="button"
                className={btn}
                onClick={() => void document.documentElement.requestFullscreen?.()}
              >
                {t('board.fullscreen')}
              </button>
              <Link className={btn} to={`/boards/${boardId}`}>
                {t('board.leaveWall')}
              </Link>
            </span>
          </div>
          <BoardGrid />
        </div>
      </BoardCtx.Provider>
    );

  return (
    <BoardCtx.Provider value={ctx}>
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2">
        <h1 className="text-lg font-bold">{data.board.name}</h1>
        {!ctx.can('task.edit') && (
          <span className="rounded bg-surface-2 px-2 py-0.5 text-xs text-muted">{t('board.readOnly')}</span>
        )}
        <div className="ml-auto flex gap-2">
          <button type="button" className={btn} onClick={() => setPanel('archived')}>
            {t('board.archived')}
          </button>
          <button type="button" className={btn} onClick={() => setPanel('journal')}>
            {t('history.journal')}
          </button>
          <Link className={btn} to={`/boards/${boardId}/wall`}>
            {t('board.wall')}
          </Link>
          <button type="button" className={btn} onClick={() => print()}>
            {t('board.print')}
          </button>
          <a className={btn} href={`/api/boards/${data.board._id}/export.csv`} download>
            {t('board.exportCsv')}
          </a>
          {ctx.can('board.structure') || ctx.can('board.members') ? (
            <button type="button" className={btn} onClick={() => setPanel('settings')}>
              {t('board.settings')}
            </button>
          ) : null}
        </div>
      </div>
      <FilterBar hidden={data.tasks.filter((x) => !ctx.matches(x)).length} />
      <BoardGrid />
      {taskId && <TaskDialog taskId={taskId} onClose={() => setParams({})} />}
      <BoardSettings open={panel === 'settings'} onClose={() => setPanel(null)} />
      <ArchivedPanel open={panel === 'archived'} onClose={() => setPanel(null)} />
      <BoardJournal open={panel === 'journal'} onClose={() => setPanel(null)} />
      <CardMenu menu={menu} onClose={closeMenu} />
    </BoardCtx.Provider>
  );
}
