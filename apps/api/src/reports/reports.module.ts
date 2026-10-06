import { Module } from '@nestjs/common';
import { BoardAccessModule } from '../board-access/board-access.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({ imports: [BoardAccessModule], controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
