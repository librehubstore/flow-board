import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { TimeReportQuery } from '@flowboard/shared';
import type { Board } from '../boards/board.entity';
import { CurrentBoard, CurrentUser, Perm } from '../common/decorators';
import { Zod } from '../common/zod.pipe';
import type { PublicUser } from '../users/user.entity';
import { ReportsService } from './reports.service';

const sendCsv = (res: Response, filename: string, csv: string) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
};

@Controller()
export class ReportsController {
  constructor(private reports: ReportsService) {}

  @Get('reports/time')
  async time(
    @CurrentUser() user: PublicUser,
    @Query(new Zod(TimeReportQuery)) q: TimeReportQuery,
    @Res() res: Response,
  ) {
    if (q.format === 'csv')
      return sendCsv(res, `temps-${q.groupBy}.csv`, await this.reports.timeCsv(user, q));
    res.json(await this.reports.time(user, q));
  }

  @Perm('board.view')
  @Get('boards/:boardId/export.csv')
  @Header('Cache-Control', 'no-store')
  async boardCsv(@CurrentBoard() board: Board, @Res() res: Response) {
    sendCsv(res, `taches-${board._id.slice(0, 8)}.csv`, await this.reports.boardCsv(board._id));
  }
}
