import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { mentions } from '@flowboard/shared';
import type { Board } from '../boards/board.entity';
import { fail } from '../common/errors';
import { Db } from '../database/db.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Realtime } from '../realtime/realtime.service';
import {
  BOARD_PURGED,
  TASK_DELETED,
  type BoardPurgedEvent,
  type TaskDeletedEvent,
} from '../tasks/task.entity';
import { TaskJournalService } from '../tasks/task-journal.service';
import { TasksService } from '../tasks/tasks.service';
import type { PublicUser } from '../users/user.entity';
import type { Comment } from './comment.entity';

/** Commentaires Markdown et mentions `@identifiant` (spec § 4.3, § 9). */
@Injectable()
export class CommentsService {
  constructor(
    private db: Db,
    private tasks: TasksService,
    private journal: TaskJournalService,
    private notifications: NotificationsService,
    private realtime: Realtime,
  ) {}

  async list(board: Board, taskId: string) {
    await this.tasks.get(board, taskId);
    return this.db.comments.find({ taskId }).sort({ createdAt: 1 }).toArray();
  }

  async create(board: Board, user: PublicUser, taskId: string, text: string) {
    const task = await this.tasks.get(board, taskId);
    const comment: Comment = {
      _id: randomUUID(),
      boardId: board._id,
      taskId,
      authorId: user._id,
      text,
      createdAt: new Date(),
      updatedAt: null,
    };
    await this.db.comments.insertOne(comment);
    await this.tasks.refreshSearch(taskId);
    await this.tasks.adjustCounter(taskId, 'commentsCount', 1);
    await this.journal.log(board._id, taskId, user._id, 'commentCreated', {
      comment: { old: null, new: text },
    });
    this.realtime.toBoard(board._id, 'comment', comment);

    const mentioned = await this.mentionedMembers(board, text);
    await this.notifications.notify(mentioned, 'mentioned', task, user._id, { commentId: comment._id });
    const followers = [task.responsibleUserId, ...task.collaboratorIds].filter(
      (id): id is string => !!id && !mentioned.includes(id),
    );
    await this.notifications.notify(followers, 'commented', task, user._id, { commentId: comment._id });
    return comment;
  }

  async update(board: Board, user: PublicUser, id: string, text: string) {
    const comment = await this.own(board, user, id);
    const updated = { ...comment, text, updatedAt: new Date() };
    await this.db.comments.updateOne({ _id: id }, { $set: { text, updatedAt: updated.updatedAt } });
    await this.tasks.refreshSearch(comment.taskId);
    await this.journal.log(board._id, comment.taskId, user._id, 'commentChanged', {
      comment: { old: comment.text, new: text },
    });
    this.realtime.toBoard(board._id, 'comment', updated);
    return updated;
  }

  async remove(board: Board, user: PublicUser, id: string) {
    const comment = await this.own(board, user, id);
    await this.db.comments.deleteOne({ _id: id });
    await this.tasks.refreshSearch(comment.taskId);
    await this.tasks.adjustCounter(comment.taskId, 'commentsCount', -1);
    await this.journal.log(board._id, comment.taskId, user._id, 'commentDeleted', {
      comment: { old: comment.text, new: null },
    });
    this.realtime.toBoard(board._id, 'comment.removed', { _id: id, taskId: comment.taskId });
  }

  @OnEvent(TASK_DELETED)
  async onTaskDeleted({ taskId }: TaskDeletedEvent) {
    await this.db.comments.deleteMany({ taskId });
  }

  @OnEvent(BOARD_PURGED)
  async onBoardPurged({ boardId }: BoardPurgedEvent) {
    await this.db.comments.deleteMany({ boardId });
  }

  /** Seul l'auteur modifie ou supprime son commentaire. */
  private async own(board: Board, user: PublicUser, id: string) {
    const comment = await this.db.comments.findOne({ _id: id, boardId: board._id });
    if (!comment) fail(404, 'NOT_FOUND');
    if (comment.authorId !== user._id) fail(403, 'FORBIDDEN');
    return comment;
  }

  /** Membres du board mentionnés par leur identifiant. */
  private async mentionedMembers(board: Board, text: string) {
    const usernames = mentions(text);
    if (!usernames.length) return [];
    const memberIds = new Set(board.members.map((m) => m.userId));
    const users = await this.db.users
      .find({ username: { $in: usernames } })
      .project<{ _id: string }>({ _id: 1 })
      .toArray();
    return users.map((u) => u._id).filter((id) => memberIds.has(id));
  }
}
