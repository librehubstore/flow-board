import { Body, Controller, Get, HttpCode, Patch, Post, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ChangePasswordInput,
  CollapseColumnInput,
  LoginInput,
  MarkReadInput,
  UpdateProfileInput,
} from '@flowboard/shared';
import { AuthService, hidePassword, SESSION_COOKIE } from './auth.service';
import { Db, PublicUser } from './db';
import { AllowPending, AuthedRequest, CurrentUser, Public, Zod } from './http';
import { SettingsService } from './settings.service';
import { NotificationsService } from './notifications.service';

@Controller()
export class AuthController {
  constructor(
    private auth: AuthService,
    private db: Db,
    private settings: SettingsService,
    private notifications: NotificationsService,
  ) {}

  @Public()
  @Post('auth/login')
  @HttpCode(200)
  async login(@Body(new Zod(LoginInput)) body: LoginInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { token, session } = await this.auth.login(body.username, body.password, req.ip ?? '', req.headers['user-agent'] ?? '');
    this.auth.setCookie(res, token, session.expiresAt);
    return this.me(session.userId);
  }

  @AllowPending()
  @Post('auth/logout')
  @HttpCode(204)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.sessionId);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @AllowPending()
  @Post('auth/password')
  @HttpCode(204)
  async changePassword(@Body(new Zod(ChangePasswordInput)) body: ChangePasswordInput, @Req() req: AuthedRequest) {
    await this.auth.changePassword(req.user._id, req.sessionId, body.currentPassword, body.newPassword);
  }

  @Public()
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Public()
  @Get('settings')
  getSettings() {
    return this.settings.get();
  }

  @AllowPending()
  @Get('me')
  getMe(@CurrentUser() user: PublicUser) {
    return user;
  }

  @Patch('me')
  async updateMe(@Body(new Zod(UpdateProfileInput)) body: UpdateProfileInput, @CurrentUser() user: PublicUser) {
    await this.db.users.updateOne({ _id: user._id }, { $set: body });
    return this.me(user._id);
  }

  /** État replié des colonnes, mémorisé par utilisateur (spec § 4.2). */
  @Put('me/collapsed-columns')
  @HttpCode(204)
  async collapse(@Body(new Zod(CollapseColumnInput)) body: CollapseColumnInput, @CurrentUser() user: PublicUser) {
    await this.db.users.updateOne(
      { _id: user._id },
      body.collapsed ? { $addToSet: { collapsedColumns: body.columnId } } : { $pull: { collapsedColumns: body.columnId } },
    );
  }

  /** Annuaire minimal pour choisir des membres (id, identifiant, nom). */
  @Get('users')
  users() {
    return this.db.users
      .find()
      .project({ username: 1, fullName: 1, status: 1 })
      .sort({ fullName: 1 })
      .toArray();
  }

  @Get('notifications')
  listNotifications(@CurrentUser() user: PublicUser) {
    return this.notifications.list(user._id);
  }

  /** Marque comme lues les notifications données, ou toutes si `ids` est absent. */
  @Post('notifications/read')
  @HttpCode(204)
  async markRead(@Body(new Zod(MarkReadInput)) body: MarkReadInput, @CurrentUser() user: PublicUser) {
    await this.notifications.markRead(user._id, body.ids);
  }

  private me(id: string) {
    return this.db.users.findOne({ _id: id }, hidePassword);
  }
}

