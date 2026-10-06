import { OnGatewayConnection, OnGatewayInit, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type { Server, Socket } from 'socket.io';
import { AuthService, SESSION_COOKIE } from '../auth/auth.service';
import { BoardAccessService } from '../board-access/board-access.service';
import { cookies } from '../common/cookies';
import type { PublicUser } from '../users/user.entity';
import { Realtime } from './realtime.service';

/**
 * Collaboration temps réel (spec § 4.2) : une room par board, une room par utilisateur (notifications).
 * Authentification par le cookie de session ; l'accès au board est revérifié à chaque `join`.
 */
@WebSocketGateway({ path: '/api/socket.io', serveClient: false })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  constructor(
    private auth: AuthService,
    private access: BoardAccessService,
    private realtime: Realtime,
  ) {}

  afterInit(server: Server) {
    this.realtime.server = server;
  }

  handleConnection(socket: Socket) {
    // Promesse mémorisée : un `join` reçu pendant la vérification de session l'attend.
    socket.data.ready = (async () => {
      const token = cookies(socket.request as IncomingMessage)[SESSION_COOKIE];
      const found = token ? await this.auth.resolveSession(token) : null;
      if (!found || found.user.mustChangePassword) {
        socket.disconnect(true);
        return null;
      }
      await socket.join(`user:${found.user._id}`);
      return found.user;
    })().catch(() => {
      socket.disconnect(true);
      return null;
    });
  }

  @SubscribeMessage('join')
  async join(socket: Socket, boardId: string) {
    const user = (await socket.data.ready) as PublicUser | null;
    try {
      if (!user) throw new Error('unauthenticated');
      await this.access.access(String(boardId), user, 'board.view');
    } catch {
      return { ok: false };
    }
    for (const room of socket.rooms) if (room.startsWith('board:')) await socket.leave(room);
    await socket.join(`board:${boardId}`);
    return { ok: true };
  }
}
