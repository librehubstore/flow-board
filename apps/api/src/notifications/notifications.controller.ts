import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { MarkReadInput } from '@flowboard/shared';
import { CurrentUser } from '../common/decorators';
import { Zod } from '../common/zod.pipe';
import type { PublicUser } from '../users/user.entity';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: PublicUser) {
    return this.notifications.list(user._id);
  }

  /** Marque comme lues les notifications données, ou toutes si `ids` est absent. */
  @Post('read')
  @HttpCode(204)
  markRead(@Body(new Zod(MarkReadInput)) body: MarkReadInput, @CurrentUser() user: PublicUser) {
    return this.notifications.markRead(user._id, body.ids);
  }
}
