import type { RecurrenceInput, TaskColor } from '@flowboard/shared';

export interface SubTask {
  _id: string;
  name: string;
  done: boolean;
  assigneeId: string | null;
  dueAt: Date | null;
}

export interface Task {
  _id: string;
  boardId: string;
  columnId: string;
  swimlaneId: string | null;
  position: number;
  name: string;
  description: string;
  color: TaskColor;
  /** Numéro de la tâche dans son board, si la numérotation est activée. */
  number?: number | null;
  /** Valeurs des champs personnalisés : texte, nombre ou identifiant d'option. */
  customFields?: Record<string, string | number | null>;
  responsibleUserId: string | null;
  collaboratorIds: string[];
  labels: { id: string; pinned: boolean }[];
  subtasks: SubTask[];
  pointsEstimate: number | null;
  secondsEstimate: number | null;
  dueAt: Date | null;
  dueHasTime: boolean;
  dueTargetColumnId: string | null; // null = colonne de complétion
  dueReachedAt: Date | null;
  completedAt: Date | null;
  archivedAt: Date | null;
  /** Masquée du board jusqu'à cette date (occurrence de récurrence à venir). */
  startAt?: Date | null;
  recurrence?: Recurrence | null;
  commentsCount: number;
  /** Temps passé (secondes), somme des entrées de temps terminées. */
  spentSeconds?: number;
  /** Texte dénormalisé (nom, description, sous-tâches, labels, commentaires) pour la recherche (§ 4.5). */
  searchText?: string;
  attachmentsCount: number;
  dueNotified?: { soon?: boolean; overdue?: boolean };
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  updatedById: string;
}

/**
 * Récurrence embarquée dans chaque occurrence : modifier la règle n'affecte que les occurrences suivantes (spec § 4.4).
 * `anchor` = date de cette occurrence dans la série, `index` = son rang (1, 2, …).
 */
export interface Recurrence extends RecurrenceInput {
  anchor: Date;
  index: number;
  /** L'occurrence suivante a déjà été créée (garde contre les doublons). */
  spawned: boolean;
  /** Mode « date fixe » : date de création de l'occurrence suivante. */
  nextAt: Date | null;
}

/** Journal des modifications (spec § 4.9), base des rapports de flux. */
export interface TaskEvent {
  _id: string;
  boardId: string;
  taskId: string | null;
  actorId: string;
  type:
    | 'taskCreated'
    | 'taskChanged'
    | 'taskMoved'
    | 'taskArchived'
    | 'taskRestored'
    | 'taskDeleted'
    | 'commentCreated'
    | 'commentChanged'
    | 'commentDeleted'
    | 'attachmentAdded'
    | 'attachmentDeleted';
  changes: Record<string, { old: unknown; new: unknown }>;
  at: Date;
}

/** Événements applicatifs (bus interne) : suppression en cascade sans dépendance circulaire entre modules. */
export const TASK_DELETED = 'task.deleted';
export const BOARD_PURGED = 'board.purged';
export const TASK_COMPLETED = 'task.completed';
export interface TaskDeletedEvent {
  taskId: string;
}
export interface TaskCompletedEvent {
  task: Task;
  actorId: string;
}
export interface BoardPurgedEvent {
  boardId: string;
}
