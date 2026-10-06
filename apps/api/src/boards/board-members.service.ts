import { Injectable } from '@nestjs/common';
import { isBuiltInRole, type BoardRole } from '@flowboard/shared';
import { AuditService } from '../audit/audit.service';
import { fail } from '../common/errors';
import { Db } from '../database/db.service';
import { Realtime } from '../realtime/realtime.service';
import type { PublicUser } from '../users/user.entity';
import type { Board } from './board.entity';
import { BoardsService } from './boards.service';

/** Membres d'un board et rôles (spec § 2, § 4.11) ; il reste toujours au moins un propriétaire. */
@Injectable()
export class BoardMembersService {
  constructor(
    private db: Db,
    private boards: BoardsService,
    private realtime: Realtime,
    private audit: AuditService,
  ) {}

  async add(board: Board, userId: string, role: BoardRole) {
    await this.assertActiveUser(userId);
    await this.assertRole(role);
    if (board.members.some((m) => m.userId === userId)) return this.setRole(board, userId, role);
    await this.db.boards.updateOne({ _id: board._id }, { $push: { members: { userId, role } } });
    return this.boards.changed(board._id);
  }

  async setRole(board: Board, userId: string, role: BoardRole) {
    await this.assertRole(role);
    const members = board.members.map((m) => (m.userId === userId ? { ...m, role } : m));
    if (!members.some((m) => m.role === 'owner')) fail(409, 'LAST_OWNER');
    return this.boards.set(board._id, { members });
  }

  async remove(board: Board, userId: string) {
    const members = board.members.filter((m) => m.userId !== userId);
    if (!members.some((m) => m.role === 'owner')) fail(409, 'LAST_OWNER');
    const updated = await this.boards.set(board._id, { members });
    this.realtime.kick(userId, board._id);
    return updated;
  }

  /** Transfert par l'admin : le nouveau propriétaire obtient tous les droits, les anciens deviennent éditeurs. */
  async transfer(actor: PublicUser, boardId: string, userId: string) {
    const board = await this.boards.get(boardId);
    await this.assertActiveUser(userId);
    const members = [
      ...board.members
        .filter((m) => m.userId !== userId)
        .map((m) => (m.role === 'owner' ? { ...m, role: 'editor' as const } : m)),
      { userId, role: 'owner' as const },
    ];
    await this.audit.log(actor._id, 'board.transfer', boardId, { to: userId });
    return this.boards.set(boardId, { members });
  }

  /** Rôle prédéfini, ou rôle personnalisé existant (spec § 4.10). */
  private async assertRole(role: string) {
    if (!isBuiltInRole(role) && !(await this.db.roles.countDocuments({ _id: role })))
      fail(400, 'UNKNOWN_ROLE');
  }

  private async assertActiveUser(userId: string) {
    if (!(await this.db.users.countDocuments({ _id: userId, status: 'active' }))) fail(400, 'UNKNOWN_USER');
  }
}
