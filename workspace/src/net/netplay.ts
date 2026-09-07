// ── Net Duel: serverless WebRTC matchmaking via Trystero (nostr relays) ─
// One phone hosts a 4-letter room code, the other joins it. Public relays
// are used only for the initial handshake — after that, gameplay data
// flows peer-to-peer over a direct WebRTC data channel.
import { joinRoom } from 'trystero';
import type { Room, MessageAction } from 'trystero';
import type { GameStats, Settings, Snapshot } from '../game/defs';

const APP_ID = 'turf-clash-netduel-v1';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L

export function makeRoomCode(len = 4): string {
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return out;
}

export function cleanCode(s: string): string {
  return s.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 4);
}

// ── wire protocol ──────────────────────────────────────────────────────
export type NetMsg =
  | { k: 'hello'; name: string } // guest → host, on connect
  | { k: 'welcome'; name: string } // host → guest
  | { k: 'set'; name: string; f: string; skin: string } // settings sync, both ways
  | { k: 'ready'; ready: boolean }
  | { k: 'start'; s: Settings } // host → guest: merged match settings, begin
  | { k: 'lobby' } // either → return to lobby (rematch flow)
  | { k: 'snap'; s: Snapshot } // host → guest, 20 Hz
  | { k: 'strike'; slot: number; dx: number; dy: number; p: number } // guest → host
  | { k: 'banner'; text: string; color: string; sub: string | null } // host → guest
  | { k: 'over'; stats: GameStats } // host → guest
  | { k: 'bye' };

type MsgHandler = (m: NetMsg) => void;

export class NetBridge {
  readonly isHost: boolean;
  readonly code: string;
  private room: Room;
  private action: MessageAction<NetMsg>;
  private msgCb: MsgHandler | null = null;
  private joinCb: ((peerId: string) => void) | null = null;
  private leaveCb: (() => void) | null = null;
  private rttCb: ((ms: number) => void) | null = null;
  private pingTimer: number | null = null;
  private peerId: string | null = null;
  private dead = false;

  private constructor(isHost: boolean, code: string) {
    this.isHost = isHost;
    this.code = code;
    this.room = joinRoom({ appId: APP_ID }, `pitch-${code}`);
    this.action = this.room.makeAction<NetMsg>('m');
    this.action.onMessage = (m, context) => {
      if (!m || this.dead) return;
      if (this.peerId && context.peerId !== this.peerId) return; // 1v1 only
      this.msgCb?.(m);
    };
    this.room.onPeerJoin = (peerId) => {
      if (this.dead || this.peerId) return; // lock to the first rival
      this.peerId = peerId;
      this.startPing();
      this.joinCb?.(peerId);
    };
    this.room.onPeerLeave = (peerId) => {
      if (this.dead || (this.peerId && peerId !== this.peerId)) return;
      this.peerId = null;
      this.stopPing();
      this.leaveCb?.();
    };
  }

  static host(code: string): NetBridge {
    return new NetBridge(true, code);
  }
  static join(code: string): NetBridge {
    return new NetBridge(false, code);
  }

  send(m: NetMsg) {
    if (this.dead) return;
    try {
      void this.action.send(m).catch(() => {
        /* peer not ready / gone */
      });
    } catch {
      /* channel unavailable */
    }
  }

  onMsg(cb: MsgHandler) {
    this.msgCb = cb;
  }
  onPeerJoin(cb: (peerId: string) => void) {
    this.joinCb = cb;
  }
  onPeerLeave(cb: () => void) {
    this.leaveCb = cb;
  }
  onRtt(cb: (ms: number) => void) {
    this.rttCb = cb;
  }

  connected(): boolean {
    try {
      return Object.keys(this.room.getPeers()).length > 0;
    } catch {
      return false;
    }
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = window.setInterval(() => {
      if (this.dead || !this.peerId) return;
      this.room
        .ping(this.peerId)
        .then((ms) => this.rttCb?.(Math.max(1, Math.round(ms))))
        .catch(() => {
          /* peer busy */
        });
    }, 1000);
  }
  private stopPing() {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  leave() {
    if (this.dead) return;
    this.dead = true;
    this.stopPing();
    try {
      void this.room.leave().catch(() => {
        /* already gone */
      });
    } catch {
      /* already gone */
    }
  }
}
