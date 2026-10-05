import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Collection, MongoClient } from 'mongodb';
import type { BoardRole, Color, NotificationType } from '@flowboard/shared';
import { config } from './config';

export interface User {
  _id: string;
  username: string;
  fullName: string;
  email: string | null;
  passwordHash: string;
  globalRole: 'admin' | 'user';
  status: 'active' | 'disabled';
  mustChangePassword: boolean;
  locale: 'fr' | 'en' | null;
  timezone: string | null;
  theme: 'light' | 'dark' | 'system';
  collapsedColumns: string[];
  notificationPrefs?: Partial<Record<NotificationType, boolean>>;
  createdAt: Date;
  lastLoginAt: Date | null;
}
export type PublicUser = Omit<User, 'passwordHash'>;

export interface Session {
  _id: string; // sha256 du jeton du cookie
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  userAgent: string;
  ip: string;
}

export interface LoginAttempt {
  _id: string; // identifiant|ip
  count: number;
  expiresAt: Date;
}

export interface Settings {
  _id: 'instance';
  instanceName: string;
  defaultLocale: 'fr' | 'en';
  defaultTimezone: string;
  maxAttachmentMb: number;
}

export interface AuditEntry {
  _id: string;
  actorId: string;
  action: string;
  targetId: string | null;
  details: Record<string, unknown>;
  at: Date;
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
export interface Member {
  userId: string;
  role: BoardRole;
}
export interface Label {
  _id: string;
  name: string;
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
  colorLabels: Partial<Record<Color, string>>;
  createdAt: Date;
  deletedAt: Date | null;
}

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
  color: Color;
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
  commentsCount: number;
  attachmentsCount: number;
  dueNotified?: { soon?: boolean; overdue?: boolean };
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  updatedById: string;
}

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

export interface Comment {
  _id: string;
  boardId: string;
  taskId: string;
  authorId: string;
  text: string;
  createdAt: Date;
  updatedAt: Date | null;
}

export interface Attachment {
  _id: string;
  boardId: string;
  taskId: string;
  fileName: string;
  mimeType: string;
  size: number;
  storageKey: string;
  uploadedById: string;
  createdAt: Date;
}

export interface Notification {
  _id: string;
  userId: string;
  type: NotificationType;
  boardId: string;
  taskId: string;
  payload: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class Db implements OnModuleInit, OnModuleDestroy {
  readonly client = new MongoClient(config.MONGO_URL);
  private db = this.client.db();

  get users(): Collection<User> {
    return this.db.collection('users');
  }
  get sessions(): Collection<Session> {
    return this.db.collection('sessions');
  }
  get loginAttempts(): Collection<LoginAttempt> {
    return this.db.collection('loginAttempts');
  }
  get settings(): Collection<Settings> {
    return this.db.collection('settings');
  }
  get audit(): Collection<AuditEntry> {
    return this.db.collection('audit');
  }
  get boards(): Collection<Board> {
    return this.db.collection('boards');
  }
  get tasks(): Collection<Task> {
    return this.db.collection('tasks');
  }
  get events(): Collection<TaskEvent> {
    return this.db.collection('events');
  }
  get comments(): Collection<Comment> {
    return this.db.collection('comments');
  }
  get attachments(): Collection<Attachment> {
    return this.db.collection('attachments');
  }
  get notifications(): Collection<Notification> {
    return this.db.collection('notifications');
  }

  async onModuleInit() {
    await this.client.connect();
    // Index créés au démarrage (idempotent) : tient lieu de migration tant que le schéma n'évolue pas.
    await Promise.all([
      this.users.createIndex({ username: 1 }, { unique: true }),
      this.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      this.sessions.createIndex({ userId: 1 }),
      this.loginAttempts.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      this.audit.createIndex({ at: -1 }),
      this.boards.createIndex({ 'members.userId': 1 }),
      this.tasks.createIndex({ boardId: 1, archivedAt: 1 }),
      this.tasks.createIndex({ boardId: 1, columnId: 1, swimlaneId: 1, position: 1 }),
      this.events.createIndex({ boardId: 1, at: 1 }),
      this.events.createIndex({ taskId: 1, at: 1 }),
      this.comments.createIndex({ taskId: 1, createdAt: 1 }),
      this.attachments.createIndex({ taskId: 1 }),
      this.notifications.createIndex({ userId: 1, createdAt: -1 }),
      this.tasks.createIndex({ dueAt: 1, completedAt: 1, archivedAt: 1 }),
    ]);
  }

  async onModuleDestroy() {
    await this.client.close();
  }
}
