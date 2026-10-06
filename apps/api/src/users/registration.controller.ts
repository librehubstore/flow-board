import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { RegisterInput, ResendVerificationInput, VerifyEmailInput } from '@flowboard/shared';
import { AuthService } from '../auth/auth.service';
import { cookies } from '../common/cookies';
import { Public } from '../common/decorators';
import { Zod } from '../common/zod.pipe';
import { config } from '../config/config';
import { Db } from '../database/db.service';
import { hidePassword } from './user.entity';
import { OAUTH_COOKIE, RegistrationService } from './registration.service';

const oauthCookie = {
  httpOnly: true,
  secure: config.COOKIE_SECURE,
  sameSite: 'lax' as const,
  path: '/api/auth/google',
};

@Public()
@Controller('auth')
export class RegistrationController {
  constructor(
    private registration: RegistrationService,
    private auth: AuthService,
    private db: Db,
  ) {}

  /** 202 dans tous les cas où l'inscription est ouverte : on ne révèle pas si l'email a déjà un compte. */
  @Post('register')
  @HttpCode(202)
  async register(@Body() body: unknown, @Req() req: Request) {
    // Mode d'onboarding vérifié avant la validation : inscription fermée = route inexistante (404), quel que soit le corps.
    await this.registration.assertOpen();
    await this.registration.register(new Zod(RegisterInput).transform(body), req.ip ?? '');
    return { status: 'pending' };
  }

  @Post('resend-verification')
  @HttpCode(202)
  async resend(@Body(new Zod(ResendVerificationInput)) body: { email: string }, @Req() req: Request) {
    await this.registration.resend(body.email, req.ip ?? '');
    return { status: 'pending' };
  }

  @Post('verify-email')
  @HttpCode(200)
  async verify(
    @Body(new Zod(VerifyEmailInput)) body: { token: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, session } = await this.registration.verify(
      body.token,
      req.ip ?? '',
      req.headers['user-agent'] ?? '',
    );
    this.auth.setCookie(res, token, session.expiresAt);
    return this.db.users.findOne({ _id: session.userId }, hidePassword);
  }

  @Get('google')
  async google(@Res() res: Response) {
    const { url, cookie } = await this.registration.googleStart();
    res.cookie(OAUTH_COOKIE, cookie, { ...oauthCookie, maxAge: 10 * 60_000 });
    res.redirect(url);
  }

  /** Retour de Google : session et redirection vers l'application, ou vers l'écran de connexion avec un code d'erreur. */
  @Get('google/callback')
  async googleCallback(
    @Query() q: { code?: string; state?: string; error?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await this.registration.googleCallback(
      { code: q.code, state: q.state, error: q.error },
      cookies(req)[OAUTH_COOKIE],
      req.ip ?? '',
      req.headers['user-agent'] ?? '',
    );
    res.clearCookie(OAUTH_COOKIE, oauthCookie);
    if ('error' in result) return res.redirect(`${config.APP_URL}/?auth_error=${result.error}`);
    this.auth.setCookie(res, result.token, result.session.expiresAt);
    res.redirect(`${config.APP_URL}/`);
  }
}
