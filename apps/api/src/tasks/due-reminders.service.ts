import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { every } from '../common/periodic';
import { Db } from '../database/db.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { Task } from './task.entity';

const HOUR = 3_600_000;
const deadline = (t: Task) => t.dueAt!.getTime() + (t.dueHasTime ? 0 : 24 * HOUR - 1);

/** Rappels d'échéance (spec § 9) : J-1 puis dépassée, une seule fois chacun, pour le responsable. */
@Injectable()
export class DueRemindersService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    private db: Db,
    private notifications: NotificationsService,
  ) {}

  onApplicationBootstrap() {
    this.timer = every(10 * 60_000, DueRemindersService.name, () => this.check());
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async check(now = new Date()) {
    const open = {
      completedAt: null,
      archivedAt: null,
      responsibleUserId: { $ne: null },
      dueAt: { $ne: null },
    };
    const soon = await this.db.tasks
      .find({
        ...open,
        'dueNotified.soon': { $ne: true },
        dueAt: { $lte: new Date(now.getTime() + 24 * HOUR) },
      })
      .toArray();
    for (const t of soon) {
      if (deadline(t) < now.getTime()) continue; // traitée comme dépassée ci-dessous
      await this.db.tasks.updateOne({ _id: t._id }, { $set: { 'dueNotified.soon': true } });
      await this.notifications.notify([t.responsibleUserId!], 'dueSoon', t, null, { dueAt: t.dueAt });
    }
    const overdue = await this.db.tasks
      .find({ ...open, 'dueNotified.overdue': { $ne: true }, dueAt: { $lte: now } })
      .toArray();
    for (const t of overdue) {
      if (deadline(t) >= now.getTime() || t.dueReachedAt) continue;
      await this.db.tasks.updateOne(
        { _id: t._id },
        { $set: { 'dueNotified.soon': true, 'dueNotified.overdue': true } },
      );
      await this.notifications.notify([t.responsibleUserId!], 'overdue', t, null, { dueAt: t.dueAt });
    }
  }
}
