/* ------------------------------------------------------------------ */
/* Kickoff Tactics — netplay transport (Trystero / serverless WebRTC)  */
/*                                                                     */
/* Host  = Player 1 (authoritative sim)                                */
/* Guest = Player 2 (sends plans, plays back the host's resolve reels) */
/*                                                                     */
/* No backend needed: peers meet over PUBLIC signaling networks.       */
/* Three independent strategies are tried on wall-clock-aligned        */
/* windows (MQTT brokers → BitTorrent trackers → Nostr relays), so     */
/* both devices always converge on the same network within seconds     */
/* even if one of them is blocked or down.                             */
/* ------------------------------------------------------------------ */

import type { joinRoom as MqttJoin } from "@trystero-p2p/mqtt";

export type NetMsg = Record<string, any>;

export interface NetHandlers {
  onRoom?: (code: string) => void; // host: code ready · guest: host found
  onPeer?: (msg: NetMsg) => void; // message from the other device
  onClose?: () => void; // connection lost
  onRtt?: (ms: number) => void; // smoothed round-trip
  onError?: (err: string) => void;
}

export interface NetSession {
  send: (m: NetMsg) => void;
  close: () => void;
}

const APP_ID = "kickoff-tactics-v3";
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const WINDOW_MS = 7000; // each signaling network gets a wall-clock-aligned slice

// lazy-loaded so the main game bundle stays small
const STRATEGIES = [
  { name: "mqtt", load: () => import("@trystero-p2p/mqtt") },
  { name: "torrent", load: () => import("@trystero-p2p/torrent") },
  { name: "nostr", load: () => import("@trystero-p2p/nostr") },
];

export function makeRoomCode(len = 4): string {
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
  return s;
}

type AnyRoom = ReturnType<typeof MqttJoin>;

function connect(code: string, isHost: boolean, h: NetHandlers): NetSession {
  const roomName = `${APP_ID}:${code}`;
  let room: AnyRoom | null = null;
  let sendFn: ((m: NetMsg) => void) | null = null;
  let closed = false;
  let connected = false;
  let currentStrategy = -1;
  let rotateTimer: number | undefined;
  let hbTimer: number | undefined;
  let rtt = -1;

  const send = (m: NetMsg) => {
    if (!closed && sendFn) {
      try {
        sendFn(m);
      } catch {
        /* ignore */
      }
    }
  };

  const teardown = () => {
    if (closed) return;
    closed = true;
    if (rotateTimer) window.clearInterval(rotateTimer);
    if (hbTimer) window.clearInterval(hbTimer);
    try {
      void room?.leave();
    } catch {
      /* ignore */
    }
    h.onClose?.();
  };

  const openRoom = async (idx: number) => {
    if (closed) return;
    currentStrategy = idx;
    const strategy = STRATEGIES[idx % STRATEGIES.length];
    try {
      void room?.leave();
    } catch {
      /* ignore */
    }
    room = null;
    sendFn = null;
    let mod: { joinRoom: typeof MqttJoin };
    try {
      mod = (await strategy.load()) as unknown as { joinRoom: typeof MqttJoin };
    } catch {
      return; // rotation will try the next network
    }
    if (closed || currentStrategy !== idx) return; // the window rolled while loading
    try {
      room = mod.joinRoom({ appId: APP_ID }, roomName) as AnyRoom;
    } catch {
      return;
    }
    const action = room.makeAction<NetMsg>("m");
    sendFn = (m) => {
      void action.send(m).catch(() => {});
    };
    action.onMessage = (m) => {
      if (!m || typeof m !== "object") return;
      if (m.t === "ping") {
        send({ t: "pong", ts: m.ts });
        return;
      }
      if (m.t === "pong") {
        const ms = Date.now() - m.ts;
        rtt = rtt < 0 ? ms : rtt * 0.7 + ms * 0.3;
        h.onRtt?.(Math.round(rtt));
        return;
      }
      h.onPeer?.(m);
    };
    room.onPeerJoin = () => {
      if (connected || closed) return;
      connected = true;
      if (rotateTimer) window.clearInterval(rotateTimer);
      hbTimer = window.setInterval(() => send({ t: "ping", ts: Date.now() }), 1000);
      h.onRoom?.(code);
    };
    room.onPeerLeave = () => {
      if (connected && !closed) teardown();
    };
  };

  // Wall-clock-aligned strategy rotation: every device picks the same network
  // for the same 7s window, so the two phones always end up on the same one.
  const windowIdx = () => Math.floor(Date.now() / WINDOW_MS) % STRATEGIES.length;
  void openRoom(windowIdx());
  rotateTimer = window.setInterval(() => {
    if (closed || connected) return;
    const want = windowIdx();
    if (want !== currentStrategy) void openRoom(want);
  }, 1000);

  if (isHost) h.onRoom?.(code); // the code is known immediately

  return { send, close: teardown };
}

/** Create a room. The 4-letter code is what the guest types in. */
export function hostRoom(h: NetHandlers, _attempt = 0): NetSession {
  return connect(makeRoomCode(), true, h);
}

/** Join a room by its 4-letter code. */
export function joinRoom(codeRaw: string, h: NetHandlers): NetSession {
  const code = codeRaw.trim().toUpperCase();
  if (!code) {
    h.onError?.("Enter the 4-letter room code.");
    return { send: () => {}, close: () => {} };
  }
  return connect(code, false, h);
}
