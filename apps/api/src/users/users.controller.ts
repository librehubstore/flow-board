import { Body, Controller, Get, HttpCode, Param, Patch, Put } from '@nestjs/common';
import {
  BoardFilter,
  CollapseColumnInput,
  isFilterActive,
  UpdateProfileInput,
  WatchColumnInput,
} from '@flowboard/shared';
import { AllowPending, CurrentUser } from '../common/decorators';
import { fail } from '../common/errors';
import { Zod } from '../common/zod.pipe';
import type { PublicUser } from './user.entity';
import { UsersService } from './users.service';

@Controller()
export class UsersController {
  constructor(private users: UsersService) {}

  @AllowPending()
  @Get('me')
  me(@CurrentUser() user: PublicUser) {
    return user;
  }

  @Patch('me')
  updateMe(@Body(new Zod(UpdateProfileInput)) body: UpdateProfileInput, @CurrentUser() user: PublicUser) {
    return this.users.updateProfile(user._id, body);
  }

  @Put('me/collapsed-columns')
  @HttpCode(204)
  collapse(@Body(new Zod(CollapseColumnInput)) body: CollapseColumnInput, @CurrentUser() user: PublicUser) {
    return this.users.setCollapsed(user._id, body.columnId, body.collapsed);
  }

  @Put('me/watched-columns')
  @HttpCode(204)
  watch(@Body(new Zod(WatchColumnInput)) body: WatchColumnInput, @CurrentUser() user: PublicUser) {
    return this.users.setWatched(user._id, body.columnId, body.watched);
  }

  @Put('me/board-filters/:boardId')
  @HttpCode(204)
  setBoardFilter(
    @Param('boardId') boardId: string,
    @Body(new Zod(BoardFilter)) body: BoardFilter,
    @CurrentUser() user: PublicUser,
  ) {
    // L'identifiant devient un chemin de champ Mongo : pas de « . » ni de « $ ».
    if (!/^[\w-]{1,64}$/.test(boardId)) fail(400, 'VALIDATION');
    return this.users.setBoardFilter(user._id, boardId, isFilterActive(body) ? body : null);
  }

  @Get('users')
  directory() {
    return this.users.directory();
  }
}
