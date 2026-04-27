// Wire protocol shared between the signaling server and the WebRTC
// client transport.
//
// The server is intentionally dumb: it pairs two clients by room code
// and blindly relays signal payloads (SDP, ICE) between them. It does
// not understand WebRTC; the SignalPayload type is opaque to the
// server. Once the datachannel is open, gameplay traffic flows
// peer-to-peer and the signaling connection is dormant — kept alive
// only so peer-disconnect notifications still arrive.
//
// Bandwidth budget for the relay (per PRD §3.2): negligible. SDP +
// ICE is a few KB total per match start; nothing else after.

export type Role = 'host' | 'join';

// SDP description / ICE candidate (or end-of-candidates marker).
// Shape matches the browser RTCSessionDescriptionInit /
// RTCIceCandidateInit so the client can pass them straight through.
export type SignalPayload =
  | { kind: 'sdp'; description: { type: 'offer' | 'answer'; sdp: string } }
  | { kind: 'ice'; candidate: { candidate?: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string | null } | null };

export type ClientMessage =
  | { kind: 'join'; room: string; role: Role }
  | { kind: 'signal'; payload: SignalPayload };

export type ServerMessage =
  | { kind: 'joined'; peerPresent: boolean }
  | { kind: 'peer-joined' }
  | { kind: 'peer-left' }
  | { kind: 'signal'; payload: SignalPayload }
  | { kind: 'error'; code: ErrorCode; message: string };

export type ErrorCode =
  | 'room-full'
  | 'duplicate-role'
  | 'bad-message'
  | 'no-peer'
  | 'not-joined';

// Room codes are 6 characters from a confusable-free alphabet (no
// 0/O/I/1) — short enough to read aloud, long enough for ~10^9 unique
// rooms which is well over what an alpha needs.
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of code) {
    if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
}
