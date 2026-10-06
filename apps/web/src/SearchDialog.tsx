import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TaskColor } from '@flowboard/shared';
import { api } from './api';
import { btn, btnGhost, colorHex, ErrorText, input, Modal } from './lib';

interface Hit {
  _id: string;
  boardId: string;
  name: string;
  color: TaskColor;
  archivedAt: string | null;
  boardName: string;
  columnName: string;
}

/** Recherche globale plein texte sur tous les boards accessibles (spec § 4.5). */
export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [archived, setArchived] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);
  const results = useQuery({
    queryKey: ['search', debounced, archived],
    queryFn: () =>
      api<Hit[]>(`/search?q=${encodeURIComponent(debounced)}${archived ? '&archived=true' : ''}`),
    enabled: open && !!debounced,
  });
  const restore = useMutation({
    mutationFn: (h: Hit) => api(`/boards/${h.boardId}/tasks/${h._id}/restore`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['search'] }),
  });
  const go = (h: Hit) => {
    onClose();
    navigate(`/boards/${h.boardId}?task=${h._id}`);
  };

  return (
    <Modal open={open} onClose={onClose} title={t('search.title')}>
      <div className="space-y-3">
        <input
          autoFocus
          type="search"
          className={input}
          aria-label={t('search.placeholder')}
          placeholder={t('search.placeholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          {t('search.includeArchived')}
        </label>
        <ErrorText error={results.error ?? restore.error} />
        {debounced && results.data?.length === 0 && <p className="text-sm text-muted">{t('search.empty')}</p>}
        <ul className="divide-y divide-line" aria-label={t('search.results')}>
          {results.data?.map((h) => (
            <li key={h._id} className="flex items-center gap-2 py-1.5">
              <span
                aria-hidden
                className="h-8 w-1.5 shrink-0 rounded"
                style={{ background: colorHex(h.color) }}
              />
              <button
                type="button"
                className={`${btnGhost} min-w-0 flex-1 flex-col items-start text-left`}
                onClick={() => go(h)}
              >
                <span className="w-full truncate font-medium text-fg">{h.name}</span>
                <span className="w-full truncate text-xs">
                  {h.boardName} · {h.columnName}
                </span>
              </button>
              {h.archivedAt && (
                <>
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">
                    {t('task.archivedBadge')}
                  </span>
                  <button type="button" className={btn} onClick={() => restore.mutate(h)}>
                    {t('task.restore')}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
