import { createContext, useContext } from 'react';
import { useMutation, useQueryClient, type MutateOptions } from '@tanstack/react-query';
import type { BoardFilter, Permission } from '@flowboard/shared';
import type { BoardPayload, Member, Task } from '../api';

export interface BoardContext {
  data: BoardPayload;
  can: (p: Permission) => boolean;
  member: (userId: string | null | undefined) => Member | undefined;
  /** Remplace (ou ajoute) une tâche dans le cache ; une tâche archivée en est retirée. */
  upsert: (task: Task) => void;
  remove: (ids: string[]) => void;
  openTask: (id: string) => void;
  /** Menu rapide d'une carte, à la position donnée (clic droit ou clavier). */
  openMenu: (task: Task, x: number, y: number) => void;
  meId: string;
  tz: string;
  /** Mode mur : affichage plein écran en lecture seule. */
  wall?: boolean;
  filter: BoardFilter;
  setFilter: (f: BoardFilter) => void;
  /** Vrai si la tâche passe le filtre du board. */
  matches: (task: Task) => boolean;
}

export const BoardCtx = createContext<BoardContext | null>(null);
export const useBoard = () => useContext(BoardCtx)!;

/** Nombre de mutations en vol par tâche : leurs échos temps réel sont ignorés (voir BoardPage). */
export const pendingTasks = new Map<string, number>();

/**
 * Mutation d'une tâche avec mise à jour optimiste. Seule la réponse de la dernière mutation en vol
 * est appliquée : une réponse plus ancienne n'écrase jamais un changement local plus récent.
 */
export function useTaskMutation<V>(
  taskId: string | ((v: V) => string),
  fn: (v: V) => Promise<Task>,
  optimistic: (v: V) => Task | undefined,
) {
  const { data, upsert } = useBoard();
  const qc = useQueryClient();
  const idOf = (v: V) => (typeof taskId === 'string' ? taskId : taskId(v));
  const end = (v: V) => {
    const id = idOf(v);
    const n = (pendingTasks.get(id) ?? 1) - 1;
    if (n > 0) pendingTasks.set(id, n);
    else pendingTasks.delete(id);
    return n === 0;
  };
  const mutation = useMutation({
    mutationFn: fn,
    onSuccess: (task, v) => {
      if (end(v)) upsert(task);
    },
    onError: (_e, v) => {
      if (end(v)) void qc.invalidateQueries({ queryKey: ['board', data.board._id] });
    },
  });
  // Mise à jour optimiste synchrone (dans le gestionnaire d'événement) : pas de retour visuel à l'ancien état.
  const mutate = (v: V, options?: MutateOptions<Task, Error, V>) => {
    pendingTasks.set(idOf(v), (pendingTasks.get(idOf(v)) ?? 0) + 1);
    const next = optimistic(v);
    if (next) upsert(next);
    mutation.mutate(v, options);
  };
  return { ...mutation, mutate };
}
