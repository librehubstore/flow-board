import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CustomRoleInput } from '@flowboard/shared';
import { AuditService } from '../audit/audit.service';
import { fail } from '../common/errors';
import { Db } from '../database/db.service';
import type { PublicUser } from '../users/user.entity';
import type { Role } from './role.entity';

/** Rôles personnalisés (spec § 4.10) : définis par l'admin, attribuables aux membres de n'importe quel board. */
@Injectable()
export class RolesService {
  constructor(
    private db: Db,
    private audit: AuditService,
  ) {}

  list() {
    return this.db.roles.find().sort({ name: 1 }).toArray();
  }

  async create(actor: PublicUser, input: CustomRoleInput) {
    const role: Role = {
      _id: randomUUID(),
      name: input.name,
      permissions: input.permissions,
      createdAt: new Date(),
    };
    await this.db.roles.insertOne(role);
    await this.audit.log(actor._id, 'role.create', role._id, {
      name: role.name,
      permissions: role.permissions,
    });
    return role;
  }

  /** Modifier un rôle change immédiatement les droits de tous les membres qui l'ont. */
  async update(actor: PublicUser, id: string, input: CustomRoleInput) {
    const r = await this.db.roles.findOneAndUpdate({ _id: id }, { $set: input }, { returnDocument: 'after' });
    if (!r) fail(404, 'NOT_FOUND');
    await this.audit.log(actor._id, 'role.update', id, input);
    return r;
  }

  /** Un rôle encore attribué ne peut pas être supprimé : les membres concernés perdraient tout accès. */
  async remove(actor: PublicUser, id: string) {
    if (await this.db.boards.countDocuments({ 'members.role': id }, { limit: 1 })) fail(409, 'ROLE_IN_USE');
    const r = await this.db.roles.deleteOne({ _id: id });
    if (!r.deletedCount) fail(404, 'NOT_FOUND');
    await this.audit.log(actor._id, 'role.delete', id);
  }
}
