import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SettingsModule } from '../settings/settings.module';
import { AdminUsersController } from './admin-users.controller';
import { RegistrationController } from './registration.controller';
import { RegistrationService } from './registration.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule, AuditModule, RealtimeModule, SettingsModule, MailModule],
  controllers: [UsersController, AdminUsersController, RegistrationController],
  providers: [UsersService, RegistrationService],
})
export class UsersModule {}
