import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type BoardPayload, type Comment, type Task } from '../api';
import { btn, ErrorText, useMe, useTimeZone } from '../lib';
import { getSocket } from '../socket';
import { BoardCtx, pendingTasks, type BoardContext } from './context';
import { BoardGrid } from './BoardGrid';
import { TaskDialog } from './TaskDialog';
import { BoardSettings } from './BoardSettings';
import { ArchivedPanel } from './ArchivedPanel';

export function BoardPage() {
  const { boardId = '' } = useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const me = useMe().data!;
  const tz = useTimeZone();
  const [panel, setPanel] = useState<'settings' | 'archived' | null>(null);
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
    (ids: string[]) => qc.setQueryData<BoardPayload>(key, (d) => d && { ...d, tasks: d.tasks.filter((x) => !ids.includes(x._id)) }),
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

  const data = query.data;
  const ctx = useMemo<BoardContext | null>(
    () =>
      data
        ? {
            data,
            can: (p) => data.permissions.includes(p),
            member: (id) => data.members.find((m) => m.userId === id),
            upsert,
            remove,
            openTask: (id) => setParams({ task: id }),
            meId: me._id,
            tz,
          }
        : null,
    [data, upsert, remove, setParams, me._id, tz],
  );

  if (query.error) return <div className="p-6"><ErrorText error={query.error} /></div>;
  if (!ctx || !data) return <p className="p-6 text-muted">{t('common.loading')}</p>;
  const taskId = params.get('task');

  return (
    <BoardCtx.Provider value={ctx}>
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2">
        <h1 className="text-lg font-bold">{data.board.name}</h1>
        {!ctx.can('task.edit') && <span className="rounded bg-surface-2 px-2 py-0.5 text-xs text-muted">{t('board.readOnly')}</span>}
        <div className="ml-auto flex gap-2">
          <button type="button" className={btn} onClick={() => setPanel('archived')}>
            {t('board.archived')}
          </button>
          <button type="button" className={btn} onClick={() => print()}>
            {t('board.print')}
          </button>
          {ctx.can('board.structure') || ctx.can('board.members') ? (
            <button type="button" className={btn} onClick={() => setPanel('settings')}>
              {t('board.settings')}
            </button>
          ) : null}
        </div>
      </div>
      <BoardGrid />
      {taskId && <TaskDialog taskId={taskId} onClose={() => setParams({})} />}
      <BoardSettings open={panel === 'settings'} onClose={() => setPanel(null)} />
      <ArchivedPanel open={panel === 'archived'} onClose={() => setPanel(null)} />
    </BoardCtx.Provider>
  );
}
