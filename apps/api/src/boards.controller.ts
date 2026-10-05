import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  ArchiveCompletedInput,
  ColumnInput,
  CreateBoardInput,
  CreateColumnInput,
  CreateSwimlaneInput,
  CreateTaskInput,
  DeleteBoardInput,
  DeleteWithDestinationInput,
  LabelInput,
  MemberInput,
  MoveTaskInput,
  ReorderInput,
  RoleInput,
  SwimlaneInput,
  TaskIdsInput,
  UpdateBoardInput,
  UpdateTaskInput,
} from '@flowboard/shared';
import { BoardsService } from './boards.service';
import { Board, Db, PublicUser } from './db';
import { CurrentBoard, CurrentUser, Perm, Zod } from './http';
import { SettingsService } from './settings.service';
import { TasksService } from './tasks.service';

@Controller('boards')
export class BoardsController {
  constructor(
    private boards: BoardsService,
    private tasks: TasksService,
    private settings: SettingsService,
    private db: Db,
  ) {}

  @Get()
  list(@CurrentUser() user: PublicUser) {
    return this.boards.listFor(user);
  }

  @Post()
  async create(@Body(new Zod(CreateBoardInput)) body: CreateBoardInput, @CurrentUser() user: PublicUser) {
    const locale = user.locale ?? (await this.settings.get()).defaultLocale;
    return this.boards.create(user, body.name, body.description, locale);
  }

  /** Board complet : structure, membres (avec nom), tâches non archivées, permissions de l'appelant. */
  @Perm('board.view')
  @Get(':boardId')
  async get(@CurrentBoard() board: Board, @CurrentUser() user: PublicUser) {
    const { role, permissions } = await this.boards.access(board._id, user, 'board.view');
    const users = await this.db.users
      .find({ _id: { $in: board.members.map((m) => m.userId) } })
      .project<{ _id: string; username: string; fullName: string; status: string }>({ username: 1, fullName: 1, status: 1 })
      .toArray();
    const members = board.members.map((m) => ({ ...m, ...users.find((u) => u._id === m.userId) }));
    return { board, members, role, permissions, tasks: await this.tasks.list(board._id, false) };
  }

  @Perm('board.structure')
  @Patch(':boardId')
  update(@CurrentBoard() board: Board, @Body(new Zod(UpdateBoardInput)) body: UpdateBoardInput) {
    return this.boards.update(board, body);
  }

  @Perm('board.structure')
  @Delete(':boardId')
  @HttpCode(204)
  remove(@CurrentBoard() board: Board, @CurrentUser() user: PublicUser, @Body(new Zod(DeleteBoardInput)) body: DeleteBoardInput) {
    return this.boards.remove(board, user, body.confirmName);
  }

  // ---------- Colonnes ----------
  @Perm('board.structure')
  @Post(':boardId/columns')
  addColumn(@CurrentBoard() board: Board, @Body(new Zod(CreateColumnInput)) body: ColumnInput) {
    return this.boards.addColumn(board, body);
  }

  @Perm('board.structure')
  @Put(':boardId/columns/order')
  reorderColumns(@CurrentBoard() board: Board, @Body(new Zod(ReorderInput)) body: ReorderInput) {
    return this.boards.reorderColumns(board, body.ids);
  }

  @Perm('board.structure')
  @Patch(':boardId/columns/:columnId')
  updateColumn(@CurrentBoard() board: Board, @Param('columnId') id: string, @Body(new Zod(ColumnInput)) body: ColumnInput) {
    return this.boards.updateColumn(board, id, body);
  }

  @Perm('board.structure')
  @Delete(':boardId/columns/:columnId')
  removeColumn(
    @CurrentBoard() board: Board,
    @CurrentUser() user: PublicUser,
    @Param('columnId') id: string,
    @Body(new Zod(DeleteWithDestinationInput)) body: DeleteWithDestinationInput,
  ) {
    return this.boards.removeColumn(board, user, id, body.destinationId);
  }

  // ---------- Swimlanes ----------
  @Perm('board.structure')
  @Post(':boardId/swimlanes')
  addSwimlane(@CurrentBoard() board: Board, @Body(new Zod(CreateSwimlaneInput)) body: SwimlaneInput) {
    return this.boards.addSwimlane(board, body);
  }

  @Perm('board.structure')
  @Put(':boardId/swimlanes/order')
  reorderSwimlanes(@CurrentBoard() board: Board, @Body(new Zod(ReorderInput)) body: ReorderInput) {
    return this.boards.reorderSwimlanes(board, body.ids);
  }

  @Perm('board.structure')
  @Patch(':boardId/swimlanes/:laneId')
  updateSwimlane(@CurrentBoard() board: Board, @Param('laneId') id: string, @Body(new Zod(SwimlaneInput)) body: SwimlaneInput) {
    return this.boards.updateSwimlane(board, id, body);
  }

  @Perm('board.structure')
  @Delete(':boardId/swimlanes/:laneId')
  removeSwimlane(
    @CurrentBoard() board: Board,
    @CurrentUser() user: PublicUser,
    @Param('laneId') id: string,
    @Body(new Zod(DeleteWithDestinationInput)) body: DeleteWithDestinationInput,
  ) {
    return this.boards.removeSwimlane(board, user, id, body.destinationId);
  }

  // ---------- Membres ----------
  @Perm('board.members')
  @Post(':boardId/members')
  addMember(@CurrentBoard() board: Board, @Body(new Zod(MemberInput)) body: MemberInput) {
    return this.boards.addMember(board, body.userId, body.role);
  }

  @Perm('board.members')
  @Patch(':boardId/members/:userId')
  setRole(@CurrentBoard() board: Board, @Param('userId') userId: string, @Body(new Zod(RoleInput)) body: RoleInput) {
    return this.boards.setRole(board, userId, body.role);
  }

  @Perm('board.members')
  @Delete(':boardId/members/:userId')
  removeMember(@CurrentBoard() board: Board, @Param('userId') userId: string) {
    return this.boards.removeMember(board, userId);
  }

  // ---------- Labels ----------
  /** Création à la volée ; renvoie le label existant si le nom est déjà pris (insensible à la casse). */
  @Perm('task.edit')
  @Post(':boardId/labels')
  addLabel(@CurrentBoard() board: Board, @Body(new Zod(LabelInput)) body: LabelInput) {
    return this.boards.addLabel(board, body.name);
  }

  // ---------- Tâches ----------
  @Perm('board.view')
  @Get(':boardId/tasks')
  tasksList(@CurrentBoard() board: Board, @Query('archived') archived?: string) {
    return this.tasks.list(board._id, archived === 'true');
  }

  @Perm('task.create')
  @Post(':boardId/tasks')
  createTask(@CurrentBoard() board: Board, @CurrentUser() user: PublicUser, @Body(new Zod(CreateTaskInput)) body: CreateTaskInput) {
    return this.tasks.create(board, user, body);
  }

  @Perm('task.edit')
  @Post(':boardId/tasks/archive')
  async archive(@CurrentBoard() board: Board, @CurrentUser() user: PublicUser, @Body(new Zod(TaskIdsInput)) body: TaskIdsInput) {
    return { archived: await this.tasks.archive(board, user, { _id: { $in: body.taskIds } }) };
  }

  /** « Archiver les tâches terminées avant le JJ/MM » sur la colonne de complétion. */
  @Perm('task.edit')
  @Post(':boardId/tasks/archive-completed')
  async archiveCompleted(
    @CurrentBoard() board: Board,
    @CurrentUser() user: PublicUser,
    @Body(new Zod(ArchiveCompletedInput)) body: ArchiveCompletedInput,
  ) {
    const filter = { columnId: board.completionColumnId, completedAt: { $lt: body.before } };
    return { archived: await this.tasks.archive(board, user, filter) };
  }

  @Perm('task.edit')
  @Patch(':boardId/tasks/:taskId')
  updateTask(
    @CurrentBoard() board: Board,
    @CurrentUser() user: PublicUser,
    @Param('taskId') id: string,
    @Body(new Zod(UpdateTaskInput)) body: UpdateTaskInput,
  ) {
    return this.tasks.update(board, user, id, body);
  }

  @Perm('task.move')
  @Post(':boardId/tasks/:taskId/move')
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
  @Post(':boardId/tasks/:taskId/restore')
  @HttpCode(200)
  restore(@CurrentBoard() board: Board, @CurrentUser() user: PublicUser, @Param('taskId') id: string) {
    return this.tasks.restore(board, user, id);
  }

  @Perm('task.delete')
  @Delete(':boardId/tasks/:taskId')
  @HttpCode(204)
  removeTask(@CurrentBoard() board: Board, @CurrentUser() user: PublicUser, @Param('taskId') id: string) {
    return this.tasks.remove(board, user, id);
  }
}
