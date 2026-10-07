import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ChangePasswordInput, LoginInput } from '@flowboard/shared';
import { AllowPending, Public, type AuthedRequest } from '../common/decorators';
import { Zod } from '../common/zod.pipe';
import { Db } from '../database/db.service';
import { hidePassword } from '../users/user.entity';
import { AuthService, SESSION_COOKIE } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private db: Db,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new Zod(LoginInput)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, session } = await this.auth.login(
      body.username,
      body.password,
      req.ip ?? '',
      req.headers['user-agent'] ?? '',
    );
    this.auth.setCookie(res, token, session.expiresAt);
    return this.db.users.findOne({ _id: session.userId }, hidePassword);
  }

  @AllowPending()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.sessionId);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @AllowPending()
  @Post('password')
  @HttpCode(204)
  async changePassword(
    @Body(new Zod(ChangePasswordInput)) body: ChangePasswordInput,
    @Req() req: AuthedRequest,
  ) {
    await this.auth.changePassword(req.user._id, req.sessionId, body.currentPassword, body.newPassword);
  }
}
