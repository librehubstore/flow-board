import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ArchiveCompletedInput,
  DuplicateTaskInput,
  CreateTaskInput,
  MoveTaskInput,
  TaskIdsInput,
  UpdateTaskInput,
} from '@flowboard/shared';
import type { Board } from '../boards/board.entity';
import { CurrentBoard, CurrentUser, Perm } from '../common/decorators';
import { Zod } from '../common/zod.pipe';
import type { PublicUser } from '../users/user.entity';
import { TasksService } from './tasks.service';

@Controller('boards/:boardId/tasks')
export class TasksController {
  constructor(private tasks: TasksService) {}

  @Perm('board.view')
  @Get()
  list(@CurrentBoard() board: Board, @Query('archived') archived?: string) {
    return this.tasks.list(board._id, archived === 'true');
  }

  @Perm('task.create')
  @Post()
  create(
    @CurrentBoard() board: Board,
    @CurrentUser() user: PublicUser,
    @Body(new Zod(CreateTaskInput)) body: CreateTaskInput,
  ) {
    return this.tasks.create(board, user, body);
  }

  @Perm('task.edit')
  @Post('archive')
  async archive(
    @CurrentBoard() board: Board,
    @CurrentUser() user: PublicUser,
    @Body(new Zod(TaskIdsInput)) body: TaskIdsInput,
  ) {
    return { archived: await this.tasks.archive(board, user, { _id: { $in: body.taskIds } }) };
  }

  /** « Archiver les tâches terminées avant le JJ/MM » sur la colonne de complétion. */
  @Perm('task.edit')
  @Post('archive-completed')
  async archiveCompleted(
    @CurrentBoard() board: Board,
    @CurrentUser() user: PublicUser,
    @Body(new Zod(ArchiveCompletedInput)) body: ArchiveCompletedInput,
  ) {
    const filter = { columnId: board.completionColumnId, completedAt: { $lt: body.before } };
    return { archived: await this.tasks.archive(board, user, filter) };
  }

  @Perm('task.edit')
  @Patch(':taskId')
  update(
    @CurrentBoard() board: Board,
    @CurrentUser() user: PublicUser,
    @Param('taskId') id: string,
    @Body(new Zod(UpdateTaskInput)) body: UpdateTaskInput,
  ) {
    return this.tasks.update(board, user, id, body);
  }

  @Perm('task.move')
  @Post(':taskId/move')
  @HttpCode(200)
  move(
    @CurrentBoard() board: Board,
    @CurrentUser() user: PublicUser,
    @Param('taskId') id: string,
    @Body(new Zod(MoveTaskInput)) body: MoveTaskInput,
  ) {
    return this.tasks.move(board, user, id, body);
  }

  @Perm('task.edit')
  @Post(':taskId/restore')
  @HttpCode(200)
  restore(@CurrentBoard() board: Board, @CurrentUser() user: PublicUser, @Param('taskId') id: string) {
    return this.tasks.restore(board, user, id);
  }

  @Perm('task.create')
  @Post(':taskId/duplicate')
  duplicate(
    @CurrentBoard() board: Board,
    @CurrentUser() user: PublicUser,
    @Param('taskId') id: string,
    @Body(new Zod(DuplicateTaskInput)) body: DuplicateTaskInput,
  ) {
    return this.tasks.duplicate(board, user, id, body.name);
  }

  @Perm('task.delete')
  @Delete(':taskId')
  @HttpCode(204)
  remove(@CurrentBoard() board: Board, @CurrentUser() user: PublicUser, @Param('taskId') id: string) {
    return this.tasks.remove(board, user, id);
  }
}
