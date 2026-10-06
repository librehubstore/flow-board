import type { BoardRole, CUSTOM_FIELD_TYPES } from '@flowboard/shared';

export interface Column {
  _id: string;
  name: string;
  description: string;
  wipLimit: number | null;
  /** Unité de la limite WIP : nombre de tâches (défaut) ou pomodoros estimés (spec § 4.2). */
  wipUnit?: 'tasks' | 'pomodoros';
}
export interface Swimlane {
  _id: string;
  name: string;
  description: string;
}
export interface Member {
  userId: string;
  role: BoardRole;
}
export interface Label {
  _id: string;
  name: string;
}

/** Champ personnalisé défini au niveau du board (spec § 4.3). */
export interface CustomField {
  _id: string;
  name: string;
  type: (typeof CUSTOM_FIELD_TYPES)[number];
  numberPrefix: string;
  numberSuffix: string;
  options: { _id: string; label: string }[];
  showOnCard: boolean;
}

/**
 * Colonnes, swimlanes, membres et labels sont embarqués dans le board : toute modification
 * de structure est une écriture atomique sur un seul document (Mongo mono-instance, sans transaction).
 */
export interface Board {
  _id: string;
  name: string;
  description: string;
  columns: Column[]; // l'ordre du tableau = l'ordre d'affichage
  swimlanes: Swimlane[];
  completionColumnId: string;
  members: Member[];
  labels: Label[];
  /** Légende des couleurs : palette et couleurs personnalisées (`#rrggbb`). */
  colorLabels: Record<string, string>;
  customColors?: string[];
  customFields?: CustomField[];
  taskNumbering?: { enabled: boolean; prefix: string };
  /** Dernier numéro attribué : jamais réutilisé, même après suppression (spec § 4.3). */
  taskCounter?: number;
  /** Modèle : sa structure peut être copiée par tout utilisateur (spec § 4.2). */
  isTemplate?: boolean;
  createdAt: Date;
  deletedAt: Date | null;
}
