import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { CSRF_HEADER, type Permission } from '@flowboard/shared';
import { BoardAccessService } from '../board-access/board-access.service';
import { cookies } from '../common/cookies';
import { ADMIN, ALLOW_PENDING, PERM, PUBLIC, type AuthedRequest } from '../common/decorators';
import { fail } from '../common/errors';
import { AuthService, SESSION_COOKIE } from './auth.service';

/** Garde globale : CSRF, session, changement de mot de passe forcé, rôle admin, permission de board. */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private auth: AuthService,
    private boards: BoardAccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const meta = <T>(key: string) =>
      this.reflector.getAllAndOverride<T>(key, [ctx.getHandler(), ctx.getClass()]);

    // CSRF : un formulaire ou une requête cross-site ne peut pas poser d'en-tête personnalisé sans préflight CORS (refusé).
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers[CSRF_HEADER] !== '1')
      fail(403, 'CSRF');
    if (meta<boolean>(PUBLIC)) return true;

    const token = cookies(req)[SESSION_COOKIE];
    const found = token ? await this.auth.resolveSession(token) : null;
    if (!found) fail(401, 'UNAUTHENTICATED');
    if (found.extended) this.auth.setCookie(res, token!, found.session.expiresAt);
    req.user = found.user;
    req.sessionId = found.session._id;

    if (found.user.mustChangePassword && !meta<boolean>(ALLOW_PENDING)) fail(403, 'MUST_CHANGE_PASSWORD');
    if (meta<boolean>(ADMIN) && found.user.globalRole !== 'admin') fail(403, 'FORBIDDEN');
    const perm = meta<Permission>(PERM);
    if (perm) req.board = (await this.boards.access(req.params.boardId as string, found.user, perm)).board;
    return true;
  }
}
