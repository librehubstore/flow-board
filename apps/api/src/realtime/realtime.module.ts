import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BoardAccessModule } from '../board-access/board-access.module';
import { RealtimeGateway } from './realtime.gateway';
import { Realtime } from './realtime.service';

@Module({
  imports: [AuthModule, BoardAccessModule],
  providers: [Realtime, RealtimeGateway],
  exports: [Realtime],
})
export class RealtimeModule {}
