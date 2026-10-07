import { Body, Controller, Delete, Param, Patch, Post, Put } from '@nestjs/common';
import {
  ColumnInput,
  CreateColumnInput,
  CreateSwimlaneInput,
  CustomFieldInput,
  DeleteWithDestinationInput,
  ReorderInput,
  SwimlaneInput,
} from '@flowboard/shared';
import { CurrentBoard, CurrentUser, Perm } from '../common/decorators';
import { Zod } from '../common/zod.pipe';
import type { PublicUser } from '../users/user.entity';
import type { Board } from './board.entity';
import { BoardStructureService } from './board-structure.service';

@Perm('board.structure')
@Controller('boards/:boardId')
export class BoardStructureController {
  constructor(private structure: BoardStructureService) {}

  // ---------- Colonnes ----------
  @Post('columns')
  addColumn(@CurrentBoard() board: Board, @Body(new Zod(CreateColumnInput)) body: ColumnInput) {
    return this.structure.addColumn(board, body);
  }

  @Put('columns/order')
  reorderColumns(@CurrentBoard() board: Board, @Body(new Zod(ReorderInput)) body: ReorderInput) {
    return this.structure.reorderColumns(board, body.ids);
  }

  @Patch('columns/:columnId')
  updateColumn(
    @CurrentBoard() board: Board,
    @Param('columnId') id: string,
    @Body(new Zod(ColumnInput)) body: ColumnInput,
  ) {
    return this.structure.updateColumn(board, id, body);
  }

  @Delete('columns/:columnId')
  removeColumn(
    @CurrentBoard() board: Board,
    @CurrentUser() user: PublicUser,
    @Param('columnId') id: string,
    @Body(new Zod(DeleteWithDestinationInput)) body: DeleteWithDestinationInput,
  ) {
    return this.structure.removeColumn(board, user, id, body.destinationId);
  }

  // ---------- Champs personnalisés ----------
  @Post('fields')
  addField(@CurrentBoard() board: Board, @Body(new Zod(CustomFieldInput)) body: CustomFieldInput) {
    return this.structure.addField(board, body);
  }

  @Patch('fields/:fieldId')
  updateField(
    @CurrentBoard() board: Board,
    @Param('fieldId') id: string,
    @Body(new Zod(CustomFieldInput)) body: CustomFieldInput,
  ) {
    return this.structure.updateField(board, id, body);
  }

  @Delete('fields/:fieldId')
  removeField(@CurrentBoard() board: Board, @Param('fieldId') id: string) {
    return this.structure.removeField(board, id);
  }

  // ---------- Swimlanes ----------
  @Post('swimlanes')
  addSwimlane(@CurrentBoard() board: Board, @Body(new Zod(CreateSwimlaneInput)) body: SwimlaneInput) {
    return this.structure.addSwimlane(board, body);
  }

  @Put('swimlanes/order')
  reorderSwimlanes(@CurrentBoard() board: Board, @Body(new Zod(ReorderInput)) body: ReorderInput) {
    return this.structure.reorderSwimlanes(board, body.ids);
  }

  @Patch('swimlanes/:laneId')
  updateSwimlane(
    @CurrentBoard() board: Board,
    @Param('laneId') id: string,
    @Body(new Zod(SwimlaneInput)) body: SwimlaneInput,
  ) {
    return this.structure.updateSwimlane(board, id, body);
  }

  @Delete('swimlanes/:laneId')
  removeSwimlane(
    @CurrentBoard() board: Board,
    @CurrentUser() user: PublicUser,
    @Param('laneId') id: string,
    @Body(new Zod(DeleteWithDestinationInput)) body: DeleteWithDestinationInput,
  ) {
    return this.structure.removeSwimlane(board, user, id, body.destinationId);
  }
}
