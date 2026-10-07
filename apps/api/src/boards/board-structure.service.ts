import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ColumnInput, CustomFieldInput, SwimlaneInput } from '@flowboard/shared';
import { fail } from '../common/errors';
import { Db } from '../database/db.service';
import { TasksService } from '../tasks/tasks.service';
import type { PublicUser } from '../users/user.entity';
import type { Board } from './board.entity';
import { BoardsService } from './boards.service';

/** Colonnes et swimlanes (spec § 4.2) : ajout, modification, réordonnancement, suppression avec destination. */
@Injectable()
export class BoardStructureService {
  constructor(
    private db: Db,
    private boards: BoardsService,
    private tasks: TasksService,
  ) {}

  // ---------- Colonnes ----------
  async addColumn(board: Board, input: ColumnInput) {
    const column = {
      _id: randomUUID(),
      name: input.name ?? '?',
      description: input.description ?? '',
      wipLimit: input.wipLimit ?? null,
    };
    // La nouvelle colonne s'insère avant la colonne de complétion si celle-ci est la dernière.
    const last = board.columns[board.columns.length - 1];
    const at = last._id === board.completionColumnId ? board.columns.length - 1 : board.columns.length;
    await this.db.boards.updateOne(
      { _id: board._id },
      { $push: { columns: { $each: [column], $position: at } } },
    );
    await this.boards.changed(board._id);
    return column;
  }

  async updateColumn(board: Board, columnId: string, input: ColumnInput) {
    if (!board.columns.some((c) => c._id === columnId)) fail(404, 'NOT_FOUND');
    const set = Object.fromEntries(Object.entries(input).map(([k, v]) => [`columns.$.${k}`, v]));
    await this.db.boards.updateOne({ _id: board._id, 'columns._id': columnId }, { $set: set });
    return this.boards.changed(board._id);
  }

  reorderColumns(board: Board, ids: string[]) {
    return this.boards.set(board._id, { columns: reorder(board.columns, ids) });
  }

  /** Une colonne non vide exige une destination ; il reste toujours au moins une colonne. */
  async removeColumn(board: Board, actor: PublicUser, columnId: string, destinationId?: string) {
    if (!board.columns.some((c) => c._id === columnId)) fail(404, 'NOT_FOUND');
    if (board.columns.length === 1) fail(409, 'LAST_COLUMN');
    if (await this.tasks.countActive(board._id, { columnId })) {
      if (!destinationId || destinationId === columnId || !board.columns.some((c) => c._id === destinationId))
        fail(409, 'DESTINATION_REQUIRED');
      await this.tasks.relocate(board, actor, { columnId }, destinationId);
    }
    const columns = board.columns.filter((c) => c._id !== columnId);
    const completionColumnId =
      board.completionColumnId === columnId ? columns[columns.length - 1]._id : board.completionColumnId;
    return this.boards.set(board._id, { columns, completionColumnId });
  }

  // ---------- Champs personnalisés (spec § 4.3) ----------
  async addField(board: Board, input: CustomFieldInput) {
    const field = {
      ...input,
      _id: randomUUID(),
      options: input.type === 'dropdown' ? withOptionIds(input) : [],
    };
    await this.db.boards.updateOne({ _id: board._id }, { $push: { customFields: field } });
    await this.boards.changed(board._id);
    return field;
  }

  /** Le type d'un champ est figé (les valeurs saisies en dépendent) ; une option retirée efface ses valeurs. */
  async updateField(board: Board, fieldId: string, input: CustomFieldInput) {
    const field = board.customFields?.find((f) => f._id === fieldId);
    if (!field) fail(404, 'NOT_FOUND');
    if (input.type !== field.type) fail(400, 'FIELD_TYPE_LOCKED');
    const options = field.type === 'dropdown' ? withOptionIds(input, field.options) : [];
    const removed = field.options.filter((o) => !options.some((n) => n._id === o._id)).map((o) => o._id);
    const customFields = board.customFields!.map((f) =>
      f._id === fieldId ? { ...f, ...input, options } : f,
    );
    if (removed.length) await this.tasks.unsetCustomField(board._id, fieldId, removed);
    return this.boards.set(board._id, { customFields });
  }

  async removeField(board: Board, fieldId: string) {
    if (!board.customFields?.some((f) => f._id === fieldId)) fail(404, 'NOT_FOUND');
    await this.tasks.unsetCustomField(board._id, fieldId);
    return this.boards.set(board._id, { customFields: board.customFields.filter((f) => f._id !== fieldId) });
  }

  // ---------- Swimlanes ----------
  async addSwimlane(board: Board, input: SwimlaneInput) {
    const lane = { _id: randomUUID(), name: input.name ?? '?', description: input.description ?? '' };
    await this.db.boards.updateOne({ _id: board._id }, { $push: { swimlanes: lane } });
    // Première swimlane : toutes les tâches existantes y sont rattachées (une tâche = exactement une swimlane).
    if (!board.swimlanes.length) await this.tasks.assignAllToSwimlane(board._id, lane._id);
    await this.boards.changed(board._id);
    return lane;
  }

  async updateSwimlane(board: Board, laneId: string, input: SwimlaneInput) {
    if (!board.swimlanes.some((s) => s._id === laneId)) fail(404, 'NOT_FOUND');
    const set = Object.fromEntries(Object.entries(input).map(([k, v]) => [`swimlanes.$.${k}`, v]));
    await this.db.boards.updateOne({ _id: board._id, 'swimlanes._id': laneId }, { $set: set });
    return this.boards.changed(board._id);
  }

  reorderSwimlanes(board: Board, ids: string[]) {
    return this.boards.set(board._id, { swimlanes: reorder(board.swimlanes, ids) });
  }

  async removeSwimlane(board: Board, actor: PublicUser, laneId: string, destinationId?: string) {
    if (!board.swimlanes.some((s) => s._id === laneId)) fail(404, 'NOT_FOUND');
    const swimlanes = board.swimlanes.filter((s) => s._id !== laneId);
    if (!swimlanes.length) {
      // Dernière swimlane : le board redevient sans swimlane.
      await this.tasks.assignAllToSwimlane(board._id, null);
    } else if (await this.tasks.countActive(board._id, { swimlaneId: laneId })) {
      if (!destinationId || !swimlanes.some((s) => s._id === destinationId))
        fail(409, 'DESTINATION_REQUIRED');
      await this.tasks.relocate(board, actor, { swimlaneId: laneId }, undefined, destinationId);
    }
    return this.boards.set(board._id, { swimlanes });
  }
}

/** Options de liste : celles qui gardent leur identifiant sont conservées, les autres sont nouvelles. */
function withOptionIds(input: CustomFieldInput, existing: { _id: string }[] = []) {
  return input.options.map((o) => ({
    _id: o._id && existing.some((e) => e._id === o._id) ? o._id : randomUUID(),
    label: o.label,
  }));
}

/** Réordonne selon `ids`, qui doit contenir exactement les mêmes éléments. */
function reorder<T extends { _id: string }>(items: T[], ids: string[]): T[] {
  if (ids.length !== items.length || new Set(ids).size !== ids.length) fail(400, 'INVALID_ORDER');
  return ids.map((id) => items.find((i) => i._id === id) ?? fail(400, 'INVALID_ORDER'));
}
