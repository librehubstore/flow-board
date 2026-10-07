import { Module } from '@nestjs/common';
import { BoardAccessService } from './board-access.service';

@Module({ providers: [BoardAccessService], exports: [BoardAccessService] })
export class BoardAccessModule {}
