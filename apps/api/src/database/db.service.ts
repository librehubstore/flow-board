import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Collection, MongoClient } from 'mongodb';
import { config } from '../config/config';
import type { Attachment } from '../attachments/attachment.entity';
import type { AuditEntry } from '../audit/audit.entity';
import type { EmailToken, LoginAttempt, Session } from '../auth/session.entity';
import type { Board } from '../boards/board.entity';
import type { Comment } from '../comments/comment.entity';
import type { Notification } from '../notifications/notification.entity';
import type { Role } from '../roles/role.entity';
import type { Settings } from '../settings/settings.entity';
import type { Task, TaskEvent } from '../tasks/task.entity';
import type { TimeEntry, Timer } from '../time/time-entry.entity';
import type { User } from '../users/user.entity';

/**
 * Accès MongoDB (driver natif) : une collection typée par entité.
 * Chaque module n'écrit que dans ses propres collections ; les suppressions en cascade passent par des événements.
 */
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
  get emailTokens(): Collection<EmailToken> {
    return this.db.collection('emailTokens');
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

  get timeEntries(): Collection<TimeEntry> {
    return this.db.collection('timeEntries');
  }
  get timers(): Collection<Timer> {
    return this.db.collection('timers');
  }
  get roles(): Collection<Role> {
    return this.db.collection('roles');
  }

  ping() {
    return this.db.command({ ping: 1 });
  }

  async onModuleInit() {
    await this.client.connect();
    // Index créés au démarrage (idempotent) : tient lieu de migration tant que le schéma n'évolue pas.
    await Promise.all([
      this.users.createIndex({ username: 1 }, { unique: true }),
      // Email et compte Google uniques quand ils existent (les comptes admin peuvent ne pas avoir d'email).
      this.users.createIndex(
        { email: 1 },
        { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
      ),
      this.users.createIndex(
        { googleId: 1 },
        { unique: true, partialFilterExpression: { googleId: { $type: 'string' } } },
      ),
      this.emailTokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      this.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      this.sessions.createIndex({ userId: 1 }),
      this.loginAttempts.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      this.audit.createIndex({ at: -1 }),
      this.boards.createIndex({ 'members.userId': 1 }),
      this.tasks.createIndex({ boardId: 1, archivedAt: 1 }),
      this.tasks.createIndex({ boardId: 1, columnId: 1, swimlaneId: 1, position: 1 }),
      this.tasks.createIndex({ dueAt: 1, completedAt: 1, archivedAt: 1 }),
      this.events.createIndex({ boardId: 1, at: 1 }),
      this.events.createIndex({ taskId: 1, at: 1 }),
      this.comments.createIndex({ taskId: 1, createdAt: 1 }),
      this.attachments.createIndex({ taskId: 1 }),
      this.notifications.createIndex({ userId: 1, createdAt: -1 }),
      // Au plus un minuteur en cours par utilisateur, garanti par la base (double clic, deux appareils).
      this.timeEntries.createIndex(
        { userId: 1 },
        { unique: true, partialFilterExpression: { running: true }, name: 'one_running_per_user' },
      ),
      this.timeEntries.createIndex({ userId: 1, startAt: -1 }),
      this.timeEntries.createIndex({ 'parts.taskId': 1 }),
      this.timeEntries.createIndex({ 'parts.boardId': 1, startAt: -1 }),
    ]);
  }

  async onModuleDestroy() {
    await this.client.close();
  }
}
