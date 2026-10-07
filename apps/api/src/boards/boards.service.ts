import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import type { UpdateBoardInput } from '@flowboard/shared';
import { AuditService } from '../audit/audit.service';
import { fail } from '../common/errors';
import { every } from '../common/periodic';
import { Db } from '../database/db.service';
import { Realtime } from '../realtime/realtime.service';
import { BOARD_PURGED, type BoardPurgedEvent } from '../tasks/task.entity';
import { TasksService } from '../tasks/tasks.service';
import type { PublicUser } from '../users/user.entity';
import type { Board } from './board.entity';

const DEFAULT_COLUMNS = {
  fr: ['À faire', 'Aujourd’hui', 'En cours', 'Terminé'],
  en: ['To-do', 'Do today', 'In progress', 'Done'],
};
const TRASH_DAYS = 30;

/** Cycle de vie d'un board : création, réglages généraux, labels, corbeille. */
@Injectable()
export class BoardsService implements OnApplicationBootstrap, OnModuleDestroy {
  private purgeTimer?: NodeJS.Timeout;

  constructor(
    private db: Db,
    private tasks: TasksService,
    private audit: AuditService,
    private realtime: Realtime,
    private events: EventEmitter2,
  ) {}

  onApplicationBootstrap() {
    this.purgeTimer = every(3_600_000, 'BoardTrash', () => this.purgeTrash());
  }
  onModuleDestroy() {
    clearInterval(this.purgeTimer);
  }

  listFor(user: PublicUser) {
    return this.db.boards
      .find({ 'members.userId': user._id, deletedAt: null })
      .project({ name: 1, description: 1, members: 1, createdAt: 1, isTemplate: 1 })
      .sort({ name: 1 })
      .toArray();
  }

  /** Vue complète d'un board : structure, membres (avec nom), tâches non archivées. */
  async view(board: Board) {
    const users = await this.db.users
      .find({ _id: { $in: board.members.map((m) => m.userId) } })
      .project<{ _id: string; username: string; fullName: string; status: string }>({
        username: 1,
        fullName: 1,
        status: 1,
      })
      .toArray();
    const members = board.members.map((m) => ({ ...m, ...users.find((u) => u._id === m.userId) }));
    return { board, members, tasks: await this.tasks.list(board._id, false) };
  }

  async create(user: PublicUser, name: string, description: string, locale: 'fr' | 'en') {
    const columns = DEFAULT_COLUMNS[locale].map((n) => ({
      _id: randomUUID(),
      name: n,
      description: '',
      wipLimit: null,
    }));
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
    const updated = await this.set(board._id, input);
    // Numérotation activée : les tâches existantes reçoivent un numéro.
    if (input.taskNumbering?.enabled && !board.taskNumbering?.enabled)
      await this.tasks.numberExisting(board._id);
    // Couleurs personnalisées retirées : les tâches concernées reviennent au jaune.
    if (input.customColors)
      await this.tasks.resetColors(
        board._id,
        (board.customColors ?? []).filter((c) => !input.customColors!.includes(c)),
      );
    return updated;
  }

  /** Modèles de board visibles par tous : nom, description et colonnes (spec § 4.2). */
  listTemplates() {
    return this.db.boards
      .find({ isTemplate: true, deletedAt: null })
      .project({ name: 1, description: 1, 'columns.name': 1 })
      .sort({ name: 1 })
      .toArray();
  }

  /** Nouveau board à partir d'un modèle : structure seule, l'appelant en devient propriétaire. */
  async createFromTemplate(user: PublicUser, templateId: string, name: string, description: string) {
    const template = await this.db.boards.findOne({ _id: templateId, isTemplate: true, deletedAt: null });
    if (!template) fail(404, 'NOT_FOUND');
    return this.copy(template, user, name, false, description);
  }

  /**
   * Copie d'un board (spec § 4.2) : structure (colonnes, swimlanes, labels, couleurs, champs) avec de nouveaux
   * identifiants, et éventuellement ses tâches non archivées. L'appelant en est le seul membre (propriétaire).
   */
  async copy(
    source: Board,
    user: PublicUser,
    name: string,
    withTasks: boolean,
    description = source.description,
  ) {
    const ids = new Map<string, string>();
    const remap = (old: string) => {
      const id = randomUUID();
      ids.set(old, id);
      return id;
    };
    const board: Board = {
      _id: randomUUID(),
      name,
      description,
      columns: source.columns.map((c) => ({ ...c, _id: remap(c._id) })),
      swimlanes: source.swimlanes.map((s) => ({ ...s, _id: remap(s._id) })),
      completionColumnId: '',
      members: [{ userId: user._id, role: 'owner' }],
      labels: source.labels.map((l) => ({ ...l, _id: remap(l._id) })),
      colorLabels: { ...source.colorLabels },
      customColors: [...(source.customColors ?? [])],
      customFields: (source.customFields ?? []).map((f) => ({
        ...f,
        _id: remap(f._id),
        options: f.options.map((o) => ({ ...o, _id: remap(o._id) })),
      })),
      taskNumbering: source.taskNumbering,
      taskCounter: withTasks ? (source.taskCounter ?? 0) : 0,
      isTemplate: false,
      createdAt: new Date(),
      deletedAt: null,
    };
    board.completionColumnId = ids.get(source.completionColumnId)!;
    await this.db.boards.insertOne(board);
    if (withTasks) await this.tasks.copyTasks(source, board, ids, user._id);
    return board;
  }

  /** Création à la volée ; renvoie le label existant si le nom est déjà pris (insensible à la casse). */
  async addLabel(board: Board, name: string) {
    const existing = board.labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const label = { _id: randomUUID(), name };
    await this.db.boards.updateOne({ _id: board._id }, { $push: { labels: label } });
    await this.changed(board._id);
    return label;
  }

  // ---------- Corbeille (spec § 4.2, § 4.11) ----------
  async remove(board: Board, actor: PublicUser, confirmName: string) {
    if (confirmName !== board.name) fail(400, 'CONFIRM_NAME_MISMATCH');
    await this.db.boards.updateOne({ _id: board._id }, { $set: { deletedAt: new Date() } });
    this.realtime.toBoard(board._id, 'board.deleted', { boardId: board._id });
    await this.audit.log(actor._id, 'board.delete', board._id, { name: board.name });
  }

  listAll() {
    return this.db.boards
      .find()
      .project({ name: 1, members: 1, createdAt: 1, deletedAt: 1 })
      .sort({ deletedAt: 1, name: 1 })
      .toArray();
  }

  async restore(actor: PublicUser, boardId: string) {
    const r = await this.db.boards.updateOne(
      { _id: boardId, deletedAt: { $ne: null } },
      { $set: { deletedAt: null } },
    );
    if (!r.matchedCount) fail(404, 'NOT_FOUND');
    await this.audit.log(actor._id, 'board.restore', boardId);
  }

  /** Purge définitive après 30 jours ; commentaires, PJ et notifications suivent via `board.purged`. */
  async purgeTrash() {
    const limit = new Date(Date.now() - TRASH_DAYS * 86_400_000);
    const ids = (
      await this.db.boards
        .find({ deletedAt: { $lt: limit } })
        .project<{ _id: string }>({ _id: 1 })
        .toArray()
    ).map((b) => b._id);
    for (const boardId of ids) {
      await this.events.emitAsync(BOARD_PURGED, { boardId } satisfies BoardPurgedEvent);
      await this.tasks.purgeBoard(boardId);
      await this.db.boards.deleteOne({ _id: boardId });
    }
  }

  // ---------- Écriture du document board (partagée par les services de structure et de membres) ----------
  async get(boardId: string) {
    const board = await this.db.boards.findOne({ _id: boardId });
    if (!board) fail(404, 'NOT_FOUND');
    return board;
  }

  async set(boardId: string, set: Partial<Board>) {
    await this.db.boards.updateOne({ _id: boardId }, { $set: set });
    return this.changed(boardId);
  }

  /** Relit le board et signale le changement de structure aux clients connectés (ils rechargent le board). */
  async changed(boardId: string) {
    this.realtime.toBoard(boardId, 'board.changed', { boardId });
    return this.get(boardId);
  }
}
