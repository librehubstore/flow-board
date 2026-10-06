import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import type { Filter } from 'mongodb';
import {
  COLORS,
  normalize,
  taskRef,
  type CreateTaskInput,
  type MoveTaskInput,
  type RecurrenceInput,
  type UpdateTaskInput,
} from '@flowboard/shared';
import type { Board } from '../boards/board.entity';
import { fail } from '../common/errors';
import { Db } from '../database/db.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Realtime } from '../realtime/realtime.service';
import type { PublicUser } from '../users/user.entity';
import {
  TASK_COMPLETED,
  TASK_DELETED,
  type Recurrence,
  type Task,
  type TaskCompletedEvent,
  type TaskDeletedEvent,
  type TaskEvent,
} from './task.entity';
import { nextOccurrence, startOfDayUtc } from './recurrence';
import { diff, TaskJournalService } from './task-journal.service';

const GAP = 1024;

/**
 * Point de passage unique de toute mutation de tâche :
 * contrôles → écriture → journal (base des rapports de flux) → diffusion temps réel → notifications.
 * La permission est vérifiée en amont par AccessGuard.
 */
@Injectable()
export class TasksService {
  constructor(
    private db: Db,
    private journal: TaskJournalService,
    private realtime: Realtime,
    private notifications: NotificationsService,
    private events: EventEmitter2,
  ) {}

  /** Diffuse la tâche aux membres connectés ; le texte de recherche dénormalisé reste côté serveur. */
  private emit(full: Task) {
    const { searchText: _, ...task } = full;
    this.realtime.toBoard(task.boardId, 'task', task);
    return task;
  }

  /** Recalcule le texte de recherche : nom, description, sous-tâches, labels et commentaires. */
  async refreshSearch(taskId: string) {
    const task = await this.db.tasks.findOne({ _id: taskId });
    if (!task) return;
    const board = await this.db.boards.findOne(
      { _id: task.boardId },
      { projection: { labels: 1, taskNumbering: 1, customFields: 1 } },
    );
    const comments = await this.db.comments.find({ taskId }).project<{ text: string }>({ text: 1 }).toArray();
    const labels = task.labels.map((l) => board?.labels.find((b) => b._id === l.id)?.name ?? '');
    const text = [
      task.name,
      task.description,
      ...task.subtasks.map((s) => s.name),
      ...labels,
      ...comments.map((c) => c.text),
      taskRef(board?.taskNumbering?.prefix ?? '', task.number),
      ...Object.entries(task.customFields ?? {}).map(([fid, v]) => {
        const field = board?.customFields?.find((f) => f._id === fid);
        return field?.type === 'dropdown'
          ? (field.options.find((o) => o._id === v)?.label ?? '')
          : String(v ?? '');
      }),
    ];
    await this.db.tasks.updateOne({ _id: taskId }, { $set: { searchText: normalize(text.join(' ')) } });
  }

  list(boardId: string, archived: boolean) {
    return this.db.tasks
      .find({ boardId, archivedAt: archived ? { $ne: null } : null }, { projection: { searchText: 0 } })
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
      number: await this.nextNumber(board),
      commentsCount: 0,
      attachmentsCount: 0,
      createdById: user._id,
      createdAt: now,
      updatedAt: now,
      updatedById: user._id,
    };
    await this.db.tasks.insertOne(task);
    await this.refreshSearch(task._id);
    await this.journal.log(board._id, task._id, user._id, 'taskCreated', {
      name: { old: null, new: task.name },
      columnId: { old: null, new: columnId },
      swimlaneId: { old: null, new: swimlaneId },
    });
    await this.notifications.notifyColumnWatchers(board, task, columnId, user._id);
    return this.emit(task);
  }

  /**
   * Numéro suivant si la numérotation est active : compteur atomique sur le board, jamais réutilisé.
   * Exception assumée à « chaque module écrit ses collections » : le compteur doit vivre sur le board pour être atomique.
   */
  private async nextNumber(board: Board): Promise<number | null> {
    if (!board.taskNumbering?.enabled) return null;
    const b = await this.db.boards.findOneAndUpdate(
      { _id: board._id },
      { $inc: { taskCounter: 1 } },
      { returnDocument: 'after', projection: { taskCounter: 1 } },
    );
    return b?.taskCounter ?? null;
  }

  /** À l'activation de la numérotation : les tâches existantes sans numéro en reçoivent un, par ordre de création. */
  async numberExisting(boardId: string) {
    const board = (await this.db.boards.findOne({ _id: boardId }))!;
    const tasks = await this.db.tasks
      .find({ boardId, number: null }) // null couvre aussi « champ absent »
      .project<{ _id: string }>({ _id: 1 })
      .sort({ createdAt: 1 })
      .toArray();
    for (const t of tasks) {
      await this.db.tasks.updateOne({ _id: t._id }, { $set: { number: await this.nextNumber(board) } });
      await this.refreshSearch(t._id);
    }
  }

  /** Champ (ou options) supprimé : les valeurs concernées disparaissent des tâches. */
  async unsetCustomField(boardId: string, fieldId: string, values?: string[]) {
    const path = `customFields.${fieldId}`;
    await this.db.tasks.updateMany(
      { boardId, ...(values ? { [path]: { $in: values } } : {}) },
      { $unset: { [path]: '' } },
    );
  }

  /** Couleur personnalisée retirée du board : les tâches concernées reviennent au jaune. */
  async resetColors(boardId: string, colors: string[]) {
    if (colors.length)
      await this.db.tasks.updateMany({ boardId, color: { $in: colors } }, { $set: { color: 'yellow' } });
  }

  /**
   * Copie les tâches non archivées d'un board vers sa copie (identifiants remappés).
   * Commentaires, pièces jointes, temps et historique ne sont pas copiés.
   */
  async copyTasks(source: Board, target: Board, ids: Map<string, string>, actorId: string) {
    const tasks = await this.db.tasks.find({ boardId: source._id, archivedAt: null }).toArray();
    const now = new Date();
    const copies: Task[] = tasks.map((t) => ({
      ...t,
      _id: randomUUID(),
      boardId: target._id,
      columnId: ids.get(t.columnId)!,
      swimlaneId: t.swimlaneId ? (ids.get(t.swimlaneId) ?? null) : null,
      dueTargetColumnId: t.dueTargetColumnId ? (ids.get(t.dueTargetColumnId) ?? null) : null,
      responsibleUserId: t.responsibleUserId === actorId ? actorId : null,
      collaboratorIds: [],
      labels: t.labels.map((l) => ({ ...l, id: ids.get(l.id)! })),
      subtasks: t.subtasks.map((s) => ({ ...s, _id: randomUUID(), assigneeId: null })),
      customFields: Object.fromEntries(
        Object.entries(t.customFields ?? {}).map(([fid, v]) => [
          ids.get(fid)!,
          typeof v === 'string' ? (ids.get(v) ?? v) : v,
        ]),
      ),
      recurrence: t.recurrence
        ? {
            ...t.recurrence,
            spawned: false,
            startColumnId: t.recurrence.startColumnId ? (ids.get(t.recurrence.startColumnId) ?? null) : null,
          }
        : t.recurrence,
      commentsCount: 0,
      attachmentsCount: 0,
      spentSeconds: 0,
      createdById: actorId,
      createdAt: now,
      updatedAt: now,
      updatedById: actorId,
    }));
    if (!copies.length) return;
    await this.db.tasks.insertMany(copies);
    for (const c of copies) await this.refreshSearch(c._id);
  }

  /**
   * Duplique une tâche juste sous l'originale (menu contextuel de la carte) : contenu, labels, estimations, champs,
   * sous-tâches décochées. Pas de commentaires, pièces jointes, temps passé ni récurrence ; nouveau numéro.
   */
  async duplicate(board: Board, user: PublicUser, taskId: string, name?: string) {
    const source = await this.get(board, taskId);
    if (source.archivedAt) fail(400, 'ARCHIVED');
    const cell = await this.db.tasks
      .find({
        boardId: board._id,
        columnId: source.columnId,
        swimlaneId: source.swimlaneId,
        archivedAt: null,
      })
      .sort({ position: 1 })
      .project<{ _id: string }>({ _id: 1 })
      .toArray();
    const index = cell.findIndex((t) => t._id === source._id) + 1;
    const now = new Date();
    const { searchText: _, ...rest } = source;
    const task: Task = {
      ...rest,
      _id: randomUUID(),
      name: name ?? `${source.name} (copie)`.slice(0, 255),
      position: await this.position(board._id, source.columnId, source.swimlaneId, index),
      subtasks: source.subtasks.map((st) => ({ ...st, _id: randomUUID(), done: false })),
      number: await this.nextNumber(board),
      completedAt: source.columnId === board.completionColumnId ? now : null,
      dueReachedAt: null,
      dueNotified: {},
      recurrence: null,
      startAt: null,
      commentsCount: 0,
      attachmentsCount: 0,
      spentSeconds: 0,
      createdById: user._id,
      createdAt: now,
      updatedAt: now,
      updatedById: user._id,
    };
    await this.db.tasks.insertOne(task);
    await this.refreshSearch(task._id);
    await this.journal.log(board._id, task._id, user._id, 'taskCreated', {
      name: { old: null, new: task.name },
      duplicatedFrom: { old: null, new: source._id },
    });
    return this.emit(task);
  }

  /** Une tâche récurrente vient d'être terminée : RecurrenceService prépare l'occurrence suivante. */
  private async completed(before: Task, after: Task, actorId: string) {
    if (!before.completedAt && after.completedAt && after.recurrence)
      await this.events.emitAsync(TASK_COMPLETED, { task: after, actorId } satisfies TaskCompletedEvent);
  }

  async update(board: Board, user: PublicUser, taskId: string, input: UpdateTaskInput) {
    const task = await this.get(board, taskId);
    const members = new Set(board.members.map((m) => m.userId));
    const isMember = (id: string | null | undefined) => !id || members.has(id);
    if (!isMember(input.responsibleUserId) || !(input.collaboratorIds ?? []).every(isMember))
      fail(400, 'NOT_A_MEMBER');
    if (input.subtasks && !input.subtasks.every((s) => isMember(s.assigneeId))) fail(400, 'NOT_A_MEMBER');
    if (input.labels && !input.labels.every((l) => board.labels.some((b) => b._id === l.id)))
      fail(400, 'UNKNOWN_LABEL');
    if (input.dueTargetColumnId && !board.columns.some((c) => c._id === input.dueTargetColumnId))
      fail(400, 'UNKNOWN_COLUMN');
    if (
      input.color &&
      !(COLORS as readonly string[]).includes(input.color) &&
      !board.customColors?.includes(input.color)
    )
      fail(400, 'UNKNOWN_COLOR');
    if (input.completedAt) {
      if (!task.completedAt) fail(400, 'NOT_COMPLETED');
      if (input.completedAt.getTime() > Date.now()) fail(400, 'COMPLETION_IN_FUTURE');
    }

    const { recurrence, customFields, ...fields } = input;
    const set: Partial<Task> = { ...fields, updatedAt: new Date(), updatedById: user._id };
    const custom = customFields ? this.customFieldsUpdate(board, customFields) : null;
    if (input.collaboratorIds) set.collaboratorIds = [...new Set(input.collaboratorIds)];
    // Changer la cible d'échéance recalcule si elle est déjà atteinte.
    if (input.dueTargetColumnId !== undefined) {
      const target = input.dueTargetColumnId;
      set.dueReachedAt = target && target === task.columnId ? new Date() : null;
    }
    if (input.dueAt !== undefined || input.dueHasTime !== undefined) set.dueNotified = {};
    // Ancre calculée sur la tâche à jour : échéance et récurrence peuvent arriver dans la même requête.
    if (recurrence !== undefined) set.recurrence = this.recurrenceFor(board, { ...task, ...set }, recurrence);
    const changes = diff(task, fields);
    if (recurrence !== undefined) Object.assign(changes, diff(task, { recurrence }));
    for (const [fid, v] of Object.entries(customFields ?? {}))
      if ((task.customFields?.[fid] ?? null) !== v)
        changes[`customFields.${fid}`] = { old: task.customFields?.[fid] ?? null, new: v };
    await this.db.tasks.updateOne(
      { _id: task._id },
      {
        $set: { ...set, ...custom?.set },
        ...(custom && Object.keys(custom.unset).length ? { $unset: custom.unset } : {}),
      },
    );
    if (custom) set.customFields = custom.merged(task.customFields);
    if (Object.keys(changes).length)
      await this.journal.log(board._id, task._id, user._id, 'taskChanged', changes);
    if (input.name || input.description !== undefined || input.subtasks || input.labels || customFields)
      await this.refreshSearch(task._id);
    const updated = this.emit({ ...task, ...set });

    if (input.responsibleUserId && input.responsibleUserId !== task.responsibleUserId)
      await this.notifications.notify([input.responsibleUserId], 'assigned', updated, user._id);
    const before = new Map(task.subtasks.map((st) => [st._id, st.assigneeId]));
    const newlyAssigned = (input.subtasks ?? []).filter(
      (st) => st.assigneeId && before.get(st._id) !== st.assigneeId,
    );
    for (const st of newlyAssigned)
      await this.notifications.notify([st.assigneeId!], 'subtaskAssigned', updated, user._id, {
        subtask: st.name,
      });
    return updated;
  }

  /**
   * Valeurs de champs personnalisés validées contre leur définition dans le board.
   * Les identifiants deviennent des chemins Mongo : seuls ceux des champs existants sont acceptés.
   */
  private customFieldsUpdate(board: Board, values: Record<string, string | number | null>) {
    const set: Record<string, string | number> = {};
    const unset: Record<string, ''> = {};
    for (const [fid, v] of Object.entries(values)) {
      const field = board.customFields?.find((f) => f._id === fid);
      if (!field) fail(400, 'UNKNOWN_FIELD');
      if (v === null || v === '') {
        unset[`customFields.${fid}`] = '';
        continue;
      }
      const ok =
        (field.type === 'number' && typeof v === 'number' && Number.isFinite(v)) ||
        (field.type === 'text' && typeof v === 'string') ||
        (field.type === 'dropdown' && field.options.some((o) => o._id === v));
      if (!ok) fail(400, 'INVALID_FIELD_VALUE');
      set[`customFields.${fid}`] = v;
    }
    const merged = (current: Task['customFields']) => {
      const out = { ...current };
      for (const [fid, v] of Object.entries(values)) {
        if (v === null || v === '') delete out[fid];
        else out[fid] = v;
      }
      return out;
    };
    return { set, unset, merged };
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
    if (Object.keys(changes).length)
      await this.journal.log(board._id, task._id, user._id, 'taskMoved', changes);
    const moved = this.emit({ ...task, ...set });
    if (task.columnId !== input.columnId)
      await this.notifications.notifyColumnWatchers(board, moved, input.columnId, user._id);
    await this.completed(task, moved, user._id);
    return moved;
  }

  /**
   * Règle de récurrence saisie → récurrence stockée. Une règle modifiée garde l'ancre et le rang de l'occurrence :
   * seules les occurrences suivantes changent (spec § 4.4).
   */
  private recurrenceFor(board: Board, task: Task, input: RecurrenceInput | null): Recurrence | null {
    if (!input) return null;
    if (input.startColumnId && !board.columns.some((c) => c._id === input.startColumnId))
      fail(400, 'UNKNOWN_COLUMN');
    const anchor = task.recurrence?.anchor ?? startOfDayUtc(task.dueAt ?? new Date());
    return {
      ...input,
      anchor,
      index: task.recurrence?.index ?? 1,
      spawned: task.recurrence?.spawned ?? false,
      nextAt: input.mode === 'fixedDate' ? nextOccurrence(input, anchor, anchor) : null,
    };
  }

  /**
   * Crée l'occurrence suivante d'une série, datée `anchor`, masquée jusqu'à `startAt`.
   * La source est marquée « suivante créée » de façon conditionnelle : un double déclenchement ne crée rien.
   */
  async spawnOccurrence(source: Task, anchor: Date, startAt: Date | null, actorId: string) {
    const rec = source.recurrence!;
    const claimed = await this.db.tasks.updateOne(
      { _id: source._id, 'recurrence.spawned': false },
      { $set: { 'recurrence.spawned': true } },
    );
    const board = await this.db.boards.findOne({ _id: source.boardId, deletedAt: null });
    if (!claimed.modifiedCount || !board) return null;
    const columnId = board.columns.some((c) => c._id === rec.startColumnId)
      ? rec.startColumnId!
      : board.columns[0]._id;
    const swimlaneId = this.cell(
      board,
      columnId,
      board.swimlanes.some((s) => s._id === source.swimlaneId) ? source.swimlaneId : undefined,
    );
    const now = new Date();
    const task: Task = {
      ...source,
      _id: randomUUID(),
      columnId,
      swimlaneId,
      position: await this.position(board._id, columnId, swimlaneId),
      collaboratorIds: [],
      subtasks: source.subtasks.map((st) => ({ ...st, _id: randomUUID(), done: false })),
      // L'échéance garde son décalage par rapport à la date de l'occurrence.
      dueAt: source.dueAt ? new Date(anchor.getTime() + source.dueAt.getTime() - rec.anchor.getTime()) : null,
      dueReachedAt: null,
      dueNotified: {},
      completedAt: null,
      archivedAt: null,
      startAt,
      number: await this.nextNumber(board),
      commentsCount: 0,
      attachmentsCount: 0,
      recurrence: {
        ...rec,
        anchor,
        index: rec.index + 1,
        spawned: false,
        nextAt:
          rec.mode === 'fixedDate'
            ? nextOccurrence(rec, rec.anchor, new Date(Math.max(anchor.getTime(), now.getTime())))
            : null,
      },
      createdAt: now,
      updatedAt: now,
      updatedById: actorId,
    };
    await this.db.tasks.insertOne(task);
    await this.refreshSearch(task._id);
    await this.journal.log(board._id, task._id, actorId, 'taskCreated', {
      name: { old: null, new: task.name },
      recurrenceOf: { old: null, new: source._id },
    });
    return this.emit(task);
  }

  /** Effets d'une arrivée dans une colonne : complétion (spec § 4.2) et échéance atteinte (§ 4.3). */
  private arrivalEffects(board: Board, task: Task, columnId: string): Partial<Task> {
    const out: Partial<Task> = {};
    const now = new Date();
    if (columnId !== task.columnId) {
      if (columnId === board.completionColumnId) out.completedAt = now;
      else if (task.columnId === board.completionColumnId) out.completedAt = null;
    }
    if (task.dueTargetColumnId && columnId === task.dueTargetColumnId && !task.dueReachedAt)
      out.dueReachedAt = now;
    return out;
  }

  /** Une swimlane devient la seule (ou disparaît) : toutes les tâches du board y sont rattachées. */
  async assignAllToSwimlane(boardId: string, swimlaneId: string | null) {
    await this.db.tasks.updateMany({ boardId }, { $set: { swimlaneId } });
  }

  countActive(boardId: string, filter: Filter<Task>) {
    return this.db.tasks.countDocuments({ ...filter, boardId, archivedAt: null }, { limit: 1 });
  }

  /**
   * Déplace toutes les tâches correspondant au filtre (suppression de colonne ou de swimlane).
   * Rejouable : en cas d'interruption, relancer l'opération termine le travail.
   */
  async relocate(
    board: Board,
    user: PublicUser,
    filter: Filter<Task>,
    columnId?: string,
    swimlaneId?: string | null,
  ) {
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
      events.push(this.journal.event(board._id, t._id, user._id, 'taskMoved', diff(t, set)));
      if (col !== t.columnId) await this.notifications.notifyColumnWatchers(board, t, col, user._id);
      await this.completed(t, { ...t, ...set }, user._id);
    }
    await this.journal.logMany(events);
  }

  async archive(board: Board, user: PublicUser, filter: Filter<Task>) {
    const tasks = await this.db.tasks.find({ ...filter, boardId: board._id, archivedAt: null }).toArray();
    if (!tasks.length) return 0;
    const now = new Date();
    await this.db.tasks.updateMany({ _id: { $in: tasks.map((t) => t._id) } }, { $set: { archivedAt: now } });
    await this.journal.logMany(
      tasks.map((t) =>
        this.journal.event(board._id, t._id, user._id, 'taskArchived', {
          archivedAt: { old: null, new: now },
        }),
      ),
    );
    this.realtime.toBoard(
      board._id,
      'tasks.removed',
      tasks.map((t) => t._id),
    );
    return tasks.length;
  }

  /** Restauration dans la colonne (et swimlane) d'origine, ou la première si elle n'existe plus. */
  async restore(board: Board, user: PublicUser, taskId: string) {
    const task = await this.get(board, taskId);
    if (!task.archivedAt) return task;
    const columnId = board.columns.some((c) => c._id === task.columnId)
      ? task.columnId
      : board.columns[0]._id;
    const swimlaneId = this.cell(
      board,
      columnId,
      board.swimlanes.some((s) => s._id === task.swimlaneId) ? task.swimlaneId : undefined,
    );
    const set: Partial<Task> = {
      archivedAt: null,
      columnId,
      swimlaneId,
      position: await this.position(board._id, columnId, swimlaneId),
      ...this.arrivalEffects(board, task, columnId),
    };
    await this.db.tasks.updateOne({ _id: task._id }, { $set: set });
    await this.journal.log(board._id, task._id, user._id, 'taskRestored', diff(task, set));
    return this.emit({ ...task, ...set });
  }

  /** Suppression définitive ; commentaires, pièces jointes et notifications suivent via l'événement `task.deleted`. */
  async remove(board: Board, user: PublicUser, taskId: string) {
    const task = await this.get(board, taskId);
    await this.db.tasks.deleteOne({ _id: task._id });
    await this.events.emitAsync(TASK_DELETED, { taskId: task._id } satisfies TaskDeletedEvent);
    await this.journal.log(board._id, task._id, user._id, 'taskDeleted', {
      name: { old: task.name, new: null },
    });
    this.realtime.toBoard(board._id, 'tasks.removed', [task._id]);
  }

  /** Compteurs dénormalisés affichés sur la carte (commentaires, pièces jointes). */
  async adjustCounter(taskId: string, field: 'commentsCount' | 'attachmentsCount', delta: number) {
    const task = await this.db.tasks.findOneAndUpdate(
      { _id: taskId },
      { $inc: { [field]: delta } },
      { returnDocument: 'after' },
    );
    if (task) this.emit(task);
  }

  /** Temps passé recalculé par le module « temps » ; diffusé pour mettre la carte à jour. */
  async setSpent(taskId: string, spentSeconds: number) {
    const task = await this.db.tasks.findOneAndUpdate(
      { _id: taskId },
      { $set: { spentSeconds } },
      { returnDocument: 'after' },
    );
    if (task) this.emit(task);
  }

  /** Purge définitive des tâches et du journal d'un board (corbeille expirée). */
  async purgeBoard(boardId: string) {
    await this.db.tasks.deleteMany({ boardId });
    await this.db.events.deleteMany({ boardId });
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
  private async position(
    boardId: string,
    columnId: string,
    swimlaneId: string | null,
    index?: number,
    excludeId?: string,
  ) {
    const cell = await this.db.tasks
      .find({
        boardId,
        columnId,
        swimlaneId,
        archivedAt: null,
        ...(excludeId ? { _id: { $ne: excludeId } } : {}),
      })
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
      cell.map((t, k) => ({
        updateOne: { filter: { _id: t._id }, update: { $set: { position: (k < i ? k : k + 1) * GAP } } },
      })),
    );
    return i * GAP;
  }
}
