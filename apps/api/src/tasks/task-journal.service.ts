import { Injectable } from '@nestjs/common';
import type { BoardEventsQuery } from '@flowboard/shared';
import { randomUUID } from 'node:crypto';
import { Db } from '../database/db.service';
import type { Task, TaskEvent } from './task.entity';

export type Changes = TaskEvent['changes'];

/** Historique des révisions (spec § 4.9) : journal en écriture seule, base des rapports de flux. */
@Injectable()
export class TaskJournalService {
  constructor(private db: Db) {}

  event(
    boardId: string,
    taskId: string,
    actorId: string,
    type: TaskEvent['type'],
    changes: Changes,
  ): TaskEvent {
    return { _id: randomUUID(), boardId, taskId, actorId, type, changes, at: new Date() };
  }

  async log(boardId: string, taskId: string, actorId: string, type: TaskEvent['type'], changes: Changes) {
    await this.db.events.insertOne(this.event(boardId, taskId, actorId, type, changes));
  }

  async logMany(events: TaskEvent[]) {
    if (events.length) await this.db.events.insertMany(events);
  }

  /** Onglet « Historique » d'une tâche (spec § 4.9), du plus récent au plus ancien. */
  forTask(boardId: string, taskId: string) {
    return this.db.events.find({ boardId, taskId }).sort({ at: -1 }).limit(500).toArray();
  }

  /**
   * Journal du board, filtrable par type et auteur, paginé par date (`before`).
   * Le nom de chaque tâche est joint ; pour une tâche supprimée, on le reprend de l'événement de suppression.
   */
  async forBoard(boardId: string, q: BoardEventsQuery) {
    const events = await this.db.events
      .find({
        boardId,
        ...(q.type ? { type: q.type as TaskEvent['type'] } : {}),
        ...(q.actorId ? { actorId: q.actorId } : {}),
        ...(q.before ? { at: { $lt: q.before } } : {}),
      })
      .sort({ at: -1 })
      .limit(q.limit)
      .toArray();
    const taskIds = [...new Set(events.map((e) => e.taskId).filter((id): id is string => !!id))];
    const tasks = await this.db.tasks
      .find({ _id: { $in: taskIds } })
      .project<{ _id: string; name: string }>({ name: 1 })
      .toArray();
    const names = new Map(tasks.map((t) => [t._id, t.name]));
    for (const e of events)
      if (e.taskId && !names.has(e.taskId) && e.type === 'taskDeleted')
        names.set(e.taskId, String(e.changes.name?.old ?? ''));
    return { events, taskNames: Object.fromEntries(names) };
  }
}

/** Propriétés réellement modifiées, au format `{prop: {old, new}}`. */
export function diff(task: Task, patch: object): Changes {
  const out: Changes = {};
  for (const [key, value] of Object.entries(patch)) {
    if (
      value === undefined ||
      ['position', 'updatedAt', 'updatedById', 'dueReachedAt', 'dueNotified'].includes(key)
    )
      continue;
    const old = task[key as keyof Task];
    if (JSON.stringify(old) !== JSON.stringify(value)) out[key] = { old: old ?? null, new: value };
  }
  return out;
}
