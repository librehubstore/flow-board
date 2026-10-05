import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ADMIN_VIEW_PERMISSIONS,
  ROLE_PERMISSIONS,
  type BoardRole,
  type ColumnInput,
  type Permission,
  type SwimlaneInput,
  type UpdateBoardInput,
} from '@flowboard/shared';
import { Board, Db, PublicUser } from './db';
import { fail } from './errors';
import { TasksService } from './tasks.service';
import { AuditService } from './audit.service';
import { Realtime } from './realtime.service';

const DEFAULT_COLUMNS = {
  fr: ['À faire', 'Aujourd’hui', 'En cours', 'Terminé'],
  en: ['To-do', 'Do today', 'In progress', 'Done'],
};
const TRASH_DAYS = 30;

@Injectable()
export class BoardsService implements OnApplicationBootstrap, OnModuleDestroy {
  private purgeTimer?: NodeJS.Timeout;

  constructor(
    private db: Db,
    private tasks: TasksService,
    private audit: AuditService,
    private realtime: Realtime,
  ) {}

  onApplicationBootstrap() {
    // Purge horaire de la corbeille (boards supprimés depuis plus de 30 jours).
    this.purgeTimer = setInterval(() => void this.purgeTrash(), 3_600_000).unref();
  }
  onModuleDestroy() {
    clearInterval(this.purgeTimer);
  }

  /** Contrôle d'accès serveur (spec § 4.10). Un non-membre reçoit 404 pour ne pas révéler l'existence du board. */
  async access(boardId: string, user: PublicUser, perm: Permission) {
    const board = await this.db.boards.findOne({ _id: boardId, deletedAt: null });
    const role = board?.members.find((m) => m.userId === user._id)?.role;
    const perms = new Set<Permission>([
      ...(role ? ROLE_PERMISSIONS[role] : []),
      ...(user.globalRole === 'admin' ? ADMIN_VIEW_PERMISSIONS : []),
    ]);
    if (!board || !perms.size) fail(404, 'NOT_FOUND');
    if (!perms.has(perm)) fail(403, 'FORBIDDEN');
    return { board, role: role ?? null, permissions: [...perms] };
  }

  listFor(user: PublicUser) {
    return this.db.boards
      .find({ 'members.userId': user._id, deletedAt: null })
      .project({ name: 1, description: 1, members: 1, createdAt: 1 })
      .sort({ name: 1 })
      .toArray();
  }

  async create(user: PublicUser, name: string, description: string, locale: 'fr' | 'en') {
    const columns = DEFAULT_COLUMNS[locale].map((n) => ({ _id: randomUUID(), name: n, description: '', wipLimit: null }));
    const board: Board = {
      _id: randomUUID(),
      name,
      description,
      columns,
      swimlanes: [],
      completionColumnId: columns[columns.length - 1]._id,
      members: [{ userId: user._id, role: 'owner' }],
      labels: [],
      colorLabels: {},
      createdAt: new Date(),
      deletedAt: null,
    };
    await this.db.boards.insertOne(board);
    return board;
  }

  async update(board: Board, input: UpdateBoardInput) {
    if (input.completionColumnId && !board.columns.some((c) => c._id === input.completionColumnId))
      fail(400, 'UNKNOWN_COLUMN');
    // ponytail: changer de colonne de complétion ne recalcule pas completedAt des tâches existantes.
    return this.set(board._id, input);
  }

  async remove(board: Board, actor: PublicUser, confirmName: string) {
    if (confirmName !== board.name) fail(400, 'CONFIRM_NAME_MISMATCH');
    await this.db.boards.updateOne({ _id: board._id }, { $set: { deletedAt: new Date() } });
    this.realtime.toBoard(board._id, 'board.deleted', { boardId: board._id });
    await this.audit.log(actor._id, 'board.delete', board._id, { name: board.name });
  }

  // ---------- Colonnes ----------
  async addColumn(board: Board, input: ColumnInput) {
    const column = { _id: randomUUID(), name: input.name ?? '?', description: input.description ?? '', wipLimit: input.wipLimit ?? null };
    // La nouvelle colonne s'insère avant la colonne de complétion si celle-ci est la dernière.
    const last = board.columns[board.columns.length - 1];
    const at = last._id === board.completionColumnId ? board.columns.length - 1 : board.columns.length;
    await this.db.boards.updateOne({ _id: board._id }, { $push: { columns: { $each: [column], $position: at } } });
    await this.reload(board._id);
    return column;
  }

  async updateColumn(board: Board, columnId: string, input: ColumnInput) {
    if (!board.columns.some((c) => c._id === columnId)) fail(404, 'NOT_FOUND');
    const set = Object.fromEntries(Object.entries(input).map(([k, v]) => [`columns.$.${k}`, v]));
    await this.db.boards.updateOne({ _id: board._id, 'columns._id': columnId }, { $set: set });
    return this.reload(board._id);
  }

  async reorderColumns(board: Board, ids: string[]) {
    return this.set(board._id, { columns: reorder(board.columns, ids) });
  }

  /** Une colonne non vide exige une destination ; il reste toujours au moins une colonne. */
  async removeColumn(board: Board, actor: PublicUser, columnId: string, destinationId?: string) {
    if (!board.columns.some((c) => c._id === columnId)) fail(404, 'NOT_FOUND');
    if (board.columns.length === 1) fail(409, 'LAST_COLUMN');
    if (await this.db.tasks.countDocuments({ boardId: board._id, columnId, archivedAt: null }, { limit: 1 })) {
      if (!destinationId || destinationId === columnId || !board.columns.some((c) => c._id === destinationId))
        fail(409, 'DESTINATION_REQUIRED');
      await this.tasks.relocate(board, actor, { columnId }, destinationId);
    }
    const columns = board.columns.filter((c) => c._id !== columnId);
    const completionColumnId = board.completionColumnId === columnId ? columns[columns.length - 1]._id : board.completionColumnId;
    return this.set(board._id, { columns, completionColumnId });
  }

  // ---------- Swimlanes ----------
  async addSwimlane(board: Board, input: SwimlaneInput) {
    const lane = { _id: randomUUID(), name: input.name ?? '?', description: input.description ?? '' };
    await this.db.boards.updateOne({ _id: board._id }, { $push: { swimlanes: lane } });
    // Première swimlane : toutes les tâches existantes y sont rattachées (une tâche = exactement une swimlane).
    if (!board.swimlanes.length) await this.db.tasks.updateMany({ boardId: board._id }, { $set: { swimlaneId: lane._id } });
    await this.reload(board._id);
    return lane;
  }

  async updateSwimlane(board: Board, laneId: string, input: SwimlaneInput) {
    if (!board.swimlanes.some((s) => s._id === laneId)) fail(404, 'NOT_FOUND');
    const set = Object.fromEntries(Object.entries(input).map(([k, v]) => [`swimlanes.$.${k}`, v]));
    await this.db.boards.updateOne({ _id: board._id, 'swimlanes._id': laneId }, { $set: set });
    return this.reload(board._id);
  }

  reorderSwimlanes(board: Board, ids: string[]) {
    return this.set(board._id, { swimlanes: reorder(board.swimlanes, ids) });
  }

  async removeSwimlane(board: Board, actor: PublicUser, laneId: string, destinationId?: string) {
    if (!board.swimlanes.some((s) => s._id === laneId)) fail(404, 'NOT_FOUND');
    const swimlanes = board.swimlanes.filter((s) => s._id !== laneId);
    if (!swimlanes.length) {
      // Dernière swimlane : le board redevient sans swimlane.
      await this.db.tasks.updateMany({ boardId: board._id }, { $set: { swimlaneId: null } });
    } else if (await this.db.tasks.countDocuments({ boardId: board._id, swimlaneId: laneId, archivedAt: null }, { limit: 1 })) {
      if (!destinationId || !swimlanes.some((s) => s._id === destinationId)) fail(409, 'DESTINATION_REQUIRED');
      await this.tasks.relocate(board, actor, { swimlaneId: laneId }, undefined, destinationId);
    }
    return this.set(board._id, { swimlanes });
  }

  // ---------- Labels ----------
  async addLabel(board: Board, name: string) {
    const existing = board.labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const label = { _id: randomUUID(), name };
    await this.db.boards.updateOne({ _id: board._id }, { $push: { labels: label } });
    await this.reload(board._id);
    return label;
  }

  // ---------- Membres ----------
  async addMember(board: Board, userId: string, role: BoardRole) {
    if (!(await this.db.users.countDocuments({ _id: userId, status: 'active' }))) fail(400, 'UNKNOWN_USER');
    if (board.members.some((m) => m.userId === userId)) return this.setRole(board, userId, role);
    await this.db.boards.updateOne({ _id: board._id }, { $push: { members: { userId, role } } });
    return this.reload(board._id);
  }

  setRole(board: Board, userId: string, role: BoardRole) {
    const members = board.members.map((m) => (m.userId === userId ? { ...m, role } : m));
    if (!members.some((m) => m.role === 'owner')) fail(409, 'LAST_OWNER');
    return this.set(board._id, { members });
  }

  async removeMember(board: Board, userId: string) {
    const members = board.members.filter((m) => m.userId !== userId);
    if (!members.some((m) => m.role === 'owner')) fail(409, 'LAST_OWNER');
    const updated = await this.set(board._id, { members });
    this.realtime.kick(userId, board._id);
    return updated;
  }

  // ---------- Administration (spec § 4.11) ----------
  listAll() {
    return this.db.boards
      .find()
      .project({ name: 1, members: 1, createdAt: 1, deletedAt: 1 })
      .sort({ deletedAt: 1, name: 1 })
      .toArray();
  }

  async restore(actor: PublicUser, boardId: string) {
    const r = await this.db.boards.updateOne({ _id: boardId, deletedAt: { $ne: null } }, { $set: { deletedAt: null } });
    if (!r.matchedCount) fail(404, 'NOT_FOUND');
    await this.audit.log(actor._id, 'board.restore', boardId);
  }

  /** Transfert de propriété : le nouveau propriétaire obtient tous les droits, les anciens deviennent éditeurs. */
  async transfer(actor: PublicUser, boardId: string, userId: string) {
    const board = await this.db.boards.findOne({ _id: boardId });
    if (!board) fail(404, 'NOT_FOUND');
    if (!(await this.db.users.countDocuments({ _id: userId, status: 'active' }))) fail(400, 'UNKNOWN_USER');
    const members = [
      ...board.members.filter((m) => m.userId !== userId).map((m) => (m.role === 'owner' ? { ...m, role: 'editor' as const } : m)),
      { userId, role: 'owner' as const },
    ];
    await this.audit.log(actor._id, 'board.transfer', boardId, { to: userId });
    return this.set(boardId, { members });
  }

  async purgeTrash() {
    const limit = new Date(Date.now() - TRASH_DAYS * 86_400_000);
    const ids = (await this.db.boards.find({ deletedAt: { $lt: limit } }).project({ _id: 1 }).toArray()).map((b) => b._id as string);
    if (!ids.length) return;
    for (const boardId of ids) await this.tasks.purgeContent({ boardId });
    await this.db.tasks.deleteMany({ boardId: { $in: ids } });
    await this.db.events.deleteMany({ boardId: { $in: ids } });
    await this.db.boards.deleteMany({ _id: { $in: ids } });
  }

  private async set(boardId: string, set: Partial<Board>) {
    await this.db.boards.updateOne({ _id: boardId }, { $set: set });
    return this.reload(boardId);
  }

  /** Relit le board et signale le changement de structure aux clients connectés (ils rechargent le board). */
  private async reload(boardId: string) {
    this.realtime.toBoard(boardId, 'board.changed', { boardId });
    return (await this.db.boards.findOne({ _id: boardId }))!;
  }
}

/** Réordonne selon `ids`, qui doit contenir exactement les mêmes éléments. */
function reorder<T extends { _id: string }>(items: T[], ids: string[]): T[] {
  if (ids.length !== items.length || new Set(ids).size !== ids.length) fail(400, 'INVALID_ORDER');
  return ids.map((id) => items.find((i) => i._id === id) ?? fail(400, 'INVALID_ORDER'));
}
