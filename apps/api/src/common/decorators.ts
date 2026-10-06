import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Permission } from '@flowboard/shared';
import type { Board } from '../boards/board.entity';
import type { PublicUser } from '../users/user.entity';

export interface AuthedRequest extends Request {
  user: PublicUser;
  sessionId: string;
  board: Board;
}

export const PUBLIC = 'public';
export const ALLOW_PENDING = 'allowPending';
export const ADMIN = 'admin';
export const PERM = 'perm';

export const Public = () => SetMetadata(PUBLIC, true);
/** Route accessible même si l'utilisateur doit changer son mot de passe. */
export const AllowPending = () => SetMetadata(ALLOW_PENDING, true);
export const AdminOnly = () => SetMetadata(ADMIN, true);
/** Exige une permission sur le board désigné par le paramètre de route `:boardId`. */
export const Perm = (p: Permission) => SetMetadata(PERM, p);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().user,
);
export const CurrentBoard = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().board,
);
