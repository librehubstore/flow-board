import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

/** Connexion Socket.IO unique, authentifiée par le cookie de session (même origine). */
export function getSocket(): Socket {
  socket ??= io({ path: '/api/socket.io', transports: ['websocket'], withCredentials: true });
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
}
