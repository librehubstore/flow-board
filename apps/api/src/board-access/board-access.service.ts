import { Injectable } from '@nestjs/common';
import {
  ADMIN_VIEW_PERMISSIONS,
  isBuiltInRole,
  ROLE_PERMISSIONS,
  type BoardRole,
  type Permission,
} from '@flowboard/shared';
import { fail } from '../common/errors';
import { Db } from '../database/db.service';
import type { PublicUser } from '../users/user.entity';

/**
 * Contrôle d'accès aux boards (spec § 4.10), seule source de vérité des permissions.
 * Utilisé par la garde HTTP, la passerelle temps réel et les rapports. Ne dépend que de la base : aucun cycle possible.
 */
@Injectable()
export class BoardAccessService {
  constructor(private db: Db) {}

  /** Permissions d'un rôle : prédéfini, ou personnalisé (défini par l'admin). Un rôle supprimé n'accorde rien. */
  async permissionsFor(role: BoardRole | undefined | null): Promise<readonly Permission[]> {
    if (!role) return [];
    if (isBuiltInRole(role)) return ROLE_PERMISSIONS[role];
    return (await this.db.roles.findOne({ _id: role }))?.permissions ?? [];
  }

  /** Un non-membre reçoit 404 pour ne pas révéler l'existence du board ; un membre sans la permission, 403. */
  async access(boardId: string, user: PublicUser, perm: Permission) {
    const board = await this.db.boards.findOne({ _id: boardId, deletedAt: null });
    const role = board?.members.find((m) => m.userId === user._id)?.role;
    const perms = new Set<Permission>([
      ...(await this.permissionsFor(role)),
      ...(user.globalRole === 'admin' ? ADMIN_VIEW_PERMISSIONS : []),
    ]);
    if (!board || !perms.size) fail(404, 'NOT_FOUND');
    if (!perms.has(perm)) fail(403, 'FORBIDDEN');
    return { board, role: role ?? null, permissions: [...perms] };
  }
}
