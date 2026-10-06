import type { INTERRUPTION_REASONS } from '@flowboard/shared';

/** Portion d'une entrée de temps consacrée à une tâche (le chronomètre en enchaîne plusieurs). */
export interface TimeEntryPart {
  taskId: string;
  boardId: string;
  startAt: Date;
  endAt: Date | null;
}

export interface TimeEntry {
  _id: string;
  userId: string;
  type: 'pomodoro' | 'stopwatch' | 'manual';
  startAt: Date;
  endAt: Date | null;
  /** Vrai tant que le minuteur tourne (au plus une par utilisateur, index unique partiel). */
  running: boolean;
  parts: TimeEntryPart[];
  comment: string;
  timeLabels: string[];
  /** Pomodoro : réussi, ou interrompu (« échoué ») avec un motif. */
  success: boolean | null;
  targetWorkMinutes: number | null;
  interruptionReason: (typeof INTERRUPTION_REASONS)[number] | null;
  createdAt: Date;
}

/** État du minuteur d'un utilisateur, côté serveur : survit au rechargement et suit l'utilisateur d'un appareil à l'autre. */
export interface Timer {
  _id: string; // userId
  kind: 'pomodoro' | 'stopwatch';
  phase: 'work' | 'shortBreak' | 'longBreak';
  entryId: string | null; // null pendant une pause
  taskId: string;
  boardId: string;
  startedAt: Date;
  endsAt: Date | null; // null pour le chronomètre
  /** Pomodoros terminés dans le cycle courant (pause longue tous les N). */
  cycle: number;
}
