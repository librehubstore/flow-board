import {
  BadRequestException,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  PipeTransform,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { ZodType } from 'zod';
import { CSRF_HEADER, type Permission } from '@flowboard/shared';
import type { Board, PublicUser } from './db';
import { AuthService, SESSION_COOKIE } from './auth.service';
import { BoardsService } from './boards.service';
import { fail } from './errors';
import { cookies } from './cookies';

export { fail };

export class Zod<T> implements PipeTransform {
  constructor(private schema: ZodType<T>) {}
  transform(value: unknown): T {
    const r = this.schema.safeParse(value);
    if (!r.success) throw new BadRequestException({ code: 'VALIDATION', message: 'Validation', issues: r.error.issues });
    return r.data;
  }
}

export interface AuthedRequest extends Request {
  user: PublicUser;
  sessionId: string;
  board: Board;
}

const PUBLIC = 'public';
const ALLOW_PENDING = 'allowPending';
const ADMIN = 'admin';
const PERM = 'perm';
export const Public = () => SetMetadata(PUBLIC, true);
/** Route accessible même si l'utilisateur doit changer son mot de passe. */
export const AllowPending = () => SetMetadata(ALLOW_PENDING, true);
export const AdminOnly = () => SetMetadata(ADMIN, true);
/** Exige une permission sur le board désigné par le paramètre de route `:boardId`. */
export const Perm = (p: Permission) => SetMetadata(PERM, p);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().user);
export const CurrentBoard = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().board);

/** Garde globale : CSRF, session, changement de mot de passe forcé, rôle admin, permission de board. */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private auth: AuthService,
    private boards: BoardsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const meta = <T>(key: string) => this.reflector.getAllAndOverride<T>(key, [ctx.getHandler(), ctx.getClass()]);

    // CSRF : un formulaire ou une requête cross-site ne peut pas poser d'en-tête personnalisé sans préflight CORS (refusé).
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers[CSRF_HEADER] !== '1') fail(403, 'CSRF');
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
