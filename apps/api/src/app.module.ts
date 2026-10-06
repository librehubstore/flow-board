import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AttachmentsModule } from './attachments/attachments.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BoardsModule } from './boards/boards.module';
import { CommentsModule } from './comments/comments.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { NotificationsModule } from './notifications/notifications.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ReportsModule } from './reports/reports.module';
import { RolesModule } from './roles/roles.module';
import { SettingsModule } from './settings/settings.module';
import { TasksModule } from './tasks/tasks.module';
import { TimeModule } from './time/time.module';
import { UsersModule } from './users/users.module';

/**
 * Graphe des modules (sans cycle) :
 * database (global) ← board-access ← auth ← realtime ← notifications ← tasks ← boards / comments / attachments
 * Les suppressions en cascade remontent par événements (`task.deleted`, `board.purged`).
 */
@Module({
  imports: [
    EventEmitterModule.forRoot(),
    DatabaseModule,
    AuthModule,
    UsersModule,
    AuditModule,
    SettingsModule,
    RealtimeModule,
    NotificationsModule,
    BoardsModule,
    TasksModule,
    CommentsModule,
    AttachmentsModule,
    TimeModule,
    ReportsModule,
    RolesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
