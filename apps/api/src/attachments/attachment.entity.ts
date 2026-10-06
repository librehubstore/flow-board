export interface Attachment {
  _id: string;
  boardId: string;
  taskId: string;
  fileName: string;
  mimeType: string;
  size: number;
  storageKey: string;
  uploadedById: string;
  createdAt: Date;
}
