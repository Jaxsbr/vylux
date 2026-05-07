// Signaling server for Phase 2.1 — the boring infrastructure that lets
// two browser tabs find each other and exchange WebRTC SDP + ICE.
//
// Per the investigation doc this is "the cheapest possible glue" — a
// single `ws` server that pairs clients by 6-character room code and
// blindly relays signal payloads. It does not understand WebRTC, does
// not own match state, does not log anything that could fingerprint
// players. Once the datachannel opens, this process is dormant for the
// duration of the match.
//
// Deployable to any Node.js free-tier (Render / Fly / Railway). All the
// network code is here; tools/signaling-server.ts is a thin CLI entry
// that just calls startSignalingServer() with port + host from env.
//
// Tested against real `ws` clients on a random port in
// signaling-server.test.ts — that's the gate that proves room pairing
// + relay + disconnect notification work end-to-end.

import { WebSocketServer, type WebSocket } from 'ws';
import {
  isValidRoomCode,
  type ClientMessage,
  type ErrorCode,
  type Role,
  type ServerMessage,
} from './signaling-protocol';

interface RoomMember {
  socket: WebSocket;
  role: Role;
}

interface Room {
  host?: RoomMember;
  join?: RoomMember;
}

export interface StartedSignalingServer {
  readonly port: number;
  readonly roomCount: number;
  close(): Promise<void>;
}

export interface StartSignalingServerOptions {
  port?: number;
  host?: string;
  // Optional log sink. Defaults to console.log; tests pass a noop.
  log?: (line: string) => void;
}

export function startSignalingServer(
  opts: StartSignalingServerOptions = {},
): Promise<StartedSignalingServer> {
  const log = opts.log ?? ((line) => console.log(`[signaling] ${line}`));
  const rooms = new Map<string, Room>();

  // Reverse lookup so a closing socket can be removed from its room
  // without scanning every room. The signaling server is small enough
  // that scanning would be fine, but lookups beat scans for clarity.
  const memberRoom = new WeakMap<WebSocket, { code: string; role: Role }>();

  const wss = new WebSocketServer({
    port: opts.port ?? 0,
    host: opts.host,
  });

  wss.on('connection', (socket) => {
    socket.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        sendError(socket, 'bad-message', 'invalid JSON');
        return;
      }

      if (msg === null || typeof msg !== 'object' || typeof msg.kind !== 'string') {
        sendError(socket, 'bad-message', 'malformed message');
        return;
      }

      switch (msg.kind) {
        case 'join':
          handleJoin(socket, msg.room, msg.role);
          return;
        case 'signal':
          handleSignal(socket, msg);
          return;
        default:
          sendError(socket, 'bad-message', `unknown message kind: ${(msg as { kind: string }).kind}`);
      }
    });

    socket.on('close', () => handleClose(socket));
  });

  function handleJoin(socket: WebSocket, code: string, role: Role): void {
    if (typeof code !== 'string' || !isValidRoomCode(code)) {
      sendError(socket, 'bad-message', 'invalid room code');
      return;
    }
    if (role !== 'host' && role !== 'join') {
      sendError(socket, 'bad-message', 'invalid role');
      return;
    }

    let room = rooms.get(code);
    if (room === undefined) {
      room = {};
      rooms.set(code, room);
    }
    if (room[role] !== undefined) {
      sendError(socket, 'duplicate-role', `room ${code} already has a ${role}`);
      return;
    }
    if (room.host !== undefined && room.join !== undefined) {
      // Cannot be reached given duplicate-role above, but kept as the
      // explicit "third client" guard for when someone joins under a
      // role that's already taken or future-extends to N>2.
      sendError(socket, 'room-full', `room ${code} is full`);
      return;
    }

    room[role] = { socket, role };
    memberRoom.set(socket, { code, role });

    const peer = role === 'host' ? room.join : room.host;
    sendTo(socket, { kind: 'joined', peerPresent: peer !== undefined });
    if (peer !== undefined) {
      sendTo(peer.socket, { kind: 'peer-joined' });
    }
    log(`join room=${code} role=${role} peerPresent=${peer !== undefined} rooms=${rooms.size}`);
  }

  function handleSignal(socket: WebSocket, msg: Extract<ClientMessage, { kind: 'signal' }>): void {
    const memb = memberRoom.get(socket);
    if (memb === undefined) {
      sendError(socket, 'not-joined', 'must join a room before signaling');
      return;
    }
    const room = rooms.get(memb.code);
    if (room === undefined) {
      sendError(socket, 'not-joined', 'room no longer exists');
      return;
    }
    const peer = memb.role === 'host' ? room.join : room.host;
    if (peer === undefined) {
      sendError(socket, 'no-peer', 'no peer in room');
      return;
    }
    sendTo(peer.socket, { kind: 'signal', payload: msg.payload });
  }

  function handleClose(socket: WebSocket): void {
    const memb = memberRoom.get(socket);
    if (memb === undefined) return;
    memberRoom.delete(socket);
    const room = rooms.get(memb.code);
    if (room === undefined) return;

    if (room[memb.role]?.socket === socket) {
      room[memb.role] = undefined;
    }
    const peer = memb.role === 'host' ? room.join : room.host;
    if (peer !== undefined) {
      sendTo(peer.socket, { kind: 'peer-left' });
    }

    if (room.host === undefined && room.join === undefined) {
      rooms.delete(memb.code);
    }
    log(`close room=${memb.code} role=${memb.role} rooms=${rooms.size}`);
  }

  return new Promise<StartedSignalingServer>((resolve, reject) => {
    wss.on('listening', () => {
      const address = wss.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('signaling: WebSocketServer.address() returned unexpected shape'));
        return;
      }
      log(`listening port=${address.port}`);
      resolve({
        port: address.port,
        get roomCount() { return rooms.size; },
        close: () =>
          new Promise<void>((res, rej) => {
            wss.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
    wss.on('error', reject);
  });
}

function sendTo(socket: WebSocket, msg: ServerMessage): void {
  // Drop sends to half-closed sockets — the close handler will clean up.
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(msg));
}

function sendError(socket: WebSocket, code: ErrorCode, message: string): void {
  sendTo(socket, { kind: 'error', code, message });
}
