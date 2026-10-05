import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdminController } from './admin.controller';
import { AttachmentsController } from './attachments.controller';
import { CommentsController } from './comments.controller';
import { NotificationsService } from './notifications.service';
import { RealtimeGateway } from './realtime.gateway';
import { Realtime } from './realtime.service';
import { AuditService } from './audit.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';
import { Db } from './db';
import { AccessGuard } from './http';
import { SettingsService } from './settings.service';
import { TasksService } from './tasks.service';

@Module({
  controllers: [AuthController, AdminController, BoardsController, CommentsController, AttachmentsController],
  providers: [
    Db,
    Realtime,
    RealtimeGateway,
    NotificationsService,
    AuthService,
    AuditService,
    SettingsService,
    TasksService,
    BoardsService,
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
export class AppModule {}
