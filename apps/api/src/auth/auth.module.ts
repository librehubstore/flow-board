import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { BoardAccessModule } from '../board-access/board-access.module';
import { AccessGuard } from './access.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/** Authentification + garde globale : toute route est protégée sauf celles marquées `@Public()`. */
@Module({
  imports: [BoardAccessModule],
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: AccessGuard }],
  exports: [AuthService],
})
export class AuthModule {}
