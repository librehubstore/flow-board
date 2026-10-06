import { Body, Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import {
  CopyBoardInput,
  CreateBoardInput,
  DeleteBoardInput,
  LabelInput,
  UpdateBoardInput,
} from '@flowboard/shared';
import { BoardAccessService } from '../board-access/board-access.service';
import { CurrentBoard, CurrentUser, Perm } from '../common/decorators';
import { Zod } from '../common/zod.pipe';
import { SettingsService } from '../settings/settings.service';
import type { PublicUser } from '../users/user.entity';
import type { Board } from './board.entity';
import { BoardsService } from './boards.service';

@Controller('boards')
export class BoardsController {
  constructor(
    private boards: BoardsService,
    private access: BoardAccessService,
    private settings: SettingsService,
  ) {}

  @Get()
  list(@CurrentUser() user: PublicUser) {
    return this.boards.listFor(user);
  }

  @Post()
  async create(@Body(new Zod(CreateBoardInput)) body: CreateBoardInput, @CurrentUser() user: PublicUser) {
    if (body.templateId)
      return this.boards.createFromTemplate(user, body.templateId, body.name, body.description);
    const locale = user.locale ?? (await this.settings.get()).defaultLocale;
    return this.boards.create(user, body.name, body.description, locale);
  }

  /** Déclarée avant `:boardId` : « templates » n'est pas un identifiant de board. */
  @Get('templates')
  templates() {
    return this.boards.listTemplates();
  }

  /** Board complet + rôle et permissions de l'appelant (l'interface adapte ses actions). */
  @Perm('board.view')
  @Get(':boardId')
  async get(@CurrentBoard() board: Board, @CurrentUser() user: PublicUser) {
    const { role, permissions } = await this.access.access(board._id, user, 'board.view');
    return { ...(await this.boards.view(board)), role, permissions };
  }

  @Perm('board.structure')
  @Patch(':boardId')
  update(@CurrentBoard() board: Board, @Body(new Zod(UpdateBoardInput)) body: UpdateBoardInput) {
    return this.boards.update(board, body);
  }

  @Perm('board.structure')
  @Delete(':boardId')
  @HttpCode(204)
  remove(
    @CurrentBoard() board: Board,
    @CurrentUser() user: PublicUser,
    @Body(new Zod(DeleteBoardInput)) body: DeleteBoardInput,
  ) {
    return this.boards.remove(board, user, body.confirmName);
  }

  @Perm('board.view')
  @Post(':boardId/copy')
  copy(
    @CurrentBoard() board: Board,
    @CurrentUser() user: PublicUser,
    @Body(new Zod(CopyBoardInput)) body: CopyBoardInput,
  ) {
    return this.boards.copy(board, user, body.name, body.withTasks);
  }

  @Perm('task.edit')
  @Post(':boardId/labels')
  addLabel(@CurrentBoard() board: Board, @Body(new Zod(LabelInput)) body: LabelInput) {
    return this.boards.addLabel(board, body.name);
  }
}
