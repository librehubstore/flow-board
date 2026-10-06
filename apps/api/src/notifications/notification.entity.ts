import type { NotificationType } from '@flowboard/shared';

export interface Notification {
  _id: string;
  userId: string;
  type: NotificationType;
  boardId: string;
  taskId: string;
  payload: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
}
