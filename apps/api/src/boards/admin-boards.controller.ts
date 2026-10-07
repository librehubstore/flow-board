import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { TransferInput } from '@flowboard/shared';
import { AdminOnly, CurrentUser } from '../common/decorators';
import { Zod } from '../common/zod.pipe';
import type { PublicUser } from '../users/user.entity';
import { BoardMembersService } from './board-members.service';
import { BoardsService } from './boards.service';

/** Vue admin de tous les boards, corbeille et transfert de propriété (spec § 4.11). */
@AdminOnly()
@Controller('admin/boards')
export class AdminBoardsController {
  constructor(
    private boards: BoardsService,
    private members: BoardMembersService,
  ) {}

  @Get()
  list() {
    return this.boards.listAll();
  }

  @Post(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() actor: PublicUser) {
    return this.boards.restore(actor, id);
  }

  @Post(':id/transfer')
  transfer(
    @Param('id') id: string,
    @Body(new Zod(TransferInput)) body: TransferInput,
    @CurrentUser() actor: PublicUser,
  ) {
    return this.members.transfer(actor, id, body.userId);
  }
}
