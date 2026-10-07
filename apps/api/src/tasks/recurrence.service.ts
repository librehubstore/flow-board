import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { every } from '../common/periodic';
import { Db } from '../database/db.service';
import { nextOccurrence } from './recurrence';
import { TASK_COMPLETED, type Task, type TaskCompletedEvent } from './task.entity';
import { TasksService } from './tasks.service';

/**
 * Tâches récurrentes (spec § 4.4).
 * - « À la complétion » : l'occurrence suivante est créée dès que la tâche est terminée, masquée jusqu'à sa date.
 * - « À date fixe » : créée à la date prévue, même si la précédente n'est pas terminée (vérification toutes les 5 min).
 */
@Injectable()
export class RecurrenceService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    private db: Db,
    private tasks: TasksService,
  ) {}

  onApplicationBootstrap() {
    this.timer = every(5 * 60_000, RecurrenceService.name, () => this.spawnDue());
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }

  @OnEvent(TASK_COMPLETED)
  async onCompleted({ task, actorId }: TaskCompletedEvent) {
    const rec = task.recurrence!;
    if (rec.mode !== 'onCompletion' || rec.spawned || this.finished(task)) return;
    const now = new Date();
    const next = nextOccurrence(rec, rec.anchor, new Date(Math.max(rec.anchor.getTime(), now.getTime())));
    if (next) await this.tasks.spawnOccurrence(task, next, next, actorId);
  }

  /** Mode « date fixe » : crée les occurrences dont la date est arrivée. */
  async spawnDue(now = new Date()) {
    const due = await this.db.tasks
      .find({
        'recurrence.mode': 'fixedDate',
        'recurrence.spawned': false,
        'recurrence.nextAt': { $lte: now },
      })
      .toArray();
    for (const task of due) {
      if (this.finished(task)) continue;
      const at = task.recurrence!.nextAt!;
      await this.tasks.spawnOccurrence(task, at, at, task.updatedById);
    }
  }

  /** Fin « après N occurrences » : l'occurrence N n'en crée pas d'autre. */
  private finished(task: Task) {
    const rec = task.recurrence!;
    return rec.endType === 'count' && rec.endCount !== null && rec.index >= rec.endCount;
  }
}
