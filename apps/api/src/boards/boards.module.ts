import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BoardAccessModule } from '../board-access/board-access.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SettingsModule } from '../settings/settings.module';
import { TasksModule } from '../tasks/tasks.module';
import { AdminBoardsController } from './admin-boards.controller';
import { BoardMembersController } from './board-members.controller';
import { BoardMembersService } from './board-members.service';
import { BoardStructureController } from './board-structure.controller';
import { BoardStructureService } from './board-structure.service';
import { BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';

@Module({
  imports: [TasksModule, RealtimeModule, AuditModule, SettingsModule, BoardAccessModule],
  controllers: [BoardsController, BoardStructureController, BoardMembersController, AdminBoardsController],
  providers: [BoardsService, BoardStructureService, BoardMembersService],
})
export class BoardsModule {}
