// WebRTC datachannel transport for the lockstep loop.
//
// Implements BroadcastChannelLike, so LockstepChannel doesn't know
// (or care) whether its substrate is in-process BroadcastChannel
// (Phase 2.0 same-machine gate) or peer-to-peer WebRTC (Phase 2.1+).
// Same protocol shape, same desync-detection contract, same
// canonical-merge-order rule.
//
// Flow:
//   1. Connect WebSocket → signaling server.
//   2. Send { kind: 'join', room, role }.
//   3. Wire RTCPeerConnection. Host creates the data channel before
//      the offer (so it lands in the SDP and the join side gets it
//      via ondatachannel without a renegotiation).
//   4. Trickle SDP + ICE candidates through the signaling relay.
//   5. Wait for the data channel `open` event on both sides.
//   6. After open, the signaling WebSocket is dormant — kept alive
//      only for peer-left notifications. Gameplay traffic goes
//      peer-to-peer.
//
// Deliberate non-features for 2.1: ICE restart, TURN fallback,
// reconnect on transient drops. Per the investigation doc, lockstep
// alpha treats disconnect as "match over."

import type { BroadcastChannelLike, LockstepMessage } from './lockstep-channel';
import type { ClientMessage, Role, ServerMessage, SignalPayload } from './signaling-protocol';

export const DATA_CHANNEL_LABEL = 'vylux-lockstep';

export interface WebRtcConnectOptions {
  signalingUrl: string;
  room: string;
  role: Role;
  iceServers?: RTCIceServer[];
  // Optional: how long to wait for the datachannel to open before
  // giving up. Phase 2.1 default 15s — generous because cross-network
  // ICE on a cellular peer can be slow.
  openTimeoutMs?: number;
  onPeerLeft?(): void;
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

export class WebRtcTransport implements BroadcastChannelLike {
  private readonly pc: RTCPeerConnection;
  private readonly ws: WebSocket;
  private channel: RTCDataChannel | null = null;
  private readonly listeners = new Set<(ev: { data: LockstepMessage }) => void>();
  private readonly outboundQueue: LockstepMessage[] = [];
  private closed = false;
  private readonly onPeerLeft?: () => void;

  private constructor(pc: RTCPeerConnection, ws: WebSocket, onPeerLeft?: () => void) {
    this.pc = pc;
    this.ws = ws;
    this.onPeerLeft = onPeerLeft;
  }

  static async connect(opts: WebRtcConnectOptions): Promise<WebRtcTransport> {
    const ws = await openWebSocket(opts.signalingUrl);
    const pc = new RTCPeerConnection({
      iceServers: opts.iceServers ?? DEFAULT_ICE_SERVERS,
    });
    const transport = new WebRtcTransport(pc, ws, opts.onPeerLeft);

    // Trickle local ICE candidates to the peer via the signaling relay.
    pc.onicecandidate = (ev) => {
      // Null candidate = end-of-candidates. We forward it so the peer
      // can finalise its remote description; some browsers want this.
      sendSignal(ws, {
        kind: 'ice',
        candidate: ev.candidate ? ev.candidate.toJSON() : null,
      });
    };

    // Wait for the datachannel to open. Host creates it; join receives
    // it via ondatachannel.
    const dataChannelOpen = new Promise<RTCDataChannel>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`webrtc: datachannel open timeout (${opts.openTimeoutMs ?? 15000} ms)`));
      }, opts.openTimeoutMs ?? 15000);

      const ready = (ch: RTCDataChannel): void => {
        clearTimeout(timer);
        ch.onmessage = (ev) => transport.dispatchIncoming(ev.data as string);
        ch.onclose = () => transport.handlePeerGone('datachannel-close');
        ch.onerror = () => transport.handlePeerGone('datachannel-error');
        resolve(ch);
      };

      if (opts.role === 'host') {
        const dc = pc.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true });
        dc.onopen = () => ready(dc);
      } else {
        pc.ondatachannel = (ev) => {
          if (ev.channel.label !== DATA_CHANNEL_LABEL) return;
          if (ev.channel.readyState === 'open') ready(ev.channel);
          else ev.channel.onopen = () => ready(ev.channel);
        };
      }
    });

    // Wire incoming signaling messages.
    ws.addEventListener('message', (ev) => {
      void transport.handleSignaling(ev.data as string, opts.role);
    });
    ws.addEventListener('close', () => transport.handlePeerGone('signaling-close'));

    // Announce to the signaling server. The server replies `joined`,
    // and either `peer-joined` (if peer was already there, host case
    // when joining second) or nothing (we wait for the peer).
    sendClient(ws, { kind: 'join', room: opts.room, role: opts.role });

    // For the host role: once the peer joins (peer-joined) we create
    // the offer. For the join role: once we receive the offer
    // (signal{sdp:offer}) we create the answer. handleSignaling owns
    // both paths.

    transport.channel = await dataChannelOpen;

    // Drain any queued outbound messages.
    transport.flushQueue();

    return transport;
  }

  postMessage(data: LockstepMessage): void {
    if (this.closed) return;
    if (this.channel === null || this.channel.readyState !== 'open') {
      this.outboundQueue.push(data);
      return;
    }
    this.channel.send(JSON.stringify(data));
  }

  addEventListener(_type: 'message', listener: (ev: { data: LockstepMessage }) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: (ev: { data: LockstepMessage }) => void): void {
    this.listeners.delete(listener);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.listeners.clear();
    try { this.channel?.close(); } catch { /* idempotent close */ }
    try { this.pc.close(); } catch { /* idempotent close */ }
    try { this.ws.close(); } catch { /* idempotent close */ }
  }

  private flushQueue(): void {
    if (this.channel === null) return;
    while (this.outboundQueue.length > 0) {
      const m = this.outboundQueue.shift()!;
      this.channel.send(JSON.stringify(m));
    }
  }

  private dispatchIncoming(text: string): void {
    if (this.closed) return;
    let parsed: LockstepMessage;
    try {
      parsed = JSON.parse(text) as LockstepMessage;
    } catch {
      // Drop malformed frames — the peer is on the same code; if this
      // happens, the lockstep hash gate will catch the resulting drift
      // immediately. We don't pollute gameplay with "report this" UI
      // for a transport-level corruption that can't actually happen.
      return;
    }
    for (const l of this.listeners) l({ data: parsed });
  }

  private async handleSignaling(rawText: string, role: Role): Promise<void> {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(rawText) as ServerMessage;
    } catch {
      return;
    }
    switch (msg.kind) {
      case 'joined':
        if (role === 'host' && msg.peerPresent) {
          // We joined second as host? Unlikely (the convention is that
          // host creates the room before broadcasting the code) but
          // honour the offer-on-peer rule consistently.
          await this.createAndSendOffer();
        }
        return;

      case 'peer-joined':
        if (role === 'host') {
          await this.createAndSendOffer();
        }
        return;

      case 'signal': {
        const payload = msg.payload as SignalPayload;
        if (payload.kind === 'sdp') {
          await this.pc.setRemoteDescription(payload.description);
          if (payload.description.type === 'offer') {
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            sendSignal(this.ws, { kind: 'sdp', description: serializeDescription(this.pc.localDescription!) });
          }
        } else if (payload.kind === 'ice') {
          if (payload.candidate === null) {
            // End-of-candidates marker; some implementations want it.
            try { await this.pc.addIceCandidate(undefined); } catch { /* not all browsers accept this */ }
          } else {
            try { await this.pc.addIceCandidate(payload.candidate); } catch {
              // ICE add failures pre-remote-description are normal during
              // the trickle race; remote will be set via the offer/answer
              // sequence and any earlier candidates can be dropped — the
              // ones still arriving will succeed.
            }
          }
        }
        return;
      }

      case 'peer-left':
        this.handlePeerGone('peer-left');
        return;

      case 'error':
        // Surface as a hard failure — caller's connect promise has already
        // resolved or will reject via the open timeout. Loud-fail close.
        // eslint-disable-next-line no-console
        console.error('signaling error', msg.code, msg.message);
        this.handlePeerGone(`signaling-error:${msg.code}`);
        return;
    }
  }

  private async createAndSendOffer(): Promise<void> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    sendSignal(this.ws, { kind: 'sdp', description: serializeDescription(this.pc.localDescription!) });
  }

  private handlePeerGone(reason: string): void {
    if (this.closed) return;
    // Don't synthesise traffic to the LockstepChannel — let it stall
    // naturally on missing per-tick frames. The match-end overlay or a
    // future "peer disconnected" surface owns the UX. We just notify
    // the optional callback for higher-level UI.
    void reason;
    this.onPeerLeft?.();
  }
}

function openWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const onOpen = (): void => {
      ws.removeEventListener('error', onError);
      resolve(ws);
    };
    const onError = (ev: Event): void => {
      ws.removeEventListener('open', onOpen);
      reject(new Error(`webrtc: signaling websocket failed to open: ${(ev as ErrorEvent).message ?? ''}`));
    };
    ws.addEventListener('open', onOpen, { once: true });
    ws.addEventListener('error', onError, { once: true });
  });
}

function sendClient(ws: WebSocket, msg: ClientMessage): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(msg));
}

function sendSignal(ws: WebSocket, payload: SignalPayload): void {
  sendClient(ws, { kind: 'signal', payload });
}

function serializeDescription(desc: RTCSessionDescription): { type: 'offer' | 'answer'; sdp: string } {
  if (desc.type !== 'offer' && desc.type !== 'answer') {
    throw new Error(`webrtc: unexpected SDP type ${desc.type}`);
  }
  return { type: desc.type, sdp: desc.sdp };
}
