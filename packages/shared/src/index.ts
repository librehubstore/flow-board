import { z } from 'zod';

export const APP_NAME = 'Flowboard';
export const CSRF_HEADER = 'x-flowboard-csrf';

// ---------- Permissions (spec § 4.10) ----------
export const PERMISSIONS = [
  'board.view',
  'task.create',
  'task.edit',
  'task.move',
  'task.delete',
  'comment',
  'time.track',
  'time.viewOthers',
  'reports.view',
  'board.structure',
  'board.members',
  'board.api',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const BOARD_ROLES = ['owner', 'editor', 'reader'] as const;
export type BoardRole = (typeof BOARD_ROLES)[number];

export const ROLE_PERMISSIONS: Record<BoardRole, readonly Permission[]> = {
  owner: PERMISSIONS,
  editor: ['board.view', 'task.create', 'task.edit', 'task.move', 'task.delete', 'comment', 'time.track', 'reports.view'],
  reader: ['board.view', 'reports.view'],
};
/** Un admin global voit tous les boards, sans pouvoir les modifier s'il n'en est pas membre. */
export const ADMIN_VIEW_PERMISSIONS: readonly Permission[] = ['board.view', 'reports.view'];

// ---------- Couleurs de tâche (spec § 4.2) ----------
export const COLORS = [
  'yellow',
  'white',
  'red',
  'green',
  'blue',
  'purple',
  'orange',
  'cyan',
  'brown',
  'magenta',
] as const;
export type Color = (typeof COLORS)[number];

// ---------- Notifications (spec § 9) ----------
export const NOTIFICATION_TYPES = ['assigned', 'subtaskAssigned', 'mentioned', 'commented', 'dueSoon', 'overdue'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Identifiants mentionnés (`@identifiant`) dans un texte. */
export function mentions(text: string): string[] {
  return [...new Set([...text.matchAll(/(?:^|[^\w@])@([a-z0-9._-]{3,50})/gi)].map((m) => m[1].toLowerCase().replace(/\.+$/, '')))];
}

// ---------- Schémas d'entrée ----------
const id = z.string().min(1).max(64);
const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,50}$/);
const password = z.string().min(10).max(200);
const nullableEmail = z.union([z.email().max(200), z.literal('').transform(() => null), z.null()]);
export const LOCALES = ['fr', 'en'] as const;
export const THEMES = ['light', 'dark', 'system'] as const;

export const LoginInput = z.object({ username: z.string().trim().toLowerCase().max(50), password: z.string().max(200) });
export const ChangePasswordInput = z.object({ currentPassword: z.string().max(200), newPassword: password });
export const CreateUserInput = z.object({
  username,
  fullName: z.string().trim().min(1).max(100),
  email: nullableEmail.optional(),
  password,
  globalRole: z.enum(['admin', 'user']).default('user'),
});
export const UpdateUserInput = z.object({
  fullName: z.string().trim().min(1).max(100).optional(),
  email: nullableEmail.optional(),
  globalRole: z.enum(['admin', 'user']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});
export const UpdateProfileInput = z.object({
  fullName: z.string().trim().min(1).max(100).optional(),
  email: nullableEmail.optional(),
  locale: z.enum(LOCALES).nullable().optional(),
  timezone: z.string().max(64).nullable().optional(),
  theme: z.enum(THEMES).optional(),
  notificationPrefs: z.partialRecord(z.enum(NOTIFICATION_TYPES), z.boolean()).optional(),
});
export const CollapseColumnInput = z.object({ columnId: id, collapsed: z.boolean() });
export const UpdateSettingsInput = z.object({
  instanceName: z.string().trim().min(1).max(100).optional(),
  defaultLocale: z.enum(LOCALES).optional(),
  defaultTimezone: z.string().max(64).optional(),
  maxAttachmentMb: z.number().int().min(1).max(1024).optional(),
});

const name = z.string().trim().min(1).max(255);
const description = z.string().max(20000);
export const CreateBoardInput = z.object({ name, description: description.default('') });
export const UpdateBoardInput = z.object({
  name: name.optional(),
  description: description.optional(),
  completionColumnId: id.optional(),
  colorLabels: z.partialRecord(z.enum(COLORS), z.string().trim().max(50)).optional(),
});
export const DeleteBoardInput = z.object({ confirmName: z.string() });
export const ColumnInput = z.object({
  name: name.optional(),
  description: description.optional(),
  wipLimit: z.number().int().min(1).nullable().optional(),
});
export const CreateColumnInput = ColumnInput.extend({ name });
export const SwimlaneInput = z.object({ name: name.optional(), description: description.optional() });
export const CreateSwimlaneInput = SwimlaneInput.extend({ name });
export const ReorderInput = z.object({ ids: z.array(id).min(1) });
export const DeleteWithDestinationInput = z.object({ destinationId: id.optional() });
export const MemberInput = z.object({ userId: id, role: z.enum(BOARD_ROLES) });
export const RoleInput = z.object({ role: z.enum(BOARD_ROLES) });
export const TransferInput = z.object({ userId: id });

export const LabelInput = z.object({ name: z.string().trim().min(1).max(50) });
export const CreateTaskInput = z.object({
  name,
  columnId: id.optional(),
  swimlaneId: id.nullable().optional(),
  top: z.boolean().optional(),
});
const subtask = z.object({
  _id: id,
  name,
  done: z.boolean(),
  assigneeId: id.nullable().default(null),
  dueAt: z.coerce.date().nullable().default(null),
});
export const UpdateTaskInput = z.object({
  name: name.optional(),
  description: description.optional(),
  color: z.enum(COLORS).optional(),
  responsibleUserId: id.nullable().optional(),
  collaboratorIds: z.array(id).max(100).optional(),
  labels: z.array(z.object({ id, pinned: z.boolean() })).max(50).optional(),
  subtasks: z.array(subtask).max(200).optional(),
  pointsEstimate: z.number().min(0).nullable().optional(),
  secondsEstimate: z.number().int().min(0).nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  dueHasTime: z.boolean().optional(),
  dueTargetColumnId: id.nullable().optional(),
  completedAt: z.coerce.date().optional(),
});
export const MoveTaskInput = z.object({
  columnId: id,
  swimlaneId: id.nullable().optional(),
  index: z.number().int().min(0).optional(),
});
export const TaskIdsInput = z.object({ taskIds: z.array(id).min(1).max(1000) });
export const ArchiveCompletedInput = z.object({ before: z.coerce.date() });
export const CommentInput = z.object({ text: z.string().trim().min(1).max(10000) });
export const MarkReadInput = z.object({ ids: z.array(id).max(500).optional() });

export type LoginInput = z.infer<typeof LoginInput>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordInput>;
export type CollapseColumnInput = z.infer<typeof CollapseColumnInput>;
export type CreateBoardInput = z.infer<typeof CreateBoardInput>;
export type DeleteBoardInput = z.infer<typeof DeleteBoardInput>;
export type ReorderInput = z.infer<typeof ReorderInput>;
export type DeleteWithDestinationInput = z.infer<typeof DeleteWithDestinationInput>;
export type MemberInput = z.infer<typeof MemberInput>;
export type RoleInput = z.infer<typeof RoleInput>;
export type TransferInput = z.infer<typeof TransferInput>;
export type LabelInput = z.infer<typeof LabelInput>;
export type TaskIdsInput = z.infer<typeof TaskIdsInput>;
export type ArchiveCompletedInput = z.infer<typeof ArchiveCompletedInput>;
export type CommentInput = z.infer<typeof CommentInput>;
export type MarkReadInput = z.infer<typeof MarkReadInput>;
export type CreateUserInput = z.infer<typeof CreateUserInput>;
export type UpdateUserInput = z.infer<typeof UpdateUserInput>;
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>;
export type UpdateSettingsInput = z.infer<typeof UpdateSettingsInput>;
export type UpdateBoardInput = z.infer<typeof UpdateBoardInput>;
export type ColumnInput = z.infer<typeof ColumnInput>;
export type SwimlaneInput = z.infer<typeof SwimlaneInput>;
export type CreateTaskInput = z.infer<typeof CreateTaskInput>;
export type UpdateTaskInput = z.infer<typeof UpdateTaskInput>;
/** Corps JSON côté client : les dates sont des chaînes ISO. */
export type UpdateTaskBody = z.input<typeof UpdateTaskInput>;
export type MoveTaskInput = z.infer<typeof MoveTaskInput>;

// ---------- Règles métier pures (partagées front/back) ----------

/** Clé de jour `AAAA-MM-JJ` d'un instant dans un fuseau donné. */
export function dayKey(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Groupe de la colonne de complétion : `today`, `yesterday` ou la clé de jour. */
export function completionGroup(completedAt: Date, now: Date, timeZone?: string): string {
  const key = dayKey(completedAt, timeZone);
  if (key === dayKey(now, timeZone)) return 'today';
  if (key === dayKey(new Date(now.getTime() - 86_400_000), timeZone)) return 'yesterday';
  return key;
}

export type DueStatus = 'met' | 'missed' | 'overdue' | 'soon' | 'pending';

/**
 * Statut d'échéance (spec § 4.3) : tenue si la colonne cible est atteinte avant l'échéance.
 * `reachedAt` = date d'arrivée dans la colonne cible (null si pas encore atteinte).
 * Sans heure, l'échéance court jusqu'à la fin du jour.
 */
export function dueStatus(dueAt: Date, dueHasTime: boolean, reachedAt: Date | null, now: Date): DueStatus {
  const deadline = dueHasTime ? dueAt.getTime() : dueAt.getTime() + 86_400_000 - 1;
  if (reachedAt) return reachedAt.getTime() <= deadline ? 'met' : 'missed';
  if (now.getTime() > deadline) return 'overdue';
  if (deadline - now.getTime() <= 86_400_000) return 'soon';
  return 'pending';
}
