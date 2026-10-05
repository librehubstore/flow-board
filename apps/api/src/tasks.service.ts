import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config';
import type { Filter } from 'mongodb';
import type { CreateTaskInput, MoveTaskInput, UpdateTaskInput } from '@flowboard/shared';
import { Board, Db, PublicUser, Task, TaskEvent } from './db';
import { fail } from './errors';
import { NotificationsService } from './notifications.service';
import { Realtime } from './realtime.service';

const GAP = 1024;
type Changes = TaskEvent['changes'];

/**
 * Point de passage unique de toute mutation de tâche (plan § 2) :
 * contrôles → écriture → journal d'événements (base des rapports de flux) → diffusion temps réel → notifications.
 * La permission est vérifiée en amont par AccessGuard.
 */
@Injectable()
export class TasksService {
  constructor(
    private db: Db,
    private realtime: Realtime,
    private notifications: NotificationsService,
  ) {}

  private emit(task: Task) {
    this.realtime.toBoard(task.boardId, 'task', task);
    return task;
  }

  list(boardId: string, archived: boolean) {
    return this.db.tasks
      .find({ boardId, archivedAt: archived ? { $ne: null } : null })
      .sort(archived ? { archivedAt: -1 } : { position: 1 })
      .limit(archived ? 500 : 0)
      .toArray();
  }

  async get(board: Board, taskId: string) {
    const task = await this.db.tasks.findOne({ _id: taskId, boardId: board._id });
    if (!task) fail(404, 'NOT_FOUND');
    return task;
  }

  async create(board: Board, user: PublicUser, input: CreateTaskInput) {
    const columnId = input.columnId ?? board.columns[0]._id;
    const swimlaneId = this.cell(board, columnId, input.swimlaneId);
    const now = new Date();
    const task: Task = {
      _id: randomUUID(),
      boardId: board._id,
      columnId,
      swimlaneId,
      position: await this.position(board._id, columnId, swimlaneId, input.top ? 0 : undefined),
      name: input.name,
      description: '',
      color: 'yellow',
      responsibleUserId: null,
      collaboratorIds: [],
      labels: [],
      subtasks: [],
      pointsEstimate: null,
      secondsEstimate: null,
      dueAt: null,
      dueHasTime: false,
      dueTargetColumnId: null,
      dueReachedAt: null,
      completedAt: columnId === board.completionColumnId ? now : null,
      archivedAt: null,
      commentsCount: 0,
      attachmentsCount: 0,
      createdById: user._id,
      createdAt: now,
      updatedAt: now,
      updatedById: user._id,
    };
    await this.db.tasks.insertOne(task);
    await this.log(board._id, task._id, user._id, 'taskCreated', {
      name: { old: null, new: task.name },
      columnId: { old: null, new: columnId },
      swimlaneId: { old: null, new: swimlaneId },
    });
    return this.emit(task);
  }

  async update(board: Board, user: PublicUser, taskId: string, input: UpdateTaskInput) {
    const task = await this.get(board, taskId);
    const members = new Set(board.members.map((m) => m.userId));
    const isMember = (id: string | null | undefined) => !id || members.has(id);
    if (!isMember(input.responsibleUserId) || !(input.collaboratorIds ?? []).every(isMember))
      fail(400, 'NOT_A_MEMBER');
    if (input.subtasks && !input.subtasks.every((s) => isMember(s.assigneeId))) fail(400, 'NOT_A_MEMBER');
    if (input.labels && !input.labels.every((l) => board.labels.some((b) => b._id === l.id))) fail(400, 'UNKNOWN_LABEL');
    if (input.dueTargetColumnId && !board.columns.some((c) => c._id === input.dueTargetColumnId))
      fail(400, 'UNKNOWN_COLUMN');
    if (input.completedAt) {
      if (!task.completedAt) fail(400, 'NOT_COMPLETED');
      if (input.completedAt.getTime() > Date.now()) fail(400, 'COMPLETION_IN_FUTURE');
    }

    const set: Partial<Task> = { ...input, updatedAt: new Date(), updatedById: user._id };
    if (input.collaboratorIds) set.collaboratorIds = [...new Set(input.collaboratorIds)];
    // Changer la cible d'échéance recalcule si elle est déjà atteinte.
    if (input.dueTargetColumnId !== undefined) {
      const target = input.dueTargetColumnId;
      set.dueReachedAt = target && target === task.columnId ? new Date() : null;
    }
    if (input.dueAt !== undefined || input.dueHasTime !== undefined) set.dueNotified = {};
    const changes = diff(task, input);
    await this.db.tasks.updateOne({ _id: task._id }, { $set: set });
    if (Object.keys(changes).length) await this.log(board._id, task._id, user._id, 'taskChanged', changes);
    const updated = this.emit({ ...task, ...set });

    if (input.responsibleUserId && input.responsibleUserId !== task.responsibleUserId)
      await this.notifications.notify([input.responsibleUserId], 'assigned', updated, user._id);
    const before = new Map(task.subtasks.map((st) => [st._id, st.assigneeId]));
    const newlyAssigned = (input.subtasks ?? []).filter((st) => st.assigneeId && before.get(st._id) !== st.assigneeId);
    for (const st of newlyAssigned)
      await this.notifications.notify([st.assigneeId!], 'subtaskAssigned', updated, user._id, { subtask: st.name });
    return updated;
  }

  async move(board: Board, user: PublicUser, taskId: string, input: MoveTaskInput) {
    const task = await this.get(board, taskId);
    if (task.archivedAt) fail(400, 'ARCHIVED');
    const swimlaneId = this.cell(board, input.columnId, input.swimlaneId);
    const set: Partial<Task> = {
      columnId: input.columnId,
      swimlaneId,
      position: await this.position(board._id, input.columnId, swimlaneId, input.index, task._id),
      updatedAt: new Date(),
      updatedById: user._id,
      ...this.arrivalEffects(board, task, input.columnId),
    };
    await this.db.tasks.updateOne({ _id: task._id }, { $set: set });
    const changes = diff(task, { columnId: set.columnId, swimlaneId, completedAt: set.completedAt });
    if (Object.keys(changes).length) await this.log(board._id, task._id, user._id, 'taskMoved', changes);
    return this.emit({ ...task, ...set });
  }

  /** Effets d'une arrivée dans une colonne : complétion (spec § 4.2) et échéance atteinte (§ 4.3). */
  private arrivalEffects(board: Board, task: Task, columnId: string): Partial<Task> {
    const out: Partial<Task> = {};
    const now = new Date();
    if (columnId !== task.columnId) {
      if (columnId === board.completionColumnId) out.completedAt = now;
      else if (task.columnId === board.completionColumnId) out.completedAt = null;
    }
    if (task.dueTargetColumnId && columnId === task.dueTargetColumnId && !task.dueReachedAt) out.dueReachedAt = now;
    return out;
  }

  /**
   * Déplace toutes les tâches correspondant au filtre (suppression de colonne ou de swimlane).
   * Rejouable : en cas d'interruption, relancer l'opération termine le travail.
   */
  async relocate(board: Board, user: PublicUser, filter: Filter<Task>, columnId?: string, swimlaneId?: string | null) {
    const tasks = await this.db.tasks.find({ ...filter, boardId: board._id, archivedAt: null }).toArray();
    const events: TaskEvent[] = [];
    // ponytail: une requête par tâche ; acceptable pour une opération rare (suppression de colonne/swimlane).
    for (const t of tasks) {
      const col = columnId ?? t.columnId;
      const lane = swimlaneId === undefined ? t.swimlaneId : swimlaneId;
      const set: Partial<Task> = {
        columnId: col,
        swimlaneId: lane,
        position: await this.position(board._id, col, lane),
        ...this.arrivalEffects(board, t, col),
      };
      await this.db.tasks.updateOne({ _id: t._id }, { $set: set });
      events.push(this.event(board._id, t._id, user._id, 'taskMoved', diff(t, set)));
    }
    await this.db.events.insertMany(events);
  }

  async archive(board: Board, user: PublicUser, filter: Filter<Task>) {
    const tasks = await this.db.tasks.find({ ...filter, boardId: board._id, archivedAt: null }).toArray();
    if (!tasks.length) return 0;
    const now = new Date();
    await this.db.tasks.updateMany({ _id: { $in: tasks.map((t) => t._id) } }, { $set: { archivedAt: now } });
    await this.db.events.insertMany(
      tasks.map((t) => this.event(board._id, t._id, user._id, 'taskArchived', { archivedAt: { old: null, new: now } })),
    );
    this.realtime.toBoard(board._id, 'tasks.removed', tasks.map((t) => t._id));
    return tasks.length;
  }

  /** Restauration dans la colonne (et swimlane) d'origine, ou la première si elle n'existe plus. */
  async restore(board: Board, user: PublicUser, taskId: string) {
    const task = await this.get(board, taskId);
    if (!task.archivedAt) return task;
    const columnId = board.columns.some((c) => c._id === task.columnId) ? task.columnId : board.columns[0]._id;
    const swimlaneId = this.cell(board, columnId, board.swimlanes.some((s) => s._id === task.swimlaneId) ? task.swimlaneId : undefined);
    const set: Partial<Task> = {
      archivedAt: null,
      columnId,
      swimlaneId,
      position: await this.position(board._id, columnId, swimlaneId),
      ...this.arrivalEffects(board, task, columnId),
    };
    await this.db.tasks.updateOne({ _id: task._id }, { $set: set });
    await this.log(board._id, task._id, user._id, 'taskRestored', diff(task, set));
    return this.emit({ ...task, ...set });
  }

  async remove(board: Board, user: PublicUser, taskId: string) {
    const task = await this.get(board, taskId);
    await this.db.tasks.deleteOne({ _id: task._id });
    await this.purgeContent({ taskId: task._id });
    await this.log(board._id, task._id, user._id, 'taskDeleted', { name: { old: task.name, new: null } });
    this.realtime.toBoard(board._id, 'tasks.removed', [task._id]);
  }

  /** Supprime commentaires, pièces jointes (et fichiers) et notifications liés. */
  async purgeContent(filter: { taskId: string } | { boardId: string }) {
    const files = await this.db.attachments.find(filter).project<{ storageKey: string }>({ storageKey: 1 }).toArray();
    await Promise.all(files.map((f) => unlink(join(config.UPLOAD_DIR, f.storageKey)).catch(() => undefined)));
    await Promise.all([
      this.db.attachments.deleteMany(filter),
      this.db.comments.deleteMany(filter),
      this.db.notifications.deleteMany(filter),
    ]);
  }

  /** Valide la colonne et résout la swimlane : obligatoire si le board en a, sinon null. */
  private cell(board: Board, columnId: string, swimlaneId: string | null | undefined) {
    if (!board.columns.some((c) => c._id === columnId)) fail(400, 'UNKNOWN_COLUMN');
    if (!board.swimlanes.length) return null;
    if (!swimlaneId) return board.swimlanes[0]._id;
    if (!board.swimlanes.some((s) => s._id === swimlaneId)) fail(400, 'UNKNOWN_SWIMLANE');
    return swimlaneId;
  }

  /**
   * Position (flottant) pour insérer à `index` dans une cellule colonne × swimlane ; en fin si `index` absent.
   * ponytail: milieu de deux flottants ; si l'écart s'épuise (~50 insertions au même endroit) la cellule est renumérotée.
   */
  private async position(boardId: string, columnId: string, swimlaneId: string | null, index?: number, excludeId?: string) {
    const cell = await this.db.tasks
      .find({ boardId, columnId, swimlaneId, archivedAt: null, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })
      .sort({ position: 1 })
      .project<{ _id: string; position: number }>({ position: 1 })
      .toArray();
    const i = Math.min(index ?? cell.length, cell.length);
    const before = cell[i - 1]?.position;
    const after = cell[i]?.position;
    if (before === undefined) return after === undefined ? 0 : after - GAP;
    if (after === undefined) return before + GAP;
    if (after - before > 1e-6) return (before + after) / 2;
    await this.db.tasks.bulkWrite(
      cell.map((t, k) => ({ updateOne: { filter: { _id: t._id }, update: { $set: { position: (k < i ? k : k + 1) * GAP } } } })),
    );
    return i * GAP;
  }

  private event(boardId: string, taskId: string, actorId: string, type: TaskEvent['type'], changes: Changes): TaskEvent {
    return { _id: randomUUID(), boardId, taskId, actorId, type, changes, at: new Date() };
  }

  log(boardId: string, taskId: string, actorId: string, type: TaskEvent['type'], changes: Changes) {
    return this.db.events.insertOne(this.event(boardId, taskId, actorId, type, changes));
  }
}

/** Propriétés réellement modifiées, au format `{prop: {old, new}}` (spec § 4.9). */
function diff(task: Task, patch: object): Changes {
  const out: Changes = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || ['position', 'updatedAt', 'updatedById', 'dueReachedAt', 'dueNotified'].includes(key)) continue;
    const old = task[key as keyof Task];
    if (JSON.stringify(old) !== JSON.stringify(value)) out[key] = { old: old ?? null, new: value };
  }
  return out;
}
