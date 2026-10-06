import { Controller, Get, Param, Query } from '@nestjs/common';
import { BoardEventsQuery } from '@flowboard/shared';
import type { Board } from '../boards/board.entity';
import { CurrentBoard, Perm } from '../common/decorators';
import { Zod } from '../common/zod.pipe';
import { TaskJournalService } from './task-journal.service';

/** Historique des révisions en lecture seule (spec § 4.9) : personne ne peut le modifier. */
@Controller('boards/:boardId')
export class JournalController {
  constructor(private journal: TaskJournalService) {}

  @Perm('board.view')
  @Get('events')
  board(@CurrentBoard() board: Board, @Query(new Zod(BoardEventsQuery)) q: BoardEventsQuery) {
    return this.journal.forBoard(board._id, q);
  }

  @Perm('board.view')
  @Get('tasks/:taskId/events')
  task(@CurrentBoard() board: Board, @Param('taskId') taskId: string) {
    return this.journal.forTask(board._id, taskId);
  }
}
