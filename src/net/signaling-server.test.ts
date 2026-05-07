// Signaling server gate.
//
// Boots the server on a random port and connects real `ws` clients
// against it. Verifies the room-pairing handshake, signal relay,
// peer-disconnect notifications, and the error paths (bad code, full
// room, signaling without joining).
//
// All assertions are wrapped in await-with-timeout helpers so a hung
// path fails fast instead of hanging the test runner.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  startSignalingServer,
  type StartedSignalingServer,
} from './signaling-server';
import type { ClientMessage, ServerMessage, SignalPayload } from './signaling-protocol';

let server: StartedSignalingServer;

beforeEach(async () => {
  server = await startSignalingServer({ port: 0, log: () => {} });
});

afterEach(async () => {
  await server.close();
});

const url = (): string => `ws://127.0.0.1:${server.port}`;

async function open(): Promise<WebSocket> {
  const ws = new WebSocket(url());
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return ws;
}

function send(ws: WebSocket, msg: ClientMessage): void {
  ws.send(JSON.stringify(msg));
}

function nextMessage(ws: WebSocket, timeoutMs = 2000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`timed out waiting for server message (${timeoutMs} ms)`));
    }, timeoutMs);

    const onMessage = (raw: Buffer | ArrayBuffer | string): void => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      const text = typeof raw === 'string' ? raw : Buffer.from(raw as ArrayBuffer).toString();
      try {
        resolve(JSON.parse(text) as ServerMessage);
      } catch (err) {
        reject(err);
      }
    };
    ws.on('message', onMessage);
  });
}

async function close(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === ws.CLOSED) { resolve(); return; }
    ws.once('close', () => resolve());
    ws.close();
  });
}

const SDP_OFFER: SignalPayload = {
  kind: 'sdp',
  description: { type: 'offer', sdp: 'v=0\r\nfake\r\n' },
};

describe('signaling-server — pairing + relay', () => {
  it('host joins first, gets joined{peerPresent:false}; join arrives, host gets peer-joined', async () => {
    const host = await open();
    const join = await open();

    send(host, { kind: 'join', room: 'ABC234', role: 'host' });
    expect(await nextMessage(host)).toEqual({ kind: 'joined', peerPresent: false });

    send(join, { kind: 'join', room: 'ABC234', role: 'join' });
    const [hostNotice, joinAck] = await Promise.all([
      nextMessage(host),
      nextMessage(join),
    ]);
    expect(hostNotice).toEqual({ kind: 'peer-joined' });
    expect(joinAck).toEqual({ kind: 'joined', peerPresent: true });

    expect(server.roomCount).toBe(1);

    await close(host);
    await close(join);
  });

  it('relays signal payloads in both directions, server is opaque to content', async () => {
    const host = await open();
    const join = await open();
    send(host, { kind: 'join', room: 'XYZ234', role: 'host' });
    await nextMessage(host); // joined ack
    send(join, { kind: 'join', room: 'XYZ234', role: 'join' });
    await Promise.all([nextMessage(host), nextMessage(join)]); // peer-joined / joined

    send(host, { kind: 'signal', payload: SDP_OFFER });
    expect(await nextMessage(join)).toEqual({ kind: 'signal', payload: SDP_OFFER });

    const answer: SignalPayload = {
      kind: 'sdp',
      description: { type: 'answer', sdp: 'v=0\r\nanswer\r\n' },
    };
    send(join, { kind: 'signal', payload: answer });
    expect(await nextMessage(host)).toEqual({ kind: 'signal', payload: answer });

    await close(host);
    await close(join);
  });

  it('peer-left fires when a peer disconnects, room is cleaned up when both leave', async () => {
    const host = await open();
    const join = await open();
    send(host, { kind: 'join', room: 'RAMP23', role: 'host' });
    await nextMessage(host);
    send(join, { kind: 'join', room: 'RAMP23', role: 'join' });
    await Promise.all([nextMessage(host), nextMessage(join)]);
    expect(server.roomCount).toBe(1);

    await close(join);
    expect(await nextMessage(host)).toEqual({ kind: 'peer-left' });
    expect(server.roomCount).toBe(1); // host still holds the room

    await close(host);
    // Wait a tick for the close handler to clean up the empty room.
    await new Promise((r) => setTimeout(r, 20));
    expect(server.roomCount).toBe(0);
  });
});

describe('signaling-server — error paths', () => {
  it('rejects invalid room codes with bad-message', async () => {
    const ws = await open();
    send(ws, { kind: 'join', room: 'lower!', role: 'host' });
    const msg = await nextMessage(ws);
    expect(msg.kind).toBe('error');
    expect((msg as Extract<ServerMessage, { kind: 'error' }>).code).toBe('bad-message');
    await close(ws);
  });

  it('rejects a duplicate role in the same room', async () => {
    const a = await open();
    const b = await open();
    send(a, { kind: 'join', room: 'DUPE23', role: 'host' });
    await nextMessage(a);

    send(b, { kind: 'join', room: 'DUPE23', role: 'host' });
    const msg = await nextMessage(b);
    expect(msg.kind).toBe('error');
    expect((msg as Extract<ServerMessage, { kind: 'error' }>).code).toBe('duplicate-role');

    await close(a);
    await close(b);
  });

  it('rejects signaling before joining a room', async () => {
    const ws = await open();
    send(ws, { kind: 'signal', payload: SDP_OFFER });
    const msg = await nextMessage(ws);
    expect(msg.kind).toBe('error');
    expect((msg as Extract<ServerMessage, { kind: 'error' }>).code).toBe('not-joined');
    await close(ws);
  });

  it('rejects malformed JSON with bad-message', async () => {
    const ws = await open();
    ws.send('not-json');
    const msg = await nextMessage(ws);
    expect(msg.kind).toBe('error');
    expect((msg as Extract<ServerMessage, { kind: 'error' }>).code).toBe('bad-message');
    await close(ws);
  });

  it('signaling with no peer present returns no-peer', async () => {
    const ws = await open();
    send(ws, { kind: 'join', room: 'KAFE23', role: 'host' });
    await nextMessage(ws);
    send(ws, { kind: 'signal', payload: SDP_OFFER });
    const msg = await nextMessage(ws);
    expect(msg.kind).toBe('error');
    expect((msg as Extract<ServerMessage, { kind: 'error' }>).code).toBe('no-peer');
    await close(ws);
  });
});
