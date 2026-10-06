import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { DueRemindersService } from './due-reminders.service';
import { JournalController } from './journal.controller';
import { RecurrenceService } from './recurrence.service';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { TaskJournalService } from './task-journal.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [RealtimeModule, NotificationsModule],
  controllers: [TasksController, SearchController, JournalController],
  providers: [TasksService, TaskJournalService, DueRemindersService, RecurrenceService, SearchService],
  exports: [TasksService, TaskJournalService],
})
export class TasksModule {}
