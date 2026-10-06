import type { Permission } from '@flowboard/shared';

/** Rôle personnalisé défini par l'admin : un ensemble de permissions unitaires (spec § 4.10). */
export interface Role {
  _id: string;
  name: string;
  permissions: Permission[];
  createdAt: Date;
}
