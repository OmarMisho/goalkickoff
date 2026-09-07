// ── Turf Clash: shared definitions ─────────────────────────────────────
// The stadium lives in a virtual 700 × 980 space; the pitch is inset.

export const W = 700;
export const H = 980;
export const PITCH = { x0: 70, x1: 630, y0: 110, y1: 870 };
export const CX = W / 2;
export const MID_Y = H / 2;
export const GOAL_W = 240;
export const GOAL_D = 42;
export const BALL_R = 19;
export const STICK_R = 32;
export const AIM_TIME = 20; // shot clock seconds
export const TARGET_SCORE = 3; // first to 3 wins
export const MISS_LIMIT = 2; // miss this many turns in a row = forfeit

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface Vec {
  x: number;
  y: number;
}

export type Phase = 'kickoff' | 'aim' | 'sim' | 'goal' | 'over';

// Settings / Snapshot / GameStats cross the P2P wire, so they are `type`
// aliases (not interfaces) to satisfy the JsonValue index-signature constraint.
export type Settings = {
  p1Name: string;
  p2Name: string;
  f1: string;
  f2: string;
  skin1: string;
  skin2: string;
  chargeSound: string; // which stretch/charge sound plays while pulling back
};

// Host-authoritative snapshot streamed ~20Hz to the guest device.
export type Snapshot = {
  s1: number;
  s2: number;
  turn: 0 | 1;
  phase: Phase;
  clock: number;
  m1: number;
  m2: number;
  bx: number;
  by: number;
  bvx: number;
  bvy: number;
  bsp: number; // ball spin
  st: number[]; // 10 sticks × (x,y); indices 0-4 = team 0, 5-9 = team 1
};

// Guest → host strike command.
export type StrikeMsg = {
  slot: number;
  dx: number;
  dy: number;
  p: number;
};

export const CHARGE_SOUND_KEY = 'turfclash.chargeSound';

export interface FormationDef {
  id: string;
  name: string;
  rows: [number, number, number]; // attacker / midfield / defender stick counts
  tag: string;
}

export const FORMATIONS: FormationDef[] = [
  { id: '221', name: '2-2-1', rows: [2, 2, 1], tag: 'BALANCED' },
  { id: '122', name: '1-2-2', rows: [1, 2, 2], tag: 'FORTRESS' },
  { id: '212', name: '2-1-2', rows: [2, 1, 2], tag: 'COUNTER' },
  { id: '311', name: '3-1-1', rows: [3, 1, 1], tag: 'BLITZ' },
  { id: '131', name: '1-3-1', rows: [1, 3, 1], tag: 'MID WALL' },
  { id: '113', name: '1-1-3', rows: [1, 1, 3], tag: 'LOCKDOWN' },
];

export function formationById(id: string): FormationDef {
  return FORMATIONS.find((f) => f.id === id) ?? FORMATIONS[0];
}

// ── Team palette: GOLD (bottom, attacks up) vs CYAN (top, attacks down) ─
export const TEAM = [
  { name: 'GOLD', color: '#ffc400', dark: '#8a6200', light: '#ffe38a', glow: 'rgba(255,196,0,0.55)' },
  { name: 'CYAN', color: '#00e0ff', dark: '#00616e', light: '#a8f4ff', glow: 'rgba(0,224,255,0.55)' },
] as const;

export function formationSlots(rows: [number, number, number], team: 0 | 1) {
  const xs: Record<number, number[]> = {
    1: [CX],
    2: [CX - 140, CX + 140],
    3: [CX - 180, CX, CX + 180],
  };
  const ys = team === 0 ? [560, 680, 800] : [420, 300, 180];
  const out: { x: number; y: number }[] = [];
  rows.forEach((count, rowIdx) => {
    const arr = xs[count] ?? [CX];
    arr.forEach((x) => out.push({ x, y: ys[rowIdx] }));
  });
  return out;
}

export interface HudState {
  s1: number;
  s2: number;
  turn: 0 | 1;
  phase: Phase;
  clock: number;
  m1: number; // missed turns in a row (forfeit warning)
  m2: number;
}

export type GameStats = {
  winner: 0 | 1;
  s1: number;
  s2: number;
  shots: [number, number];
  goals: [number, number];
  hardest: [number, number]; // km/h
  reason: 'goals' | 'forfeit';
};

export interface EngineCallbacks {
  onHud: (h: HudState) => void;
  onBanner: (text: string, color: string, sub?: string) => void;
  onGameOver: (s: GameStats) => void;
}
