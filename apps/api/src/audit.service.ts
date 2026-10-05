import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Db } from './db';

/** Journal d'audit des actions d'administration (spec § 10). */
@Injectable()
export class AuditService {
  constructor(private db: Db) {}

  log(actorId: string, action: string, targetId: string | null = null, details: Record<string, unknown> = {}) {
    return this.db.audit.insertOne({ _id: randomUUID(), actorId, action, targetId, details, at: new Date() });
  }

  list() {
    return this.db.audit.find().sort({ at: -1 }).limit(500).toArray();
  }
}
