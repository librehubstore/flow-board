import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

/**
 * Diffusion des changements. Le serveur Socket.IO est attaché par RealtimeGateway au démarrage ;
 * sans lui (tests unitaires), les émissions sont ignorées.
 * ponytail: diffusion en mémoire, une seule instance ; adaptateur Socket.IO (Redis/Mongo) si plusieurs instances.
 */
@Injectable()
export class Realtime {
  server?: Server;

  toBoard(boardId: string, event: string, payload: unknown) {
    this.server?.to(`board:${boardId}`).emit(event, payload);
  }

  toUser(userId: string, event: string, payload: unknown) {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }

  /** Retire un utilisateur de la room d'un board (retiré du board) ou de toutes ses connexions (compte désactivé). */
  kick(userId: string, boardId?: string) {
    const sockets = this.server?.in(`user:${userId}`);
    if (boardId) sockets?.socketsLeave(`board:${boardId}`);
    else sockets?.disconnectSockets(true);
  }
}
