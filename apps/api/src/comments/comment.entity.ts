export interface Comment {
  _id: string;
  boardId: string;
  taskId: string;
  authorId: string;
  text: string;
  createdAt: Date;
  updatedAt: Date | null;
}
