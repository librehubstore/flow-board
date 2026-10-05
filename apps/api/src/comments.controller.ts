import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CommentInput, mentions } from '@flowboard/shared';
import { Board, Comment, Db, PublicUser, Task } from './db';
import { fail } from './errors';
import { CurrentBoard, CurrentUser, Perm, Zod } from './http';
import { NotificationsService } from './notifications.service';
import { Realtime } from './realtime.service';
import { TasksService } from './tasks.service';

/** Commentaires Markdown, mentions `@identifiant` (spec § 4.3, § 9). */
@Controller('boards/:boardId/tasks/:taskId/comments')
export class CommentsController {
  constructor(
    private db: Db,
    private tasks: TasksService,
    private notifications: NotificationsService,
    private realtime: Realtime,
  ) {}

  @Perm('board.view')
  @Get()
  async list(@CurrentBoard() board: Board, @Param('taskId') taskId: string) {
    await this.tasks.get(board, taskId);
    return this.db.comments.find({ taskId }).sort({ createdAt: 1 }).toArray();
  }

  @Perm('comment')
  @Post()
  async create(
    @CurrentBoard() board: Board,
    @CurrentUser() user: PublicUser,
    @Param('taskId') taskId: string,
    @Body(new Zod(CommentInput)) body: CommentInput,
  ) {
    const task = await this.tasks.get(board, taskId);
    const comment: Comment = {
      _id: randomUUID(),
      boardId: board._id,
      taskId,
      authorId: user._id,
      text: body.text,
      createdAt: new Date(),
      updatedAt: null,
    };
    await this.db.comments.insertOne(comment);
    await this.counted(task, 1);
    await this.tasks.log(board._id, taskId, user._id, 'commentCreated', { comment: { old: null, new: comment.text } });
    this.realtime.toBoard(board._id, 'comment', comment);

    const mentioned = await this.mentionedMembers(board, body.text);
    await this.notifications.notify(mentioned, 'mentioned', task, user._id, { commentId: comment._id });
    const followers = [task.responsibleUserId, ...task.collaboratorIds].filter((id): id is string => !!id && !mentioned.includes(id));
    await this.notifications.notify(followers, 'commented', task, user._id, { commentId: comment._id });
    return comment;
  }

  @Perm('comment')
  @Patch(':commentId')
  async update(
    @CurrentBoard() board: Board,
    @CurrentUser() user: PublicUser,
    @Param('commentId') id: string,
    @Body(new Zod(CommentInput)) body: CommentInput,
  ) {
    const comment = await this.own(board, user, id);
    const updated = { ...comment, text: body.text, updatedAt: new Date() };
    await this.db.comments.updateOne({ _id: id }, { $set: { text: updated.text, updatedAt: updated.updatedAt } });
    await this.tasks.log(board._id, comment.taskId, user._id, 'commentChanged', { comment: { old: comment.text, new: body.text } });
    this.realtime.toBoard(board._id, 'comment', updated);
    return updated;
  }

  @Perm('comment')
  @Delete(':commentId')
  @HttpCode(204)
  async remove(@CurrentBoard() board: Board, @CurrentUser() user: PublicUser, @Param('commentId') id: string) {
    const comment = await this.own(board, user, id);
    await this.db.comments.deleteOne({ _id: id });
    await this.counted(await this.tasks.get(board, comment.taskId), -1);
    await this.tasks.log(board._id, comment.taskId, user._id, 'commentDeleted', { comment: { old: comment.text, new: null } });
    this.realtime.toBoard(board._id, 'comment.removed', { _id: id, taskId: comment.taskId });
  }

  /** Seul l'auteur modifie ou supprime son commentaire. */
  private async own(board: Board, user: PublicUser, id: string) {
    const comment = await this.db.comments.findOne({ _id: id, boardId: board._id });
    if (!comment) fail(404, 'NOT_FOUND');
    if (comment.authorId !== user._id) fail(403, 'FORBIDDEN');
    return comment;
  }

  private async counted(task: Task, delta: number) {
    const updated = await this.db.tasks.findOneAndUpdate({ _id: task._id }, { $inc: { commentsCount: delta } }, { returnDocument: 'after' });
    if (updated) this.realtime.toBoard(task.boardId, 'task', updated);
  }

  /** Membres du board mentionnés par leur identifiant. */
  private async mentionedMembers(board: Board, text: string) {
    const usernames = mentions(text);
    if (!usernames.length) return [];
    const memberIds = new Set(board.members.map((m) => m.userId));
    const users = await this.db.users.find({ username: { $in: usernames } }).project<{ _id: string }>({ _id: 1 }).toArray();
    return users.map((u) => u._id).filter((id) => memberIds.has(id));
  }
}
