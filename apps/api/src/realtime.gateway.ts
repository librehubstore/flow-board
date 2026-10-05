import { OnGatewayConnection, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type { Server, Socket } from 'socket.io';
import { AuthService, SESSION_COOKIE } from './auth.service';
import { BoardsService } from './boards.service';
import type { PublicUser } from './db';
import { cookies } from './cookies';
import { Realtime } from './realtime.service';

const boardRoom = (id: string) => `board:${id}`;
const userRoom = (id: string) => `user:${id}`;

/**
 * Collaboration temps réel (spec § 4.2) : une room par board, une room par utilisateur (notifications).
 * Authentification par le cookie de session ; l'accès au board est revérifié à chaque `join`.
 */
@WebSocketGateway({ path: '/api/socket.io', serveClient: false })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer() server!: Server;

  constructor(
    private auth: AuthService,
    private boards: BoardsService,
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
      await socket.join(userRoom(found.user._id));
      return found.user;
    })();
  }

  @SubscribeMessage('join')
  async join(socket: Socket, boardId: string) {
    const user = (await socket.data.ready) as PublicUser | null;
    try {
      if (!user) throw new Error();
      await this.boards.access(String(boardId), user, 'board.view');
    } catch {
      return { ok: false };
    }
    for (const room of socket.rooms) if (room.startsWith('board:')) await socket.leave(room);
    await socket.join(boardRoom(boardId));
    return { ok: true };
  }
}
