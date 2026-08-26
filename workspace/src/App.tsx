import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Engine, type UiSnapshot, type Team } from "./game/engine";
import { FORMATIONS, TEAM_COLOR, TICKS_PER_ROUND, SEG_SECS, WIN_GOALS, loadSettings, type Settings } from "./game/core";
import { FLAGS, makeEmblem, flagById } from "./game/flags";
import { unlockAudio, sfx, setSoundEnabled, setSoundVolume } from "./game/audio";
import { hostRoom, joinRoom, type NetSession } from "./game/net";

interface NetState {
  lobbyOpen: boolean;
  role: "host" | "guest" | null;
  code: string;
  status: "idle" | "hosting" | "joining" | "connected" | "closed" | "error";
  error: string;
  oppJoined: boolean;
  oppFlag: string | null;
  myFlag: string;
  rtt: number | null;
}

const initNet: NetState = {
  lobbyOpen: false, role: null, code: "", status: "idle", error: "",
  oppJoined: false, oppFlag: null, myFlag: "bra", rtt: null,
};

/* ---------- tiny building blocks ---------- */

function FlagImg({ id, size, ring = "#3a5a70" }: { id: string; size: number; ring?: string }) {
  const url = useMemo(() => makeEmblem(id, size * 2, ring).toDataURL(), [id, size, ring]);
  return <img src={url} width={size} height={size} alt={flagById(id).name} className="block" draggable={false} />;
}

function TimerRing({ left, total, size = 74 }: { left: number; total: number; size?: number }) {
  const r = size / 2 - 6;
  const C = 2 * Math.PI * r;
  const f = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
  const warn = left <= 3.05;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="6" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={warn ? "#ff5c5c" : "#ffd23f"} strokeWidth="6"
          strokeDasharray={C} strokeDashoffset={C * (1 - f)} strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`font-disp text-2xl ${warn ? "text-[#ff5c5c] flight-flash" : "text-white"}`}>{Math.ceil(left)}</span>
      </div>
    </div>
  );
}

function FormationPreview({ rows, team, active }: { rows: number[]; team: Team; active: boolean }) {
  const n = rows.length;
  return (
    <svg viewBox="0 0 92 56" className="w-full">
      <rect x="1" y="1" width="90" height="54" fill={active ? "rgba(11,61,40,0.9)" : "rgba(11,61,40,0.45)"} stroke={active ? "#3f8f63" : "#12384c"} />
      <line x1="46" y1="1" x2="46" y2="55" stroke="rgba(255,255,255,0.25)" strokeWidth="0.8" />
      {rows.map((count, i) => {
        const frac = n === 1 ? 0.5 : 0.18 + (0.64 * i) / (n - 1);
        const x = team === 0 ? 8 + frac * 34 : 84 - frac * 34;
        return Array.from({ length: count }).map((_, j) => {
          const y = 28 + (j - (count - 1) / 2) * Math.min(17, 44 / count);
          return <circle key={`${i}-${j}`} cx={x} cy={y} r="4.4" fill={TEAM_COLOR[team]} stroke="#04121c" strokeWidth="1.2" />;
        });
      })}
    </svg>
  );
}

/* ---------- rules-page illustrated captures ---------- */

function Shot({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <div className="shot-frame chamfer-sm overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5" style={{ background: "rgba(255,255,255,0.05)" }}>
        <span className="font-disp text-[10px] tracking-[0.25em]" style={{ color: accent }}>{title}</span>
        <span className="flex gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#ff5c5c]" />
          <span className="w-1.5 h-1.5 rounded-full bg-[#ffd23f]" />
          <span className="w-1.5 h-1.5 rounded-full bg-[#3f8f63]" />
        </span>
      </div>
      <svg viewBox="0 0 280 180" className="w-full block" style={{ background: "#0b3d28" }}>{children}</svg>
    </div>
  );
}

const ShotPitch = () => (
  <g>
    <rect x="10" y="10" width="260" height="160" fill="none" stroke="rgba(240,250,244,0.55)" strokeWidth="1.4" />
    <line x1="140" y1="10" x2="140" y2="170" stroke="rgba(240,250,244,0.55)" strokeWidth="1.4" />
    <circle cx="140" cy="90" r="20" fill="none" stroke="rgba(240,250,244,0.55)" strokeWidth="1.4" />
  </g>
);

const ShotCoin = ({ x, y, color, ring }: { x: number; y: number; color: string; ring?: string }) => (
  <g>
    <ellipse cx={x + 2} cy={y + 8} rx="14" ry="6" fill="rgba(0,0,0,0.35)" />
    <circle cx={x} cy={y} r="13" fill={color} stroke={ring ?? "#04121c"} strokeWidth="2.4" />
    <circle cx={x} cy={y} r="7" fill="rgba(255,255,255,0.25)" />
  </g>
);

const ShotBall = ({ x, y }: { x: number; y: number }) => (
  <g>
    <circle cx={x} cy={y} r="7" fill="#f4f6f5" stroke="rgba(0,0,0,0.4)" />
    <path d={`M${x} ${y - 2.6} l2.5 1.8 -1 3 h-3 l-1 -3 z`} fill="#17181c" />
  </g>
);

function Diagrams() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <Shot title="TWO CIRCLES PER COIN" accent="#19d3ff">
        <ShotPitch />
        <circle cx="100" cy="92" r="52" fill="none" stroke="#19d3ff" strokeWidth="1.6" strokeDasharray="5 6" opacity="0.8" />
        <circle cx="100" cy="92" r="26" fill="rgba(25,211,255,0.12)" stroke="#19d3ff" strokeWidth="1.4" strokeDasharray="2 4" />
        <ShotCoin x={100} y={92} color="#19d3ff" />
        <ShotCoin x={142} y={70} color="rgba(25,211,255,0.35)" />
        <path d="M108 86 L132 74" stroke="#19d3ff" strokeWidth="2" strokeDasharray="5 4" />
        <text x="100" y="160" textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.8)" fontFamily="Chakra Petch">outer = move area · inner = keep-out</text>
      </Shot>

      <Shot title="PASS GLIDES IN — CUT IT!" accent="#ffd23f">
        <ShotPitch />
        <circle cx="70" cy="100" r="17" fill="none" stroke="#ffd23f" strokeWidth="2" opacity="0.9" />
        <ShotCoin x={70} y={100} color="#19d3ff" ring="#ffd23f" />
        <ShotBall x={90} y={100} />
        <path d="M92 97 C 130 80, 160 72, 196 66" fill="none" stroke="#ffd23f" strokeWidth="2.4" strokeDasharray="8 6" />
        <circle cx="200" cy="64" r="15" fill="none" stroke="#19d3ff" strokeWidth="1.4" strokeDasharray="3 4" />
        <ShotCoin x={200} y={64} color="#19d3ff" />
        <ShotCoin x={140} y={82} color="#ff3860" />
        <text x="140" y="112" textAnchor="middle" fontSize="11" fill="#ff5c5c" fontFamily="Archivo Black">CUT!</text>
        <text x="140" y="168" textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.8)" fontFamily="Chakra Petch">lands when the receiver stops</text>
      </Shot>

      <Shot title="MOMENTUM CRASHES" accent="#ff3860">
        <ShotPitch />
        <path d="M60 70 L110 88" stroke="#19d3ff" strokeWidth="3" />
        <path d="M216 118 L166 100" stroke="#ff3860" strokeWidth="3" />
        <ShotCoin x={120} y={92} color="#19d3ff" />
        <ShotCoin x={156} y={97} color="#ff3860" />
        <path d="M138 76 l5 9 10 2 -8 7 2 10 -9 -5 -9 5 2 -10 -8 -7 10 -2 z" fill="#ffe9a8" opacity="0.9" />
        <text x="140" y="140" textAnchor="middle" fontSize="11" fill="#ffe9a8" fontFamily="Archivo Black">CLASH!</text>
        <circle cx="236" cy="60" r="26" fill="none" stroke="#ff3860" strokeWidth="1.4" strokeDasharray="4 5" opacity="0.8" />
        <ShotCoin x={236} y={60} color="#ff3860" />
        <path d="M246 78 C 254 70, 256 60, 252 46" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.6" />
        <text x="236" y="104" textAnchor="middle" fontSize="8" fill="rgba(255,255,255,0.7)" fontFamily="Chakra Petch">rim absorbs — no bounce</text>
      </Shot>

      <Shot title="GOAL = CLOCK BACK TO 120" accent="#19d3ff">
        <ShotPitch />
        <rect x="246" y="52" width="20" height="76" fill="rgba(25,211,255,0.2)" stroke="rgba(240,250,244,0.8)" strokeWidth="1.6" />
        <path d="M246 52 l14 6 v64 l-14 6" fill="none" stroke="rgba(240,250,244,0.5)" strokeWidth="1" />
        <ShotBall x={254} y={90} />
        <path d="M190 90 L242 90" stroke="#ffd23f" strokeWidth="2.4" strokeDasharray="8 6" />
        <g transform="translate(56,26)">
          <rect x="0" y="0" width="92" height="30" fill="#071b26" stroke="#ffd23f" strokeWidth="1.6" />
          <text x="46" y="20" textAnchor="middle" fontSize="14" fill="#ffd23f" fontFamily="Archivo Black">120 ↺</text>
        </g>
        <text x="120" y="120" textAnchor="middle" fontSize="16" fill="#ffd23f" fontFamily="Archivo Black">GOAL!</text>
        <text x="140" y="166" textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.8)" fontFamily="Chakra Petch">scored? the round timer restarts</text>
      </Shot>
    </div>
  );
}

/* ---------- rules page ---------- */

function HowtoPage({ flags, onClose }: { flags: [string, string]; onClose: () => void }) {
  const Rule = ({ n, color, title, children }: { n: string; color: string; title: string; children: React.ReactNode }) => (
    <div className="panel chamfer-sm p-4 flex gap-3 items-start">
      <span className="font-disp text-2xl leading-none mt-0.5" style={{ color }}>{n}</span>
      <div>
        <div className="font-disp text-sm tracking-[0.14em] text-white mb-1">{title}</div>
        <div className="text-[12.5px] leading-relaxed text-white/75">{children}</div>
      </div>
    </div>
  );
  return (
    <div className="absolute inset-0 z-40 bg-[rgba(3,10,17,0.94)]">
      <div className="h-full max-w-4xl mx-auto px-4 py-6 flex flex-col">
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div>
            <div className="text-[10px] tracking-[0.35em] text-[#ffd23f] font-bold">MATCH DAY BRIEFING</div>
            <div className="font-disp text-3xl md:text-4xl text-white" style={{ textShadow: "3px 3px 0 rgba(25,211,255,0.5)" }}>
              HOW TO PLAY
            </div>
          </div>
          <button onClick={onClose} className="btn-blade font-disp text-lg px-8 py-2.5 text-[#04121c]" style={{ background: "#ffd23f" }}>
            ◂ BACK TO THE PITCH
          </button>
        </div>

        <div className="flex items-center gap-3 mb-4 shrink-0">
          <FlagImg id={flags[0]} size={30} ring={TEAM_COLOR[0]} />
          <span className="font-disp text-sm" style={{ color: TEAM_COLOR[0] }}>P1</span>
          <span className="text-white/30 font-disp">VS</span>
          <span className="font-disp text-sm" style={{ color: TEAM_COLOR[1] }}>P2</span>
          <FlagImg id={flags[1]} size={30} ring={TEAM_COLOR[1]} />
          <span className="text-[11px] text-white/45 font-semibold tracking-wider ml-auto">
            120s ROUNDS · TWELVE 10s SEGMENTS · FIRST TO {WIN_GOALS}
          </span>
        </div>

        <div className="howto-scroll overflow-y-auto pr-2 space-y-3 rise-in">
          <Diagrams />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Rule n="01" color="#19d3ff" title="SECRET PLANNING, TEN SECONDS EACH">
              Every segment both players plan in turn — the other looks away. Drag each coin anywhere inside its{" "}
              <b className="text-[#19d3ff]">outer dashed circle</b>. A longer stretch means a faster coin and a harder impact.
              When both lock in, the plans execute at once.
            </Rule>
            <Rule n="02" color="#ffd23f" title="THE CARRIER MUST PASS">
              The coin holding the ball is <b className="text-[#ffd23f]">locked in place</b> — drag the ball itself to pass to a
              teammate, lead into space, or shoot at the goal mouth. No pass planned? <b className="text-[#ff5c5c]">Turnover</b> —
              the ball is punted to the nearest rival.
            </Rule>
            <Rule n="03" color="#19d3ff" title="TWO CIRCLES PER COIN">
              The <b className="text-[#19d3ff]">big circle</b> is the coin's whole moving area. The <b className="text-[#19d3ff]">small
              circle</b> is its keep-out zone: teammates may crash through it mid-play, but <b>no teammate can ever rest inside it</b>.
              Dragging too close gets auto-nudged with a warning.
            </Rule>
            <Rule n="04" color="#ff3860" title="CRASHES & MOMENTUM">
              When coins collide they exchange momentum — both bounce by impact power. Rival clashes count as blocks. The{" "}
              <b className="text-[#ff3860]">outer rim absorbs speed instead of bouncing</b>: a coin hitting the edge of its circle
              just slides along it.
            </Rule>
            <Rule n="05" color="#ffd23f" title="THE BALL GLIDES IN">
              A pass is struck <b className="text-[#ffd23f]">the instant the 10 seconds end</b> and glides down its lane while the
              coins move, <b>landing exactly when the receiving coin stops</b>. That flight time is the defender's window — drag a
              coin across the lane to <b className="text-[#ff5c5c]">cut the ball</b> and start a counter.
            </Rule>
            <Rule n="06" color="#19d3ff" title="GOALS RESET THE CLOCK">
              Drive the ball into the opponent goal mouth to score. Each goal resets the round timer to a full{" "}
              <b className="text-[#19d3ff]">120 seconds</b>, resets positions, and the conceding team kicks off. Reach{" "}
              <b className="text-[#ffd23f]">{WIN_GOALS} goals first</b> and you take the match. If the clock runs dry, the round
              restarts with fresh strategies.
            </Rule>
          </div>
          <div className="panel chamfer-sm px-4 py-2.5 text-center text-[11px] tracking-[0.22em] text-white/45 font-bold shrink-0">
            HOTSEAT: PLAYER 1 PLANS → HAND THE DEVICE OVER → PLAYER 2 PLANS → WATCH THE CLASH
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- main app ---------- */

const initSnap: UiSnapshot = {
  mode: "title", planner: 0, handoffNext: "plan", scores: [0, 0], round: 0, tick: 0,
  planLeft: 10, planTotal: 10, flags: ["bra", "blaugrana"], forms: ["2-1-2", "2-1-2"],
  stats: [
    { passes: 0, completed: 0, interceptions: 0, blocks: 0, turnovers: 0 },
    { passes: 0, completed: 0, interceptions: 0, blocks: 0, turnovers: 0 },
  ],
  winner: null, goalTeam: null, bannerId: 0, ballTeam: null, holderIdx: null,
  ballInFlight: false, flightTeam: null,
  online: false, myTeam: null, oppLocked: false, awaiting: false, lockedIn: false,
};

/** true on small screens held in portrait — the pitch wants landscape */
function useRotateHint(): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const check = () =>
      setShow(window.innerWidth < 900 && window.innerHeight > window.innerWidth);
    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, []);
  return show;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engRef = useRef<Engine | null>(null);
  const [snap, setSnap] = useState<UiSnapshot>(initSnap);
  const rotateHint = useRotateHint();
  const [landscapeDismissed, setLandscapeDismissed] = useState(false);
  const [net, setNet] = useState<NetState>(initNet);
  const netRef = useRef<NetSession | null>(null);
  const myFlagRef = useRef(loadSettings().flags[0]);
  const [joinCode, setJoinCode] = useState("");

  const setN = (patch: Partial<NetState>) => setNet((n) => ({ ...n, ...patch }));
  const teardownNet = () => { netRef.current?.close(); netRef.current = null; };

  const onPeerMsg = (m: any) => {
    const e = engRef.current!;
    if (m.t === "hello") {
      setN({ oppJoined: true, oppFlag: m.flag ?? "blaugrana", status: "connected" });
      netRef.current?.send({ t: "welcome", flag: myFlagRef.current });
      return;
    }
    if (m.t === "welcome") {
      setN({ oppJoined: true, oppFlag: m.flag ?? "blaugrana", status: "connected" });
      e.onlineInit("guest", myFlagRef.current, m.flag ?? "blaugrana", (mm) => netRef.current?.send(mm));
      return;
    }
    if (m.t === "flag") { setN({ oppFlag: m.flag ?? null }); return; }
    e.netReceive(m);
  };

  const netCloseHandler = () => {
    const active = engRef.current?.netActive();
    if (active) setN({ status: "closed" });
    else setNet((n) => ({ ...n, status: "idle", oppJoined: false, oppFlag: null }));
  };

  const startHosting = () => {
    teardownNet();
    setN({ role: "host", status: "hosting", code: "", oppJoined: false, oppFlag: null, error: "", rtt: null, lobbyOpen: true });
    netRef.current = hostRoom({
      onRoom: (code) => setN({ code }),
      onPeer: onPeerMsg,
      onRtt: (ms) => setN({ rtt: ms }),
      onError: (err) => setN({ status: "error", error: err }),
      onClose: netCloseHandler,
    });
  };

  const startJoining = (code: string) => {
    teardownNet();
    setN({ role: "guest", status: "joining", code, oppJoined: false, oppFlag: null, error: "", rtt: null, lobbyOpen: true });
    netRef.current = joinRoom(code, {
      onRoom: () => { netRef.current?.send({ t: "hello", flag: myFlagRef.current }); },
      onPeer: onPeerMsg,
      onRtt: (ms) => setN({ rtt: ms }),
      onError: (err) => setN({ status: "error", error: err }),
      onClose: netCloseHandler,
    });
  };

  const hostStartMatch = () => {
    if (!net.oppJoined || !net.oppFlag) return;
    sfx.whistle();
    engRef.current!.onlineInit("host", net.myFlag, net.oppFlag, (m) => netRef.current?.send(m));
    setN({ lobbyOpen: false });
  };

  const abandonOnline = () => {
    teardownNet();
    engRef.current?.onlineDisconnect();
    setNet({ ...initNet });
  };

  const pickLobbyFlag = (id: string) => {
    myFlagRef.current = id;
    setN({ myFlag: id });
    if (netRef.current && net.status === "connected") netRef.current.send({ t: "flag", flag: id });
    sfx.pick();
  };

  // auto-close the lobby once the engine leaves the title screen (guest side)
  useEffect(() => {
    if (snap.mode !== "title" && snap.online) setN({ lobbyOpen: false });
  }, [snap.mode, snap.online]);

  useEffect(() => () => teardownNet(), []);

  useEffect(() => {
    const eng = new Engine(canvasRef.current!, (s) => setSnap(s));
    engRef.current = eng;
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      eng.destroy();
    };
  }, []);

  const ui = snap;
  const eng = () => engRef.current!;
  const inMatch = ["plan", "resolve", "handoff", "roundIntro", "goal", "roundEnd", "formPick"].includes(ui.mode);
  const pcol = TEAM_COLOR[ui.planner];
  const roundLeft = (TICKS_PER_ROUND - Math.min(ui.tick, TICKS_PER_ROUND)) * SEG_SECS;

  return (
    <div className="stage-bg w-full h-full overflow-hidden select-none">
      <div className="relative w-full h-full flex items-center justify-center">
        <canvas ref={canvasRef} className="game-canvas" />
        {rotateHint && !landscapeDismissed && <LandscapeToast onDismiss={() => setLandscapeDismissed(true)} />}

        {/* ======= HUD ======= */}
        {inMatch && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
            <div className="panel chamfer flex items-stretch gap-0 px-1 py-1">
              {([0, 1] as Team[]).map((t) => (
                <div key={t} className={`flex items-center gap-2 px-3 ${t === 1 ? "flex-row-reverse" : ""}`}>
                  <FlagImg id={ui.flags[t]} size={34} ring={TEAM_COLOR[t]} />
                  <div className={t === 1 ? "text-right" : ""}>
                    <div className="font-disp text-sm leading-none" style={{ color: TEAM_COLOR[t] }}>
                      P{t + 1} · {flagById(ui.flags[t]).tag}
                    </div>
                    <div className="flex gap-1.5 mt-1">
                      {Array.from({ length: WIN_GOALS }).map((_, i) => (
                        <span
                          key={i}
                          className="w-3.5 h-3.5 skew-x-[-14deg] inline-block"
                          style={{ background: i < ui.scores[t] ? TEAM_COLOR[t] : "rgba(255,255,255,0.12)", boxShadow: i < ui.scores[t] ? `0 0 8px ${TEAM_COLOR[t]}` : "none" }}
                        />
                      ))}
                    </div>
                  </div>
                  {ui.ballTeam === t && (
                    <span className="text-[9px] font-bold tracking-widest px-1.5 py-0.5" style={{ background: TEAM_COLOR[t], color: "#04121c" }}>
                      BALL
                    </span>
                  )}
                </div>
              ))}
              <div className="px-4 flex flex-col items-center justify-center border-x border-white/10 min-w-[92px]">
                <div className="font-disp text-xl leading-tight text-white">
                  {roundLeft}
                  <span className="text-[11px] text-white/50">s</span>
                </div>
                <div className="flex gap-[3px] justify-center pb-1">
                  {Array.from({ length: TICKS_PER_ROUND }).map((_, i) => (
                    <div
                      key={i}
                      className="w-2 h-1.5 skew-x-[-14deg]"
                      style={{ background: i < ui.tick ? "#ffd23f" : "rgba(255,255,255,0.14)" }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* resolve caption */}
        {ui.mode === "resolve" && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
            {ui.ballInFlight ? (
              <div
                className="font-disp text-lg md:text-2xl tracking-[0.18em] px-6 py-2 chamfer-sm flight-flash"
                style={{ background: TEAM_COLOR[ui.flightTeam ?? 0], color: "#04121c" }}
              >
                ⚽ BALL IN FLIGHT — CUT IT!
              </div>
            ) : (
              <div className="font-disp text-sm tracking-[0.3em] text-white/60 px-5 py-1.5 panel chamfer-sm">
                RESOLVE — PLANS CLASH
              </div>
            )}
          </div>
        )}

        {/* ======= PLANNING PANEL ======= */}
        {ui.mode === "plan" && (
          <div
            className="absolute z-20 flex flex-col items-center gap-2"
            style={{
              bottom: "12px",
              left: "50%",
              transform: "translateX(-50%)",
              width: "auto",
            }}
          >
            {/* Timer at top of panel */}
            <div className="panel chamfer px-4 py-2 flex items-center gap-4">
              <div className="flex items-center gap-3">
                <div className="font-disp text-[11px] md:text-sm" style={{ color: pcol }}>
                  {ui.online ? `ORDERS · P${(ui.myTeam ?? 0) + 1}` : `P${ui.planner + 1} SECRET ORDERS`}
                </div>
                <div className="text-[8px] md:text-[10px] tracking-wider md:tracking-[0.2em] text-white/50 font-bold">
                  SEG {Math.min(ui.tick + 1, TICKS_PER_ROUND)}/{TICKS_PER_ROUND}
                </div>
                {ui.online && ui.oppLocked && (
                  <div className="text-[8px] md:text-[10px] font-bold text-[#3fd46d]">RIVAL LOCKED ✓</div>
                )}
                {ui.online && ui.awaiting && (
                  <div className="text-[8px] md:text-[10px] font-bold text-[#ffd23f] flight-flash">SENT — SYNCING…</div>
                )}
              </div>
              <TimerRing left={ui.planLeft} total={ui.planTotal} size={52} />
            </div>

            {/* Buttons below timer */}
            <div className="flex items-center gap-2">
              {ui.online && (ui.awaiting || ui.lockedIn) ? (
                <div className="panel chamfer-sm px-4 py-2">
                  <span className="font-disp text-sm text-[#ffd23f] flight-flash">
                    {ui.oppLocked ? "CLASHING…" : "WAITING FOR RIVAL…"}
                  </span>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => eng().uiLock()}
                    disabled={ui.awaiting}
                    className="btn-blade font-disp text-sm md:text-base px-4 py-2 md:px-6 text-[#04121c] disabled:opacity-40"
                    style={{ background: "#ffd23f" }}
                  >
                    {ui.awaiting ? "SENT ✓" : "LOCK IN ▸"}
                  </button>
                  <button
                    onClick={() => eng().uiClearPlan()}
                    disabled={ui.awaiting}
                    className="btn-blade font-disp text-sm px-4 py-2 text-white/75 bg-[#12384c] disabled:opacity-40"
                  >
                    CLEAR
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* online session chip */}
        {ui.online && (
          <div className="absolute top-1.5 left-2 z-10 flex items-center gap-2 pointer-events-none">
            <span className="panel chamfer-sm px-2 py-0.5 text-[9px] font-bold tracking-widest" style={{ color: TEAM_COLOR[ui.myTeam ?? 0] }}>
              YOU · P{(ui.myTeam ?? 0) + 1}
            </span>
            <span className="panel chamfer-sm px-2 py-0.5 text-[9px] font-bold tracking-widest text-[#ffd23f]">
              ROOM {net.code}
            </span>
            {net.rtt != null && (
              <span className="panel chamfer-sm px-2 py-0.5 text-[9px] font-bold tracking-widest text-white/45">
                {net.rtt}ms
              </span>
            )}
          </div>
        )}

        {/* formation pick timer */}
        {ui.mode === "formPick" && (
          <div className="absolute bottom-3 right-4 z-20 pointer-events-none">
            {ui.online && (ui.awaiting || ui.lockedIn) ? (
              <div className="flex flex-col items-center justify-center px-3 py-2 panel chamfer-sm">
                <span className="font-disp text-base text-[#ffd23f] flight-flash">…</span>
                <span className="text-[9px] tracking-[0.16em] text-white/55 font-bold">RIVAL PICKING…</span>
              </div>
            ) : (
              <TimerRing left={ui.planLeft} total={ui.planTotal} size={62} />
            )}
          </div>
        )}

        {/* ======= TITLE ======= */}
        {ui.mode === "title" && (
          <Overlay dark>
            <div className="w-full max-w-3xl px-6">
              <div className="max-w-xl">
                <div className="flex items-center gap-2 mb-3">
                  <div className="hazard chamfer-sm h-5 w-28" />
                  <span className="text-[11px] font-bold tracking-[0.3em] text-[#ffd23f]">2P ONLINE OR HOTSEAT · HIDDEN MOVES · FIRST TO {WIN_GOALS}</span>
                </div>
                <h1 className="font-disp leading-[0.86] text-white" style={{ fontSize: "clamp(52px, 8.2vw, 108px)" }}>
                  <span className="block" style={{ textShadow: "5px 5px 0 rgba(25,211,255,0.85)" }}>KICK</span>
                  <span className="block -mt-1" style={{ textShadow: "5px 5px 0 rgba(255,56,96,0.85)" }}>OFF<span className="text-[#ffd23f]">!</span></span>
                </h1>
                <p className="font-disp text-lg md:text-xl mt-2 tracking-[0.28em] text-[#19d3ff]">TACTICS</p>
                <p className="mt-3 text-sm md:text-base text-white/75 max-w-md leading-relaxed">
                  Football chess on coins: plan hidden moves every 10 seconds, thread passes through rival lines,
                  crash for momentum — <b className="text-[#ffd23f]">first to {WIN_GOALS} goals wins.</b>
                </p>
              </div>

              <div className="mt-8 flex flex-col sm:flex-row sm:items-center gap-3 rise-in">
                <button
                  onClick={() => setN({ lobbyOpen: true, role: null, status: "idle", error: "" })}
                  className="btn-blade font-disp text-2xl md:text-3xl px-10 py-4 text-[#04121c] pulse-glow"
                  style={{ background: "#ffd23f" }}
                >
                  ONLINE MATCH ▸
                </button>
                <button
                  onClick={() => eng().uiStart()}
                  className="btn-blade font-disp text-xl md:text-2xl px-8 py-4 text-[#04121c]"
                  style={{ background: "#19d3ff" }}
                >
                  LOCAL · SHARED SCREEN
                </button>
                <button
                  onClick={() => eng().uiOpenHowto()}
                  className="btn-blade font-disp text-xl md:text-2xl px-8 py-4 text-white/90 bg-[#12384c]"
                >
                  HOW TO PLAY
                </button>
                <button
                  onClick={() => eng().uiOpenSettings()}
                  className="btn-blade font-disp text-xl md:text-2xl px-8 py-4 text-white/90 bg-[#2b3a4c] inline-flex items-center gap-2"
                >
                  <SettingsIcon /> SETTINGS
                </button>
              </div>
              <div className="mt-3 text-[11px] tracking-widest text-white/40 font-semibold">
                ONLINE = TWO PHONES, ONE ROOM CODE · LOCAL = PASS THE DEVICE · GOALS RESET THE 120s CLOCK
              </div>
            </div>
          </Overlay>
        )}

        {/* ======= HOW TO PLAY ======= */}
        {ui.mode === "howto" && <HowtoPage flags={ui.flags} onClose={() => eng().uiCloseHowto()} />}

        {/* ======= SETTINGS ======= */}
        {ui.mode === "settings" && (
          <SettingsPage
            initial={loadSettings()}
            apply={(s) => { setSoundEnabled(s.sound); setSoundVolume(s.volume); eng().uiApplySettings(s); }}
            onClose={() => eng().uiCloseSettings()}
          />
        )}

        {/* ======= ONLINE LOBBY ======= */}
        {ui.mode === "title" && net.lobbyOpen && (
          <Overlay dark>
            <div className="panel chamfer p-6 w-[min(94%,640px)] banner-in">
              <div className="flex items-center justify-between">
                <HeadTag color="#ffd23f" text="ONLINE MATCH — TWO DEVICES" />
                <button onClick={() => { teardownNet(); setNet({ ...initNet }); }} className="text-white/50 hover:text-white font-bold text-sm px-2">✕</button>
              </div>

              {/* my flag */}
              <div className="mt-4">
                <div className="font-disp text-[11px] tracking-[0.25em] text-white/50 mb-2">YOUR CREW</div>
                <div className="flex gap-1.5 flex-wrap">
                  {FLAGS.slice(0, 10).map((f) => {
                    const sel = net.myFlag === f.id;
                    return (
                      <button key={f.id} title={f.name} onClick={() => pickLobbyFlag(f.id)}
                        className={`chamfer-sm p-[2px] transition-transform hover:scale-110 ${sel ? "scale-110" : ""}`}
                        style={{ background: sel ? "#ffd23f" : "rgba(255,255,255,0.14)" }}>
                        <FlagImg id={f.id} size={38} ring={sel ? "#04121c" : "#3a5a70"} />
                      </button>
                    );
                  })}
                </div>
              </div>

              {!net.role && (
                <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button onClick={startHosting} className="btn-blade font-disp text-xl px-6 py-4 text-[#04121c]" style={{ background: "#19d3ff" }}>
                    HOST A ROOM ▸
                  </button>
                  <div className="flex gap-2">
                    <input
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))}
                      placeholder="CODE"
                      className="chamfer-sm bg-[#0a1e2a] text-[#ffd23f] font-disp text-2xl tracking-[0.3em] text-center w-full px-3 outline-none border-2 border-[#12384c] focus:border-[#ffd23f]"
                    />
                    <button
                      onClick={() => joinCode.length === 4 && startJoining(joinCode)}
                      disabled={joinCode.length !== 4}
                      className="btn-blade font-disp text-xl px-6 text-[#04121c] disabled:opacity-30"
                      style={{ background: "#ffd23f" }}>
                      JOIN
                    </button>
                  </div>
                </div>
              )}

              {net.role && (
                <div className="mt-5 space-y-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <div className="text-[10px] tracking-[0.3em] text-white/45 font-bold">ROOM CODE</div>
                      <div className="font-disp text-4xl tracking-[0.35em] text-[#ffd23f]">{net.code || "····"}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] tracking-[0.3em] text-white/45 font-bold">STATUS</div>
                      <div className={`font-disp text-lg ${net.status === "connected" ? "text-[#3fd46d]" : net.status === "error" ? "text-[#ff5c5c]" : "text-white/70 flight-flash"}`}>
                        {net.status === "hosting" && "WAITING FOR RIVAL…"}
                        {net.status === "joining" && "CONNECTING…"}
                        {net.status === "connected" && "LINKED ✓"}
                        {net.status === "error" && "ERROR"}
                      </div>
                    </div>
                  </div>

                  {net.error && <div className="text-[#ff5c5c] text-xs font-semibold">{net.error}</div>}

                  <div className="flex items-center gap-4 panel chamfer-sm px-4 py-3">
                    <div className="flex items-center gap-2">
                      <FlagImg id={net.myFlag} size={30} ring="#19d3ff" />
                      <span className="font-disp text-sm text-[#19d3ff]">YOU {net.role === "host" ? "· P1" : "· P2"}</span>
                    </div>
                    <span className="text-white/30 font-disp">VS</span>
                    {net.oppFlag ? (
                      <div className="flex items-center gap-2">
                        <FlagImg id={net.oppFlag} size={30} ring="#ff3860" />
                        <span className="font-disp text-sm text-[#ff3860]">RIVAL {net.role === "host" ? "· P2" : "· P1"}</span>
                      </div>
                    ) : (
                      <span className="font-disp text-sm text-white/35 flight-flash">— WAITING —</span>
                    )}
                    {net.rtt != null && <span className="ml-auto text-[10px] font-bold text-white/40">{net.rtt}ms</span>}
                  </div>

                  {net.role === "host" && (
                    <button
                      onClick={hostStartMatch}
                      disabled={!net.oppJoined}
                      className="w-full btn-blade font-disp text-2xl px-8 py-4 text-[#04121c] disabled:opacity-30"
                      style={{ background: net.oppJoined ? "#3fd46d" : "#5a6a75" }}>
                      {net.oppJoined ? "START MATCH ▸" : "WAITING FOR PLAYER 2…"}
                    </button>
                  )}
                  {net.role === "guest" && (
                    <div className="text-center text-[11px] tracking-[0.25em] text-white/50 font-bold flight-flash">
                      {net.status === "connected" ? "LINKED — HOST WILL START THE MATCH" : "SHARE NOTHING — JUST WAIT"}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4 pt-3 border-t border-white/10 text-[10.5px] text-white/40 leading-relaxed">
                Host = Player 1 (cyan) · Guest = Player 2 (crimson). Both plan in secret for 10s each segment, then clash.
                Works over the internet — share the 4-letter code with your rival.
              </div>
            </div>
          </Overlay>
        )}

        {/* ======= CONNECTION LOST ======= */}
        {net.status === "closed" && ui.online && (
          <Overlay dark>
            <div className="panel chamfer p-8 text-center banner-in">
              <div className="font-disp text-3xl text-[#ff5c5c]" style={{ textShadow: "3px 3px 0 rgba(0,0,0,0.6)" }}>CONNECTION LOST</div>
              <div className="text-sm text-white/60 mt-2 mb-5">Your rival disconnected or the network dropped.</div>
              <button onClick={abandonOnline} className="btn-blade font-disp text-xl px-10 py-3 text-[#04121c]" style={{ background: "#ffd23f" }}>
                BACK TO TITLE ▸
              </button>
            </div>
          </Overlay>
        )}

        {/* ======= FLAG PICK ======= */}
        {ui.mode === "flags" && (
          <Overlay>
            <div key={ui.planner} className="panel chamfer p-6 w-[min(92%,680px)] banner-in">
              <HeadTag color={pcol} text={`PLAYER ${ui.planner + 1} — PICK YOUR CREW`} />
              <div className="mt-3 grid grid-cols-2 gap-4">
                {(["country", "club"] as const).map((kind) => (
                  <div key={kind}>
                    <div className="font-disp text-[11px] tracking-[0.25em] text-white/50 mb-2">
                      {kind === "country" ? "NATIONS" : "CLUB CRESTS"}
                    </div>
                    <div className="grid grid-cols-5 gap-1.5">
                      {FLAGS.filter((f) => f.kind === kind).map((f) => {
                        const sel = ui.flags[ui.planner] === f.id;
                        return (
                          <button
                            key={f.id}
                            title={f.name}
                            onClick={() => eng().uiPickFlag(ui.planner, f.id)}
                            className={`chamfer-sm p-[2.5px] transition-transform hover:scale-110 ${sel ? "scale-110" : ""}`}
                            style={{ background: sel ? pcol : "rgba(255,255,255,0.14)" }}
                          >
                            <FlagImg id={f.id} size={44} ring={sel ? "#04121c" : "#3a5a70"} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-white/70">
                  <FlagImg id={ui.flags[ui.planner]} size={30} ring={pcol} />
                  <span className="font-disp text-sm" style={{ color: pcol }}>
                    {flagById(ui.flags[ui.planner]).name.toUpperCase()}
                  </span>
                </div>
                <button
                  onClick={() => eng().uiConfirmFlags()}
                  className="btn-blade font-disp text-lg px-8 py-2.5 text-[#04121c]"
                  style={{ background: "#ffd23f" }}
                >
                  CONFIRM ▸
                </button>
              </div>
            </div>
            {ui.planner === 1 && <div className="absolute top-6 text-[11px] tracking-[0.3em] text-white/40 font-bold">PLAYER 1 — NO PEEKING</div>}
          </Overlay>
        )}

        {/* ======= FORMATION PICK ======= */}
        {ui.mode === "formPick" && (
          <Overlay>
            <div key={`${ui.planner}-${ui.round}`} className="panel chamfer p-6 w-[min(94%,760px)] banner-in">
              <div className="flex items-start justify-between">
                <HeadTag color={pcol} text={ui.online ? `YOUR STRATEGY — ROUND ${ui.round + 1}` : `PLAYER ${ui.planner + 1} — ROUND ${ui.round + 1} STRATEGY`} />
                <TimerRing left={ui.planLeft} total={ui.planTotal} size={62} />
              </div>
              <div className="mt-3 grid grid-cols-3 md:grid-cols-6 gap-2">
                {FORMATIONS.map((f) => {
                  const sel = ui.forms[ui.planner] === f.id;
                  return (
                    <button
                      key={f.id}
                      onClick={() => eng().uiSetForm(ui.planner, f.id)}
                      className="chamfer-sm p-2 transition-all hover:-translate-y-0.5"
                      style={{
                        background: sel ? "rgba(255,210,63,0.12)" : "rgba(255,255,255,0.04)",
                        border: `2px solid ${sel ? "#ffd23f" : "#12384c"}`,
                      }}
                    >
                      <div className={`font-disp text-base mb-1 ${sel ? "text-[#ffd23f]" : "text-white/75"}`}>{f.id}</div>
                      <FormationPreview rows={f.rows} team={ui.planner} active={sel} />
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[11px] text-white/45 font-semibold tracking-wider">
                  ROWS RUN FROM YOUR GOAL → HALFWAY · AUTO-CONFIRMS WHEN TIME RUNS OUT
                </span>
                <button
                  onClick={() => eng().uiConfirmForm()}
                  className="btn-blade font-disp text-lg px-8 py-2.5 text-[#04121c]"
                  style={{ background: "#ffd23f" }}
                >
                  SET ▸
                </button>
              </div>
            </div>
          </Overlay>
        )}

        {/* ======= HANDOFF ======= */}
        {ui.mode === "handoff" && (
          <Overlay dark>
            <div key={ui.bannerId} className="text-center banner-in">
              <div className="text-[11px] tracking-[0.35em] text-white/45 font-bold mb-2">HANDOVER — PASS THE DEVICE</div>
              <div className="font-disp text-5xl md:text-6xl mb-1" style={{ color: pcol, textShadow: "4px 4px 0 rgba(0,0,0,0.6)" }}>
                PLAYER {ui.planner + 1}
              </div>
              <div className="font-disp text-lg text-white/80 tracking-[0.2em] mb-6">
                {ui.handoffNext === "form" ? "CHOOSE THE ROUND STRATEGY" : "PLOT YOUR SECRET MOVES"}
              </div>
              <div className="flex items-center justify-center gap-4 mb-6">
                <FlagImg id={ui.flags[0]} size={40} ring={TEAM_COLOR[0]} />
                <span className="text-white/30 font-disp text-xl">VS</span>
                <FlagImg id={ui.flags[1]} size={40} ring={TEAM_COLOR[1]} />
              </div>
              <button
                onClick={() => eng().uiContinueHandoff()}
                className="btn-blade font-disp text-xl px-10 py-3 text-[#04121c] pulse-glow"
                style={{ background: pcol }}
              >
                I'M PLAYER {ui.planner + 1} — READY ▸
              </button>
              <div className="mt-3 text-[10px] tracking-widest text-white/35 font-semibold">OPPONENT: LOOK AWAY 👀</div>
            </div>
          </Overlay>
        )}

        {/* ======= ROUND INTRO ======= */}
        {ui.mode === "roundIntro" && (
          <Overlay pointer={false}>
            <div key={ui.bannerId} className="text-center banner-in">
              <div className="hazard chamfer-sm inline-block px-[4px] py-[4px]">
                <div className="chamfer-sm bg-[#071b26] px-10 py-3">
                  <div className="font-disp text-4xl md:text-5xl text-white" style={{ textShadow: "4px 4px 0 rgba(255,210,63,0.55)" }}>
                    ROUND {ui.round}
                  </div>
                  <div className="font-disp text-sm tracking-[0.3em] mt-1" style={{ color: TEAM_COLOR[(ui.round - 1) % 2 as 0 | 1] }}>
                    PLAYER {((ui.round - 1) % 2) + 1} KICKOFF · 120 SECONDS · TWELVE 10s SEGMENTS
                  </div>
                </div>
              </div>
            </div>
          </Overlay>
        )}

        {/* ======= GOAL ======= */}
        {ui.mode === "goal" && ui.goalTeam != null && (
          <Overlay pointer={false}>
            <div key={ui.bannerId} className="text-center banner-in">
              <div
                className="font-disp text-7xl md:text-8xl"
                style={{ color: TEAM_COLOR[ui.goalTeam], textShadow: "6px 6px 0 rgba(0,0,0,0.65), 0 0 60px " + TEAM_COLOR[ui.goalTeam] }}
              >
                GOAL!
              </div>
              <div className="flex items-center justify-center gap-3 mt-2">
                <FlagImg id={ui.flags[ui.goalTeam]} size={34} ring={TEAM_COLOR[ui.goalTeam]} />
                <span className="font-disp text-xl text-white tracking-[0.2em]">
                  {flagById(ui.flags[ui.goalTeam]).tag} · PLAYER {ui.goalTeam + 1}
                </span>
              </div>
              {ui.scores[ui.goalTeam] < WIN_GOALS && (
                <div className="mt-3 inline-block font-disp text-sm tracking-[0.25em] text-[#ffd23f] panel chamfer-sm px-5 py-1.5 flight-flash">
                  ROUND CLOCK RESET — BACK TO 120s
                </div>
              )}
            </div>
          </Overlay>
        )}

        {/* ======= ROUND END ======= */}
        {ui.mode === "roundEnd" && (
          <Overlay pointer={false}>
            <div key={ui.bannerId} className="text-center banner-in">
              <div className="font-disp text-5xl text-white" style={{ textShadow: "4px 4px 0 rgba(25,211,255,0.5)" }}>
                ROUND {ui.round} COMPLETE
              </div>
              <div className="font-disp text-lg text-[#ffd23f] mt-2 tracking-[0.25em]">
                {ui.scores[0]} — {ui.scores[1]}
              </div>
              <div className="text-[11px] tracking-[0.3em] text-white/50 font-bold mt-3">
                NEW STRATEGY PHASE — 10 SECONDS EACH
              </div>
            </div>
          </Overlay>
        )}

        {/* ======= CHAMPION ======= */}
        {ui.mode === "champion" && ui.winner != null && (
          <Overlay dark>
            <div key={ui.bannerId} className="panel chamfer p-8 w-[min(92%,640px)] text-center banner-in">
              <div className="hazard h-2 w-40 mx-auto mb-4" />
              <div className="text-[11px] tracking-[0.35em] text-[#ffd23f] font-bold mb-2">FULL TIME — CHAMPIONS</div>
              <div className="flex justify-center mb-2 float-ball">
                <FlagImg id={ui.flags[ui.winner]} size={104} ring="#ffd23f" />
              </div>
              <div className="font-disp text-4xl md:text-5xl" style={{ color: TEAM_COLOR[ui.winner] }}>
                PLAYER {ui.winner + 1}
              </div>
              <div className="font-disp text-lg text-white/80 tracking-[0.2em] mb-4">
                {flagById(ui.flags[ui.winner]).name.toUpperCase()} · {ui.scores[ui.winner]}–{ui.scores[(1 - ui.winner) as 0 | 1]}
              </div>
              <div className="space-y-1.5 text-left mb-5">
                {([["PASSES", "passes"], ["COMPLETED", "completed"], ["INTERCEPTIONS", "interceptions"], ["BLOCKS", "blocks"], ["TURNOVERS", "turnovers"]] as const).map(([label, key]) => (
                  <div key={key} className="panel chamfer-sm px-3 py-1.5 grid grid-cols-3 text-sm">
                    <span className="text-white/60 font-semibold">{label}</span>
                    <span className="text-center font-disp" style={{ color: TEAM_COLOR[0] }}>{ui.stats[0][key]}</span>
                    <span className="text-right font-disp" style={{ color: TEAM_COLOR[1] }}>{ui.stats[1][key]}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-center gap-3 flex-wrap">
                {ui.online && ui.myTeam === 1 ? (
                  <span className="btn-blade font-disp text-lg px-8 py-3 bg-[#12384c] text-white/50 flight-flash">
                    HOST DECIDES THE REMATCH…
                  </span>
                ) : (
                  <button onClick={() => eng().uiRematch()} className="btn-blade font-disp text-lg px-8 py-3 text-[#04121c]" style={{ background: "#ffd23f" }}>
                    REMATCH ▸
                  </button>
                )}
                <button onClick={() => eng().uiOpenHowto()} className="btn-blade font-disp text-lg px-8 py-3 text-[#04121c]" style={{ background: "#19d3ff" }}>
                  RULES
                </button>
                <button
                  onClick={() => { if (ui.online) abandonOnline(); else eng().uiToTitle(); }}
                  className="btn-blade font-disp text-lg px-8 py-3 text-white/85 bg-[#12384c]"
                >
                  TITLE SCREEN
                </button>
              </div>
            </div>
          </Overlay>
        )}

        {inMatch && (
          <div className="absolute top-1.5 right-2 z-10">
            <button
              onClick={() => { sfx.click(); if (ui.online) abandonOnline(); else eng().uiToTitle(); }}
              className="btn-blade text-[10px] font-bold tracking-widest px-3 py-1 bg-[#12384c] text-white/60 hover:text-white"
            >
              ✕ QUIT
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Overlay({ children, dark, pointer = true }: { children: React.ReactNode; dark?: boolean; pointer?: boolean }) {
  return (
    <div
      className={`overlay-scroll absolute inset-0 z-40 flex items-center justify-center p-3 md:p-4 ${dark ? "bg-[rgba(3,10,17,0.88)]" : "bg-[rgba(4,18,28,0.55)]"} ${pointer ? "" : "pointer-events-none"}`}
    >
      {children}
    </div>
  );
}

function HeadTag({ color, text }: { color: string; text: string }) {
  return (
    <div className="skew-tag chamfer-sm inline-block px-4 py-1" style={{ background: color }}>
      <span className="font-disp text-[13px] text-[#04121c]">{text}</span>
    </div>
  );
}

/** Non-blocking landscape suggestion — a dismissable toast, never forces orientation. */
function LandscapeToast({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-40 max-w-[92vw]">
      <div className="panel chamfer-sm flex items-center gap-3 pl-3 pr-2 py-2 bg-[rgba(7,27,38,0.92)]">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" className="rotate-wiggle shrink-0">
          <rect x="7" y="2.5" width="10" height="19" rx="2" stroke="#ffd23f" strokeWidth="1.6" />
          <path d="M20.5 12a8.5 8.5 0 0 1-8.5 8.5" stroke="#19d3ff" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M12 22l-2.4-2 2.4-2" stroke="#19d3ff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="text-[11px] leading-snug text-white/80">
          Plays best in <span className="text-[#ffd23f] font-bold">landscape</span> — rotate for the full pitch.
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 w-7 h-7 grid place-items-center btn-blade bg-[#12384c] text-white/70 text-xs font-bold"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function SettingsIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      />
    </svg>
  );
}

function SettingsPage({ initial, apply, onClose }: { initial: Settings; apply: (s: Settings) => void; onClose: () => void }) {
  const [s, setS] = useState<Settings>({ ...initial, flags: [...initial.flags], forms: [...initial.forms] });
  const set = (patch: Partial<Settings>) => {
    const next = { ...s, ...patch };
    setS(next);
    apply(next); // live-save + live-apply (sound responds instantly)
  };

  const TeamBlock = ({ t }: { t: 0 | 1 }) => {
    const col = TEAM_COLOR[t];
    return (
      <div className="panel chamfer-sm p-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2.5 h-2.5 skew-x-[-14deg] inline-block" style={{ background: col }} />
          <span className="font-disp text-sm" style={{ color: col }}>PLAYER {t + 1} DEFAULTS</span>
        </div>

        <div className="text-[10px] tracking-[0.2em] text-white/50 font-bold mb-1.5">FLAG</div>
        <div className="grid grid-cols-6 gap-1.5 mb-3">
          {FLAGS.map((f) => {
            const sel = s.flags[t] === f.id;
            return (
              <button
                key={f.id}
                title={f.name}
                onClick={() => set({ flags: [t === 0 ? f.id : s.flags[0], t === 1 ? f.id : s.flags[1]] as [string, string] })}
                className={`chamfer-sm p-[2px] transition-transform hover:scale-110 ${sel ? "scale-110" : ""}`}
                style={{ background: sel ? col : "rgba(255,255,255,0.14)" }}
              >
                <FlagImg id={f.id} size={30} ring={sel ? "#04121c" : "#3a5a70"} />
              </button>
            );
          })}
        </div>

        <div className="text-[10px] tracking-[0.2em] text-white/50 font-bold mb-1.5">STRATEGY</div>
        <div className="grid grid-cols-3 gap-1.5">
          {FORMATIONS.map((f) => {
            const sel = s.forms[t] === f.id;
            return (
              <button
                key={f.id}
                onClick={() => set({ forms: [t === 0 ? f.id : s.forms[0], t === 1 ? f.id : s.forms[1]] as [string, string] })}
                className="chamfer-sm px-1 py-1.5 transition-all"
                style={{
                  background: sel ? "rgba(255,210,63,0.14)" : "rgba(255,255,255,0.04)",
                  border: `1.5px solid ${sel ? "#ffd23f" : "#12384c"}`,
                }}
              >
                <span className={`font-disp text-[13px] ${sel ? "text-[#ffd23f]" : "text-white/70"}`}>{f.id}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="absolute inset-0 z-40 bg-[rgba(3,10,17,0.94)]">
      <div className="h-full max-w-3xl mx-auto px-4 py-5 flex flex-col">
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div>
            <div className="text-[10px] tracking-[0.35em] text-[#ffd23f] font-bold">MATCH SETUP</div>
            <div className="font-disp text-3xl md:text-4xl text-white inline-flex items-center gap-3" style={{ textShadow: "3px 3px 0 rgba(25,211,255,0.5)" }}>
              <SettingsIcon size={30} /> SETTINGS
            </div>
          </div>
          <button onClick={onClose} className="btn-blade font-disp text-lg px-8 py-2.5 text-[#04121c]" style={{ background: "#ffd23f" }}>
            ◂ DONE
          </button>
        </div>

        <div className="text-[11px] text-white/45 font-semibold tracking-wider mb-4">
          These are the starting picks — you can still change flag & strategy at the beginning of every game.
        </div>

        <div className="howto-scroll overflow-y-auto pr-2 space-y-3 rise-in">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <TeamBlock t={0} />
            <TeamBlock t={1} />
          </div>

          <div className="panel chamfer-sm p-4">
            <div className="font-disp text-sm text-white mb-3">AUDIO</div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-[13px] text-white/75 font-semibold">Sound effects</span>
              <button
                onClick={() => { set({ sound: !s.sound }); }}
                aria-pressed={s.sound}
                className="relative w-16 h-8 chamfer-sm transition-colors"
                style={{ background: s.sound ? "#3f8f63" : "#3a4a5c" }}
              >
                <span
                  className="absolute top-1 w-6 h-6 bg-white chamfer-sm transition-all"
                  style={{ left: s.sound ? "calc(100% - 28px)" : "4px" }}
                />
              </button>
            </div>
            <div className={`transition-opacity ${s.sound ? "opacity-100" : "opacity-35 pointer-events-none"}`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[13px] text-white/75 font-semibold">Volume</span>
                <span className="font-disp text-sm text-[#ffd23f]">{Math.round(s.volume * 100)}%</span>
              </div>
              <input
                type="range" min={0} max={100} value={Math.round(s.volume * 100)}
                onChange={(e) => set({ volume: Number(e.target.value) / 100 })}
                className="w-full vol-range" aria-label="Volume"
                style={{ ["--vol" as any]: `${Math.round(s.volume * 100)}%` }}
              />
            </div>
          </div>

          <div className="panel chamfer-sm px-4 py-2.5 text-center text-[11px] tracking-[0.22em] text-white/45 font-bold">
            CHANGES SAVE AUTOMATICALLY · ESC TO CLOSE
          </div>
        </div>
      </div>
    </div>
  );
}
