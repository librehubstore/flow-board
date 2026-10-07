import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { TasksModule } from '../tasks/tasks.module';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';

@Module({
  imports: [TasksModule, NotificationsModule, RealtimeModule],
  controllers: [CommentsController],
  providers: [CommentsService],
})
export class CommentsModule {}
