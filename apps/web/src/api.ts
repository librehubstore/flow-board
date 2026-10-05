import { CSRF_HEADER, type BoardRole, type Color, type NotificationType, type Permission } from '@flowboard/shared';

// ---------- Formes JSON renvoyées par l'API ----------
export interface User {
  _id: string;
  username: string;
  fullName: string;
  email: string | null;
  globalRole: 'admin' | 'user';
  status: 'active' | 'disabled';
  mustChangePassword: boolean;
  locale: 'fr' | 'en' | null;
  timezone: string | null;
  theme: 'light' | 'dark' | 'system';
  collapsedColumns: string[];
  notificationPrefs?: Partial<Record<NotificationType, boolean>>;
  createdAt: string;
  lastLoginAt: string | null;
}
export interface Settings {
  instanceName: string;
  defaultLocale: 'fr' | 'en';
  defaultTimezone: string;
  maxAttachmentMb: number;
}
export interface Column {
  _id: string;
  name: string;
  description: string;
  wipLimit: number | null;
}
export interface Swimlane {
  _id: string;
  name: string;
  description: string;
}
export interface Label {
  _id: string;
  name: string;
}
export interface Board {
  _id: string;
  name: string;
  description: string;
  columns: Column[];
  swimlanes: Swimlane[];
  completionColumnId: string;
  members: { userId: string; role: BoardRole }[];
  labels: Label[];
  colorLabels: Partial<Record<Color, string>>;
  createdAt: string;
  deletedAt: string | null;
}
export interface Member {
  userId: string;
  role: BoardRole;
  username: string;
  fullName: string;
  status: 'active' | 'disabled';
}
export interface SubTask {
  _id: string;
  name: string;
  done: boolean;
  assigneeId: string | null;
  dueAt: string | null;
}
export interface Task {
  _id: string;
  boardId: string;
  columnId: string;
  swimlaneId: string | null;
  position: number;
  name: string;
  description: string;
  color: Color;
  responsibleUserId: string | null;
  collaboratorIds: string[];
  labels: { id: string; pinned: boolean }[];
  subtasks: SubTask[];
  pointsEstimate: number | null;
  secondsEstimate: number | null;
  dueAt: string | null;
  dueHasTime: boolean;
  dueTargetColumnId: string | null;
  dueReachedAt: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  commentsCount: number;
  attachmentsCount: number;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  updatedById: string;
}
export interface BoardPayload {
  board: Board;
  members: Member[];
  role: BoardRole | null;
  permissions: Permission[];
  tasks: Task[];
}
export interface Comment {
  _id: string;
  taskId: string;
  authorId: string;
  text: string;
  createdAt: string;
  updatedAt: string | null;
}
export interface Attachment {
  _id: string;
  taskId: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedById: string;
  createdAt: string;
}
export interface AppNotification {
  _id: string;
  type: NotificationType;
  boardId: string;
  taskId: string;
  payload: { taskName?: string; actorId?: string | null; subtask?: string; dueAt?: string };
  readAt: string | null;
  createdAt: string;
}
export interface DirectoryUser {
  _id: string;
  username: string;
  fullName: string;
  status: 'active' | 'disabled';
}

// ---------- Client HTTP ----------
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    credentials: 'same-origin',
    headers: {
      [CSRF_HEADER]: '1',
      ...(init.body === undefined || isForm ? {} : { 'content-type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : isForm ? (init.body as FormData) : JSON.stringify(init.body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.code ?? 'GENERIC', data.message ?? res.statusText);
  return data as T;
}

export const attachmentUrl = (boardId: string, id: string) => `/api/boards/${boardId}/attachments/${id}`;
