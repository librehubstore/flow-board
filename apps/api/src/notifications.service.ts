import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NotificationType } from '@flowboard/shared';
import { Db, Notification, Task } from './db';
import { Realtime } from './realtime.service';

const HOUR = 3_600_000;

/** Notifications in-app (spec § 9) : stockées, poussées en temps réel, filtrées par les préférences. */
@Injectable()
export class NotificationsService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    private db: Db,
    private realtime: Realtime,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.checkDueDates(), 10 * 60_000).unref();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Notifie chaque destinataire (sauf l'auteur de l'action) qui n'a pas désactivé ce type. */
  async notify(
    userIds: Iterable<string>,
    type: NotificationType,
    task: Pick<Task, '_id' | 'boardId' | 'name'>,
    actorId: string | null,
    payload: Record<string, unknown> = {},
  ) {
    const ids = [...new Set(userIds)].filter((id) => id && id !== actorId);
    if (!ids.length) return;
    const users = await this.db.users
      .find({ _id: { $in: ids }, status: 'active', [`notificationPrefs.${type}`]: { $ne: false } })
      .project<{ _id: string }>({ _id: 1 })
      .toArray();
    const now = new Date();
    const docs: Notification[] = users.map((u) => ({
      _id: randomUUID(),
      userId: u._id,
      type,
      boardId: task.boardId,
      taskId: task._id,
      payload: { taskName: task.name, actorId, ...payload },
      readAt: null,
      createdAt: now,
    }));
    if (!docs.length) return;
    await this.db.notifications.insertMany(docs);
    for (const n of docs) this.realtime.toUser(n.userId, 'notification', n);
  }

  async list(userId: string) {
    const [items, unread] = await Promise.all([
      this.db.notifications.find({ userId }).sort({ createdAt: -1 }).limit(50).toArray(),
      this.db.notifications.countDocuments({ userId, readAt: null }),
    ]);
    return { items, unread };
  }

  markRead(userId: string, ids?: string[]) {
    return this.db.notifications.updateMany(
      { userId, readAt: null, ...(ids ? { _id: { $in: ids } } : {}) },
      { $set: { readAt: new Date() } },
    );
  }

  /** Échéance à J-1 puis dépassée, une seule fois chacune, pour le responsable (spec § 9). */
  async checkDueDates(now = new Date()) {
    const open = { completedAt: null, archivedAt: null, responsibleUserId: { $ne: null }, dueAt: { $ne: null } };
    const soon = await this.db.tasks
      .find({ ...open, 'dueNotified.soon': { $ne: true }, dueAt: { $lte: new Date(now.getTime() + 24 * HOUR) } })
      .toArray();
    for (const t of soon) {
      if (deadline(t) < now.getTime()) continue; // traité comme dépassée ci-dessous
      await this.db.tasks.updateOne({ _id: t._id }, { $set: { 'dueNotified.soon': true } });
      await this.notify([t.responsibleUserId!], 'dueSoon', t, null, { dueAt: t.dueAt });
    }
    const overdue = await this.db.tasks
      .find({ ...open, 'dueNotified.overdue': { $ne: true }, dueAt: { $lte: now } })
      .toArray();
    for (const t of overdue) {
      if (deadline(t) >= now.getTime() || t.dueReachedAt) continue;
      await this.db.tasks.updateOne({ _id: t._id }, { $set: { 'dueNotified.soon': true, 'dueNotified.overdue': true } });
      await this.notify([t.responsibleUserId!], 'overdue', t, null, { dueAt: t.dueAt });
    }
  }
}

const deadline = (t: Task) => t.dueAt!.getTime() + (t.dueHasTime ? 0 : 24 * HOUR - 1);
