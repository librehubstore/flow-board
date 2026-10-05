import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type Task } from '../api';
import { btn, btnGhost, ErrorText, formatDate, i18n, Modal } from '../lib';
import { useBoard } from './context';

export function ArchivedPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { data, can, upsert, openTask, tz } = useBoard();
  const qc = useQueryClient();
  const key = ['archived', data.board._id];
  const list = useQuery({ queryKey: key, queryFn: () => api<Task[]>(`/boards/${data.board._id}/tasks?archived=true`), enabled: open });
  const restore = useMutation({
    mutationFn: (id: string) => api<Task>(`/boards/${data.board._id}/tasks/${id}/restore`, { method: 'POST' }),
    onSuccess: (task) => {
      upsert(task);
      void qc.invalidateQueries({ queryKey: key });
    },
  });
  return (
    <Modal open={open} onClose={onClose} title={t('archived.title')}>
      {list.data?.length === 0 && <p className="text-muted">{t('archived.empty')}</p>}
      <ul className="divide-y divide-line">
        {list.data?.map((task) => (
          <li key={task._id} className="flex items-center gap-2 py-2">
            <button type="button" className={`${btnGhost} min-w-0 flex-1 justify-start text-fg`} onClick={() => openTask(task._id)}>
              <span className="truncate">{task.name}</span>
            </button>
            <span className="text-xs text-muted">{t('archived.archivedOn', { date: formatDate(task.archivedAt!, i18n.language, tz) })}</span>
            {can('task.edit') && (
              <button type="button" className={btn} onClick={() => restore.mutate(task._id)}>
                {t('task.restore')}
              </button>
            )}
          </li>
        ))}
      </ul>
      <ErrorText error={restore.error ?? list.error} />
    </Modal>
  );
}
