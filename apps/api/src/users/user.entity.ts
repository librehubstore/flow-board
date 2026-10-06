import type { BoardFilter, NotificationType, PomodoroSettings } from '@flowboard/shared';

export interface User {
  _id: string;
  username: string;
  fullName: string;
  email: string | null;
  /** null : compte sans mot de passe (créé par Google). */
  passwordHash: string | null;
  globalRole: 'admin' | 'user';
  /** `pending` : inscription en attente de validation de l'email. */
  status: 'active' | 'disabled' | 'pending';
  emailVerified?: boolean;
  googleId?: string | null;
  mustChangePassword: boolean;
  locale: 'fr' | 'en' | null;
  timezone: string | null;
  theme: 'light' | 'dark' | 'system';
  collapsedColumns: string[];
  notificationPrefs?: Partial<Record<NotificationType, boolean>>;
  /** Filtre mémorisé par board (spec § 4.5). */
  boardFilters?: Record<string, BoardFilter>;
  /** Réglages Pomodoro (valeurs par défaut si absents). */
  pomodoro?: Partial<PomodoroSettings>;
  /** Colonnes suivies : notification quand une tâche y entre (spec § 4.2). */
  watchedColumns?: string[];
  createdAt: Date;
  lastLoginAt: Date | null;
}
export type PublicUser = Omit<User, 'passwordHash'>;

/** Projection Mongo qui n'expose jamais le haché du mot de passe. */
export const hidePassword = { projection: { passwordHash: 0 } } as const;
