import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type Task } from '../api';
import { ConfirmDialog, cx, useErrorText } from '../lib';
import { useBoard } from './context';

export interface MenuState {
  task: Task;
  x: number;
  y: number;
}

const MENU_W = 220;
const MENU_H = 190;

/**
 * Menu rapide d'une carte (clic droit, touche « Menu » ou Maj+F10) : ouvrir, dupliquer, archiver, supprimer.
 * Les actions proposées suivent les permissions ; la suppression passe par une confirmation.
 */
export function CardMenu({ menu, onClose }: { menu: MenuState | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { data, can, upsert, remove, openTask } = useBoard();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const ref = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/boards/${data.board._id}/tasks`;
  const refreshArchived = () => qc.invalidateQueries({ queryKey: ['archived', data.board._id] });

  const duplicate = useMutation({
    mutationFn: (task: Task) =>
      api<Task>(`${base}/${task._id}/duplicate`, {
        body: { name: t('menu.copyName', { name: task.name }).slice(0, 255) },
      }),
    onSuccess: upsert,
    onError: (e) => setError(errorText(e)),
  });
  const archive = useMutation({
    mutationFn: (task: Task) => api(`${base}/archive`, { body: { taskIds: [task._id] } }),
    onSuccess: (_r, task) => {
      remove([task._id]);
      void refreshArchived();
    },
    onError: (e) => setError(errorText(e)),
  });
  const del = useMutation({
    mutationFn: (task: Task) => api(`${base}/${task._id}`, { method: 'DELETE' }),
    onSuccess: (_r, task) => {
      remove([task._id]);
      setConfirming(null);
    },
    onError: (e) => {
      setConfirming(null);
      setError(errorText(e));
    },
  });

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(id);
  }, [error]);

  // Ouverture : focus sur le premier élément ; un clic ailleurs, un défilement ou la perte du focus ferment le menu.
  useEffect(() => {
    if (!menu) return;
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const close = (e: Event) => !ref.current?.contains(e.target as Node) && onClose();
    addEventListener('pointerdown', close, true);
    addEventListener('scroll', onClose, true);
    addEventListener('resize', onClose);
    return () => {
      removeEventListener('pointerdown', close, true);
      removeEventListener('scroll', onClose, true);
      removeEventListener('resize', onClose);
    };
  }, [menu, onClose]);

  /** Navigation clavier du menu (WAI-ARIA « menu ») : flèches, Début/Fin, Échap, Tab. */
  const onKeyDown = (e: KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      onClose();
      document.querySelector<HTMLElement>(`[data-task-id="${menu?.task._id}"] [data-handle]`)?.focus();
    }
  };

  const run = (action: () => void) => () => {
    setError(null);
    onClose();
    action();
  };
  const item =
    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-2 focus:bg-surface-2 focus:outline-none';

  return (
    <>
      {menu && (
        <div
          ref={ref}
          role="menu"
          aria-label={t('menu.label', { name: menu.task.name })}
          onKeyDown={onKeyDown}
          onContextMenu={(e) => e.preventDefault()}
          className="fixed z-50 w-56 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-xl"
          style={{
            left: Math.max(4, Math.min(menu.x, innerWidth - MENU_W)),
            top: Math.max(4, Math.min(menu.y, innerHeight - MENU_H)),
          }}
        >
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={item}
            onClick={run(() => openTask(menu.task._id))}
          >
            {t('menu.open')}
          </button>
          {can('task.create') && (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={item}
              onClick={run(() => duplicate.mutate(menu.task))}
            >
              {t('menu.duplicate')}
            </button>
          )}
          {can('task.edit') && (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={item}
              onClick={run(() => archive.mutate(menu.task))}
            >
              {t('task.archive')}
            </button>
          )}
          {can('task.delete') && (
            <>
              <div role="separator" className="my-1 border-t border-line" />
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={cx(item, 'text-danger')}
                onClick={run(() => setConfirming(menu.task))}
              >
                {t('common.delete')}…
              </button>
            </>
          )}
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="no-print fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-danger px-3 py-2 text-sm text-white"
        >
          {error}
        </p>
      )}
      <ConfirmDialog
        open={!!confirming}
        title={t('menu.deleteTitle')}
        message={t('menu.deleteText', { name: confirming?.name ?? '' })}
        confirmLabel={t('common.delete')}
        pending={del.isPending}
        onConfirm={() => confirming && del.mutate(confirming)}
        onClose={() => setConfirming(null)}
      />
    </>
  );
}
