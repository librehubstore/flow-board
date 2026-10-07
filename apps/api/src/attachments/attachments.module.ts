import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { TasksModule } from '../tasks/tasks.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';

@Module({
  imports: [TasksModule, SettingsModule],
  controllers: [AttachmentsController],
  providers: [AttachmentsService],
})
export class AttachmentsModule {}
