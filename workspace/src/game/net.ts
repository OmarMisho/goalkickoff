import Peer, { DataConnection } from "peerjs";

/* ------------------------------------------------------------------ */
/* Kickoff Tactics — netplay transport (PeerJS / WebRTC data channel)  */
/*                                                                     */
/* Host  = Player 1 (authoritative sim)                                */
/* Guest = Player 2 (sends plans, plays back the host's resolve reels) */
/*                                                                     */
/* Signaling: PeerJS cloud by default (zero setup). For production you */
/* can self-host peerjs-server (see /server) and point the client at   */
/* it by setting window.__PEER_OPTS before the app boots, e.g.:        */
/*   window.__PEER_OPTS = { host:"signal.example.com", port:443,       */
/*                          path:"/signaling", secure:true }           */
/* ------------------------------------------------------------------ */

export type NetMsg = Record<string, any>;

export interface NetHandlers {
  onRoom?: (code: string) => void; // host: room code created
  onPeer?: (msg: NetMsg) => void; // raw message from the other device
  onClose?: () => void; // connection lost
  onRtt?: (ms: number) => void; // smoothed round-trip
  onError?: (err: string) => void;
}

export interface NetSession {
  send: (m: NetMsg) => void;
  close: () => void;
}

const ID_PREFIX = "kickoff-tactics-v1-";
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function makeRoomCode(len = 4): string {
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
  return s;
}

function peerOpts(): any {
  const o = (window as any).__PEER_OPTS ?? {};
  return { debug: 0, ...o };
}

function wire(conn: DataConnection, h: NetHandlers): NetSession {
  let closed = false;
  let hb: number | undefined;
  let rtt = -1;

  const send = (m: NetMsg) => {
    if (!closed && conn.open) {
      try { conn.send(m); } catch { /* ignore */ }
    }
  };

  const startHeartbeat = () => {
    hb = window.setInterval(() => {
      send({ t: "ping", ts: Date.now() });
    }, 1000);
  };

  conn.on("data", (raw) => {
    const m = raw as NetMsg;
    if (!m || typeof m !== "object") return;
    if (m.t === "ping") { send({ t: "pong", ts: m.ts }); return; }
    if (m.t === "pong") {
      const ms = Date.now() - m.ts;
      rtt = rtt < 0 ? ms : rtt * 0.7 + ms * 0.3;
      h.onRtt?.(Math.round(rtt));
      return;
    }
    h.onPeer?.(m);
  });

  const teardown = () => {
    if (closed) return;
    closed = true;
    if (hb) window.clearInterval(hb);
    h.onClose?.();
  };
  conn.on("close", teardown);
  conn.on("error", teardown);

  conn.on("open", () => startHeartbeat());
  if (conn.open) startHeartbeat();

  return {
    send,
    close: () => { teardown(); try { conn.close(); } catch { /* ignore */ } },
  };
}

/** Create a room. The room code IS the peer id suffix. */
export function hostRoom(h: NetHandlers, attempt = 0): NetSession {
  const code = makeRoomCode();
  const peer = new Peer(ID_PREFIX + code, peerOpts());
  let session: NetSession | null = null;

  const fail = (msg: string) => h.onError?.(msg);

  peer.on("error", (e: any) => {
    if (e?.type === "unavailable-id" && attempt < 4) {
      // code collision — try another
      try { peer.destroy(); } catch { /* ignore */ }
      hostRoom(h, attempt + 1);
      return;
    }
    fail(e?.type ?? "network error");
  });

  peer.on("open", () => h.onRoom?.(code));

  peer.on("connection", (conn) => {
    if (session) { try { conn.close(); } catch { /* ignore */ } return; } // 2 players only
    session = wire(conn, {
      ...h,
      onClose: () => { try { peer.destroy(); } catch { /* ignore */ } h.onClose?.(); },
    });
  });

  return {
    send: (m) => session?.send(m),
    close: () => { try { peer.destroy(); } catch { /* ignore */ } },
  };
}

/** Join a room by its 4-letter code. */
export function joinRoom(codeRaw: string, h: NetHandlers): NetSession {
  const code = codeRaw.trim().toUpperCase();
  const peer = new Peer(peerOpts());
  let session: NetSession | null = null;

  peer.on("error", (e: any) => {
    if (e?.type === "peer-unavailable") h.onError?.(`Room ${code} not found — is the host online?`);
    else h.onError?.(e?.type ?? "network error");
  });

  peer.on("open", () => {
    const conn = peer.connect(ID_PREFIX + code, { reliable: true });
    session = wire(conn, {
      ...h,
      onClose: () => { try { peer.destroy(); } catch { /* ignore */ } h.onClose?.(); },
    });
    conn.on("open", () => h.onRoom?.(code));
  });

  return {
    send: (m) => session?.send(m),
    close: () => { try { peer.destroy(); } catch { /* ignore */ } },
  };
}
