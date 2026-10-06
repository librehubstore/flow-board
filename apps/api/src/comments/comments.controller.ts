import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { CommentInput } from '@flowboard/shared';
import type { Board } from '../boards/board.entity';
import { CurrentBoard, CurrentUser, Perm } from '../common/decorators';
import { Zod } from '../common/zod.pipe';
import type { PublicUser } from '../users/user.entity';
import { CommentsService } from './comments.service';

@Controller('boards/:boardId/tasks/:taskId/comments')
export class CommentsController {
  constructor(private comments: CommentsService) {}

  @Perm('board.view')
  @Get()
  list(@CurrentBoard() board: Board, @Param('taskId') taskId: string) {
    return this.comments.list(board, taskId);
  }

  @Perm('comment')
  @Post()
  create(
    @CurrentBoard() board: Board,
    @CurrentUser() user: PublicUser,
    @Param('taskId') taskId: string,
    @Body(new Zod(CommentInput)) body: CommentInput,
  ) {
    return this.comments.create(board, user, taskId, body.text);
  }

  @Perm('comment')
  @Patch(':commentId')
  update(
    @CurrentBoard() board: Board,
    @CurrentUser() user: PublicUser,
    @Param('commentId') id: string,
    @Body(new Zod(CommentInput)) body: CommentInput,
  ) {
    return this.comments.update(board, user, id, body.text);
  }

  @Perm('comment')
  @Delete(':commentId')
  @HttpCode(204)
  remove(@CurrentBoard() board: Board, @CurrentUser() user: PublicUser, @Param('commentId') id: string) {
    return this.comments.remove(board, user, id);
  }
}
