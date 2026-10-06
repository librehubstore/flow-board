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
export type BuiltInRole = (typeof BOARD_ROLES)[number];
/** Rôle d'un membre : rôle prédéfini, ou identifiant d'un rôle personnalisé défini par l'admin (spec § 4.10). */
export type BoardRole = BuiltInRole | (string & {});
export const isBuiltInRole = (r: string): r is BuiltInRole => (BOARD_ROLES as readonly string[]).includes(r);

export const ROLE_PERMISSIONS: Record<BuiltInRole, readonly Permission[]> = {
  owner: PERMISSIONS,
  editor: [
    'board.view',
    'task.create',
    'task.edit',
    'task.move',
    'task.delete',
    'comment',
    'time.track',
    'reports.view',
  ],
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
/** Couleur de tâche : une couleur de la palette, ou une couleur personnalisée du board (`#rrggbb`). */
export type TaskColor = Color | (string & {});
export const HEX_COLOR = /^#[0-9a-f]{6}$/;
export const isHexColor = (c: string) => HEX_COLOR.test(c);
const taskColor = z.union([z.enum(COLORS), z.string().toLowerCase().regex(HEX_COLOR)]);

/** WIP en pomodoros (spec § 4.2) : estimation en temps convertie en pomodoros standard de 25 min, arrondie au supérieur. */
export const estimatedPomodoros = (secondsEstimate: number | null | undefined) =>
  secondsEstimate ? Math.ceil(secondsEstimate / 1500) : 0;

/** Référence lisible d'une tâche numérotée (ex. `OPS-12`). */
export const taskRef = (prefix: string, n: number | null | undefined) => (n ? `${prefix}${n}` : '');

// ---------- Notifications (spec § 9) ----------
export const NOTIFICATION_TYPES = [
  'assigned',
  'subtaskAssigned',
  'mentioned',
  'commented',
  'dueSoon',
  'overdue',
  'columnEntered',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Identifiants mentionnés (`@identifiant`) dans un texte. */
export function mentions(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(/(?:^|[^\w@])@([a-z0-9._-]{3,50})/gi)].map((m) =>
        m[1].toLowerCase().replace(/\.+$/, ''),
      ),
    ),
  ];
}

// ---------- Pomodoro (spec § 4.6) ----------
export const INTERRUPTION_REASONS = ['internal', 'external', 'meeting', 'other'] as const;
// Sans `.default()` : un `.partial()` zod 4 réappliquerait les défauts et écraserait les réglages non envoyés.
export const PomodoroSettings = z.object({
  enabled: z.boolean(),
  workMinutes: z.number().int().min(1).max(180),
  shortBreakMinutes: z.number().int().min(1).max(60),
  longBreakMinutes: z.number().int().min(1).max(120),
  longBreakEvery: z.number().int().min(1).max(12),
  sound: z.boolean(),
  notify: z.boolean(),
});
export type PomodoroSettings = z.infer<typeof PomodoroSettings>;
export const DEFAULT_POMODORO: PomodoroSettings = {
  enabled: true,
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  sound: true,
  notify: true,
};

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

/** Identifiant de connexion : nom d'utilisateur, ou email (comptes créés par inscription). */
export const LoginInput = z.object({
  username: z.string().trim().toLowerCase().max(200),
  password: z.string().max(200),
});
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
  pomodoro: PomodoroSettings.partial().optional(),
});
export const CollapseColumnInput = z.object({ columnId: id, collapsed: z.boolean() });
// ---------- Onboarding ----------
/** `admin` : comptes créés uniquement par un administrateur (défaut). `open` : inscription en libre-service. */
export const ONBOARDING_MODES = ['admin', 'open'] as const;
export type OnboardingMode = (typeof ONBOARDING_MODES)[number];
const domain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/);

export const UpdateSettingsInput = z.object({
  instanceName: z.string().trim().min(1).max(100).optional(),
  defaultLocale: z.enum(LOCALES).optional(),
  defaultTimezone: z.string().max(64).optional(),
  maxAttachmentMb: z.number().int().min(1).max(1024).optional(),
  onboarding: z.enum(ONBOARDING_MODES).optional(),
  /** Méthodes d'inscription et de connexion proposées en mode `open` (Google : aussi pour les comptes existants). */
  registration: z.object({ password: z.boolean(), google: z.boolean() }).optional(),
  /** Domaines email autorisés à s'inscrire (vide = tous). */
  allowedDomains: z.array(domain).max(50).optional(),
});

export const RegisterInput = z.object({
  email: z.email().trim().toLowerCase().max(200),
  fullName: z.string().trim().min(1).max(100),
  password,
});
export const VerifyEmailInput = z.object({ token: z.string().min(20).max(200) });
export const ResendVerificationInput = z.object({ email: z.email().trim().toLowerCase().max(200) });
export type RegisterInput = z.infer<typeof RegisterInput>;

/** Domaine d'un email autorisé par la liste (vide = tous). */
export const isDomainAllowed = (email: string, allowed: readonly string[]) =>
  !allowed.length || allowed.includes(email.split('@')[1]?.toLowerCase() ?? '');

const name = z.string().trim().min(1).max(255);
const description = z.string().max(20000);
export const CreateBoardInput = z.object({
  name,
  description: description.default(''),
  /** Création à partir d'un modèle de board : structure copiée, sans les tâches. */
  templateId: id.optional(),
});
export const UpdateBoardInput = z.object({
  name: name.optional(),
  description: description.optional(),
  completionColumnId: id.optional(),
  colorLabels: z.record(taskColor, z.string().trim().max(50)).optional(),
  customColors: z.array(z.string().toLowerCase().regex(HEX_COLOR)).max(20).optional(),
  taskNumbering: z.object({ enabled: z.boolean(), prefix: z.string().trim().max(10) }).optional(),
  isTemplate: z.boolean().optional(),
});
export const CopyBoardInput = z.object({ name, withTasks: z.boolean().default(false) });

export const CUSTOM_FIELD_TYPES = ['text', 'number', 'dropdown'] as const;
export const CustomFieldInput = z.object({
  name: z.string().trim().min(1).max(50),
  type: z.enum(CUSTOM_FIELD_TYPES),
  numberPrefix: z.string().max(5).default(''),
  numberSuffix: z.string().max(10).default(''),
  /** Liste déroulante : options existantes gardent leur `_id`, les nouvelles n'en ont pas. */
  options: z
    .array(z.object({ _id: id.optional(), label: z.string().trim().min(1).max(50) }))
    .max(50)
    .default([]),
  showOnCard: z.boolean().default(false),
});
export const WatchColumnInput = z.object({ columnId: id, watched: z.boolean() });
export const BoardEventsQuery = z.object({
  type: z.string().max(40).optional(),
  actorId: id.optional(),
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export const CustomRoleInput = z
  .object({ name: z.string().trim().min(1).max(50), permissions: z.array(z.enum(PERMISSIONS)).min(1) })
  .refine((r) => r.permissions.includes('board.view'), { message: 'board.view requis' });
export const DeleteBoardInput = z.object({ confirmName: z.string() });
export const ColumnInput = z.object({
  name: name.optional(),
  description: description.optional(),
  wipLimit: z.number().int().min(1).nullable().optional(),
  wipUnit: z.enum(['tasks', 'pomodoros']).optional(),
});
export const CreateColumnInput = ColumnInput.extend({ name });
export const SwimlaneInput = z.object({ name: name.optional(), description: description.optional() });
export const CreateSwimlaneInput = SwimlaneInput.extend({ name });
export const ReorderInput = z.object({ ids: z.array(id).min(1) });
export const DeleteWithDestinationInput = z.object({ destinationId: id.optional() });
export const MemberInput = z.object({ userId: id, role: id });
export const RoleInput = z.object({ role: id });
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
// ---------- Récurrence (spec § 4.4) ----------
export const RECURRENCE_FREQS = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'] as const;
export const RecurrenceInput = z.object({
  freq: z.enum(RECURRENCE_FREQS),
  interval: z.number().int().min(1).max(99).default(1),
  /** Hebdomadaire : jours choisis, 0 = lundi … 6 = dimanche (vide = jour de l'ancre). */
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  /** Mensuelle : même jour du mois, ou « n-ième jour de semaine » (ex. 2e mardi). */
  monthlyBy: z.enum(['day', 'nth']).default('day'),
  mode: z.enum(['onCompletion', 'fixedDate']).default('onCompletion'),
  startColumnId: id.nullable().default(null),
  endType: z.enum(['never', 'count', 'until']).default('never'),
  endCount: z.number().int().min(1).max(999).nullable().default(null),
  endUntil: z.coerce.date().nullable().default(null),
});
export type RecurrenceInput = z.infer<typeof RecurrenceInput>;

export const UpdateTaskInput = z.object({
  name: name.optional(),
  description: description.optional(),
  color: taskColor.optional(),
  /** Valeurs des champs personnalisés : texte, nombre, ou identifiant d'option ; null efface. */
  customFields: z.record(id, z.union([z.string().max(2000), z.number(), z.null()])).optional(),
  responsibleUserId: id.nullable().optional(),
  collaboratorIds: z.array(id).max(100).optional(),
  labels: z
    .array(z.object({ id, pinned: z.boolean() }))
    .max(50)
    .optional(),
  subtasks: z.array(subtask).max(200).optional(),
  pointsEstimate: z.number().min(0).nullable().optional(),
  secondsEstimate: z.number().int().min(0).nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  dueHasTime: z.boolean().optional(),
  dueTargetColumnId: id.nullable().optional(),
  completedAt: z.coerce.date().optional(),
  recurrence: RecurrenceInput.nullable().optional(),
});
/** Duplication : nom de la copie (traduit par le client) ; défaut « <nom> (copie) ». */
export const DuplicateTaskInput = z.object({ name: name.optional() });
export type DuplicateTaskInput = z.infer<typeof DuplicateTaskInput>;
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
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
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

// ---------- Gestion du temps (spec § 4.6) ----------
export const StartTimerInput = z.object({ kind: z.enum(['pomodoro', 'stopwatch']), taskId: id });
export const SwitchTaskInput = z.object({ taskId: id });
export const InterruptInput = z.object({
  reason: z.enum(INTERRUPTION_REASONS),
  comment: z.string().trim().max(200).default(''),
});
const timeLabels = z.array(z.string().trim().min(1).max(30)).max(10).default([]);
export const ManualTimeInput = z
  .object({
    taskId: id,
    startAt: z.coerce.date(),
    endAt: z.coerce.date().nullable().default(null),
    durationSeconds: z.number().int().min(60).max(86_400).nullable().default(null),
    comment: z.string().trim().max(200).default(''),
    timeLabels,
  })
  .refine((v) => v.endAt || v.durationSeconds, { message: 'endAt ou durationSeconds requis' });
export const UpdateTimeEntryInput = z.object({
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().optional(),
  comment: z.string().trim().max(200).optional(),
  timeLabels: timeLabels.optional(),
});
export type StartTimerInput = z.infer<typeof StartTimerInput>;
export type SwitchTaskInput = z.infer<typeof SwitchTaskInput>;
export type InterruptInput = z.infer<typeof InterruptInput>;
export type ManualTimeInput = z.infer<typeof ManualTimeInput>;
export type UpdateTimeEntryInput = z.infer<typeof UpdateTimeEntryInput>;
export type CopyBoardInput = z.infer<typeof CopyBoardInput>;
export type CustomFieldInput = z.infer<typeof CustomFieldInput>;
export type WatchColumnInput = z.infer<typeof WatchColumnInput>;
export type BoardEventsQuery = z.infer<typeof BoardEventsQuery>;
export type CustomRoleInput = z.infer<typeof CustomRoleInput>;

// ---------- Rapport de temps (spec § 4.7) ----------
export const TIME_GROUPS = ['user', 'task', 'board', 'label', 'day', 'week'] as const;
const csvList = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').filter(Boolean).slice(0, 200) : []));
/** Paramètres d'URL du rapport (listes séparées par des virgules, utilisables dans un lien d'export). */
export const TimeReportQuery = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    users: csvList,
    boards: csvList,
    labels: csvList,
    groupBy: z.enum(TIME_GROUPS).default('user'),
    timeZone: z.string().max(64).default('UTC'),
    format: z.enum(['json', 'csv']).default('json'),
  })
  .refine((q) => q.to > q.from, { message: 'to doit être après from' });
export type TimeReportQuery = z.infer<typeof TimeReportQuery>;
export interface TimeReportRow {
  key: string;
  label: string;
  seconds: number;
}

// ---------- Recherche et filtres (spec § 4.5) ----------

/** Texte normalisé pour la recherche : minuscules, sans accents. */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export const DUE_FILTERS = ['overdue', 'today', 'week', 'none'] as const;
export const BoardFilter = z.object({
  /** `me`, `none` (non assignée) ou identifiants de membres. */
  responsible: z.array(z.string().max(64)).max(100).default([]),
  labels: z.array(id).max(100).default([]),
  colors: z.array(taskColor).max(30).default([]),
  /** Champs « liste déroulante » : options retenues par champ (OU au sein d'un champ, ET entre champs). */
  fields: z.record(id, z.array(id).max(50)).default({}),
  due: z.array(z.enum(DUE_FILTERS)).max(4).default([]),
  text: z.string().max(200).default(''),
});
export type BoardFilter = z.infer<typeof BoardFilter>;
export const EMPTY_FILTER: BoardFilter = {
  responsible: [],
  labels: [],
  colors: [],
  due: [],
  text: '',
  fields: {},
};

export const isFilterActive = (f: BoardFilter) =>
  !!(
    f.responsible.length ||
    f.labels.length ||
    f.colors.length ||
    f.due.length ||
    f.text.trim() ||
    Object.values(f.fields ?? {}).some((v) => v.length)
  );

/** Champs d'une tâche utiles au filtre (formes JSON : dates en chaînes ISO). */
export interface FilterableTask {
  name: string;
  description: string;
  color: TaskColor;
  responsibleUserId: string | null;
  labels: { id: string }[];
  dueAt: string | null;
  dueHasTime: boolean;
  completedAt: string | null;
  number?: number | null;
  customFields?: Record<string, string | number | null>;
}

/**
 * Filtre de board : ET entre critères, OU au sein d'un critère (spec § 4.5).
 * `labelNames` sert à la recherche texte sur les labels ; « cette semaine » = du lundi au dimanche, dans le fuseau.
 */
export function matchesFilter(
  task: FilterableTask,
  f: BoardFilter,
  ctx: { me: string; now: Date; timeZone?: string; labelNames: Map<string, string>; taskPrefix?: string },
): boolean {
  const any = <T>(values: T[], test: (v: T) => boolean) => !values.length || values.some(test);
  const responsibleOk = any(f.responsible, (r) =>
    r === 'none' ? !task.responsibleUserId : task.responsibleUserId === (r === 'me' ? ctx.me : r),
  );
  const labelsOk = any(f.labels, (l) => task.labels.some((x) => x.id === l));
  const colorsOk = any(f.colors, (c) => task.color === c);
  const dueOk = any(f.due, (d) => {
    if (d === 'none') return !task.dueAt;
    if (!task.dueAt) return false;
    const due = new Date(task.dueAt);
    if (d === 'overdue')
      return !task.completedAt && dueStatus(due, task.dueHasTime, null, ctx.now) === 'overdue';
    const key = dayKey(due, task.dueHasTime ? ctx.timeZone : 'UTC');
    const today = dayKey(ctx.now, ctx.timeZone);
    if (d === 'today') return key === today;
    const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
    const monday = dayKey(new Date(Date.parse(`${today}T12:00:00Z`) - weekday * 86_400_000), 'UTC');
    const sunday = dayKey(new Date(Date.parse(`${monday}T12:00:00Z`) + 6 * 86_400_000), 'UTC');
    return key >= monday && key <= sunday;
  });
  const words = normalize(f.text).split(/\s+/).filter(Boolean);
  const haystack = words.length
    ? normalize(
        [
          task.name,
          task.description,
          taskRef(ctx.taskPrefix ?? '', task.number),
          ...task.labels.map((l) => ctx.labelNames.get(l.id) ?? ''),
          ...Object.values(task.customFields ?? {}).map((v) => String(v ?? '')),
        ].join(' '),
      )
    : '';
  const textOk = words.every((w) => haystack.includes(w));
  const fieldsOk = Object.entries(f.fields ?? {}).every(
    ([fieldId, options]) => !options.length || options.includes(String(task.customFields?.[fieldId] ?? '')),
  );
  return responsibleOk && labelsOk && colorsOk && dueOk && textOk && fieldsOk;
}
