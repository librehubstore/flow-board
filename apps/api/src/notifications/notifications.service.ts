import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import type { NotificationType } from '@flowboard/shared';
import { Db } from '../database/db.service';
import { Realtime } from '../realtime/realtime.service';
import {
  BOARD_PURGED,
  TASK_DELETED,
  type BoardPurgedEvent,
  type Task,
  type TaskDeletedEvent,
} from '../tasks/task.entity';
import type { Notification } from './notification.entity';

/** Notifications in-app (spec § 9) : stockées, poussées en temps réel, filtrées par les préférences. */
@Injectable()
export class NotificationsService {
  constructor(
    private db: Db,
    private realtime: Realtime,
  ) {}

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

  /** Tâche entrée dans une colonne : les membres du board qui la suivent sont notifiés (spec § 4.2, § 9). */
  async notifyColumnWatchers(
    board: { _id: string; members: { userId: string }[]; columns: { _id: string; name: string }[] },
    task: Pick<Task, '_id' | 'boardId' | 'name'>,
    columnId: string,
    actorId: string,
  ) {
    const watchers = await this.db.users
      .find({ watchedColumns: columnId, _id: { $in: board.members.map((m) => m.userId) } })
      .project<{ _id: string }>({ _id: 1 })
      .toArray();
    const column = board.columns.find((c) => c._id === columnId)?.name ?? '';
    await this.notify(
      watchers.map((w) => w._id),
      'columnEntered',
      task,
      actorId,
      { column },
    );
  }

  async list(userId: string) {
    const [items, unread] = await Promise.all([
      this.db.notifications.find({ userId }).sort({ createdAt: -1 }).limit(50).toArray(),
      this.db.notifications.countDocuments({ userId, readAt: null }),
    ]);
    return { items, unread };
  }

  async markRead(userId: string, ids?: string[]) {
    await this.db.notifications.updateMany(
      { userId, readAt: null, ...(ids ? { _id: { $in: ids } } : {}) },
      { $set: { readAt: new Date() } },
    );
  }

  @OnEvent(TASK_DELETED)
  async onTaskDeleted({ taskId }: TaskDeletedEvent) {
    await this.db.notifications.deleteMany({ taskId });
  }

  @OnEvent(BOARD_PURGED)
  async onBoardPurged({ boardId }: BoardPurgedEvent) {
    await this.db.notifications.deleteMany({ boardId });
  }
}
