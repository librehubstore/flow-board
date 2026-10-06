import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import { MemberInput, RoleInput } from '@flowboard/shared';
import { CurrentBoard, Perm } from '../common/decorators';
import { Zod } from '../common/zod.pipe';
import type { Board } from './board.entity';
import { BoardMembersService } from './board-members.service';

@Perm('board.members')
@Controller('boards/:boardId/members')
export class BoardMembersController {
  constructor(private members: BoardMembersService) {}

  @Post()
  add(@CurrentBoard() board: Board, @Body(new Zod(MemberInput)) body: MemberInput) {
    return this.members.add(board, body.userId, body.role);
  }

  @Patch(':userId')
  setRole(
    @CurrentBoard() board: Board,
    @Param('userId') userId: string,
    @Body(new Zod(RoleInput)) body: RoleInput,
  ) {
    return this.members.setRole(board, userId, body.role);
  }

  @Delete(':userId')
  remove(@CurrentBoard() board: Board, @Param('userId') userId: string) {
    return this.members.remove(board, userId);
  }
}
