import { Module } from '@nestjs/common';
import { BoardAccessModule } from '../board-access/board-access.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { TasksModule } from '../tasks/tasks.module';
import { TimeController } from './time.controller';
import { TimeService } from './time.service';

@Module({
  imports: [BoardAccessModule, TasksModule, RealtimeModule],
  controllers: [TimeController],
  providers: [TimeService],
})
export class TimeModule {}
