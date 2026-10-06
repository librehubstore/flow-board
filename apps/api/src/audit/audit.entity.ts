export interface AuditEntry {
  _id: string;
  actorId: string;
  action: string;
  targetId: string | null;
  details: Record<string, unknown>;
  at: Date;
}
