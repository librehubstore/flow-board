import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  InterruptInput,
  ManualTimeInput,
  StartTimerInput,
  SwitchTaskInput,
  UpdateTimeEntryInput,
} from '@flowboard/shared';
import { CurrentUser, Perm } from '../common/decorators';
import { Zod } from '../common/zod.pipe';
import type { PublicUser } from '../users/user.entity';
import { TimeService } from './time.service';

@Controller()
export class TimeController {
  constructor(private time: TimeService) {}

  // ---------- Minuteur global (un seul par utilisateur) ----------
  @Get('timer')
  state(@CurrentUser() user: PublicUser) {
    return this.time.state(user);
  }

  @Post('timer/start')
  @HttpCode(200)
  start(@CurrentUser() user: PublicUser, @Body(new Zod(StartTimerInput)) body: StartTimerInput) {
    return this.time.start(user, body.kind, body.taskId);
  }

  @Post('timer/switch')
  @HttpCode(200)
  switchTask(@CurrentUser() user: PublicUser, @Body(new Zod(SwitchTaskInput)) body: SwitchTaskInput) {
    return this.time.switchTask(user, body.taskId);
  }

  @Post('timer/stop')
  @HttpCode(200)
  stop(@CurrentUser() user: PublicUser) {
    return this.time.stop(user);
  }

  @Post('timer/interrupt')
  @HttpCode(200)
  interrupt(@CurrentUser() user: PublicUser, @Body(new Zod(InterruptInput)) body: InterruptInput) {
    return this.time.interrupt(user, body);
  }

  // ---------- Entrées de temps ----------
  @Post('time-entries')
  addManual(@CurrentUser() user: PublicUser, @Body(new Zod(ManualTimeInput)) body: ManualTimeInput) {
    return this.time.addManual(user, body);
  }

  @Get('time-entries/labels')
  labels(@CurrentUser() user: PublicUser) {
    return this.time.labels(user);
  }

  @Patch('time-entries/:id')
  update(
    @CurrentUser() user: PublicUser,
    @Param('id') id: string,
    @Body(new Zod(UpdateTimeEntryInput)) body: UpdateTimeEntryInput,
  ) {
    return this.time.update(user, id, body);
  }

  @Delete('time-entries/:id')
  @HttpCode(204)
  remove(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    return this.time.remove(user, id);
  }

  @Perm('board.view')
  @Get('boards/:boardId/tasks/:taskId/time-entries')
  listForTask(
    @CurrentUser() user: PublicUser,
    @Param('boardId') boardId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.time.listForTask(user, boardId, taskId);
  }
}
