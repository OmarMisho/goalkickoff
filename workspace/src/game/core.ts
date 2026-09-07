export const W = 1280;
export const H = 720;

/** pitch touch-line rectangle (logical units) */
export const PITCH = { l: 96, t: 86, r: 1184, b: 634 };
export const PITCH_CX = (PITCH.l + PITCH.r) / 2;
export const PITCH_CY = (PITCH.t + PITCH.b) / 2;
export const HALF_W = PITCH_CX - PITCH.l;

/** goal mouth: half height + net depth */
export const GOAL = { half: 78, depth: 46 };

export const R_COIN = 35; // big, finger-friendly coins
export const R_BALL = 15;

/* ------- timing: 120s round split into 10s segments (spec) ------- */
export const SEG_SECS = 10;
export const TICKS_PER_ROUND = 12; // 12 x 10s = 120s round
export const PLAN_TIME = 10; // secret planning window per segment
export const FORM_TIME = 10; // strategy pick window before each round

/* ------- resolve playback ------- */
export const MOVE_DUR = 1.15; // coin travel window inside the resolve sim (ball flight spans it too)
export const PHYS_DUR = 2.4; // physics sim time per segment
export const RESOLVE_TOTAL = 2.75; // full resolve timeline (incl. settle tail)

export const WIN_GOALS = 2;

export type Team = 0 | 1;

export interface Vec {
  x: number;
  y: number;
}

export interface PassPlan {
  target: Vec;
  kind: "point" | "goal";
  receiverId?: number | null;
}

export interface TeamPlan {
  moves: (Vec | null)[]; // planned target per coin index
  pass: PassPlan | null;
}

export const emptyPlan = (): TeamPlan => ({
  moves: [null, null, null, null, null],
  pass: null,
});

export const TEAM_COLOR = ["#19d3ff", "#ff3860"];
export const TEAM_DEEP = ["#0a7ea8", "#a81236"];
export const TEAM_GLOW = ["rgba(25,211,255,0.55)", "rgba(255,56,96,0.55)"];

/* ---------------- roles & the two circles ---------------- */

export type Role = "def" | "mid" | "att";

/** outer circle: how far each role may move around its anchor (scaled for the big coins) */
export const ORBIT: Record<Role, number> = { def: 150, mid: 185, att: 220 };
export const ROLE_LABEL: Record<Role, string> = { def: "DEF", mid: "MID", att: "ATT" };

/* ---------------- formations ---------------- */

export interface Formation {
  id: string;
  rows: number[]; // coins per row, own goal -> halfway line
}

export const FORMATIONS: Formation[] = [
  { id: "2-1-2", rows: [2, 1, 2] },
  { id: "3-1-1", rows: [3, 1, 1] },
  { id: "2-2-1", rows: [2, 2, 1] },
  { id: "1-2-2", rows: [1, 2, 2] },
  { id: "1-3-1", rows: [1, 3, 1] },
  { id: "1-1-3", rows: [1, 1, 3] },
];

export interface Slot {
  x: number;
  y: number;
  role: Role;
}

/**
 * Starting slots + roles for a team. team 0 attacks right (owns left half),
 * team 1 attacks left (owns right half). First row defends, last row attacks.
 */
export function formationSlotsWithRoles(f: Formation, team: Team): Slot[] {
  const n = f.rows.length;
  const slots: Slot[] = [];
  f.rows.forEach((count, i) => {
    const frac = n === 1 ? 0.5 : 0.16 + (0.76 * i) / (n - 1);
    const dd = frac * (HALF_W - 42);
    const x = team === 0 ? PITCH.l + 30 + dd : PITCH.r - 30 - dd;
    const gap = Math.min(158, (PITCH.b - PITCH.t - 70) / count);
    const role: Role = i === 0 ? "def" : i === n - 1 ? "att" : "mid";
    for (let j = 0; j < count; j++) {
      let y = PITCH_CY + (j - (count - 1) / 2) * gap;
      // a coin dead on the centre spot sits around the centre circle instead —
      // no head-on first clash in the middle of the park
      if (Math.abs(y - PITCH_CY) < 1) y = PITCH_CY + (team === 0 ? -46 : 46);
      slots.push({ x, y, role });
    }
  });
  return slots;
}

/** plain positions (UI previews) */
export function formationSlots(f: Formation, team: Team): Vec[] {
  return formationSlotsWithRoles(f, team).map((s) => ({ x: s.x, y: s.y }));
}

/** clamp a coin target inside its outer movement circle + pitch bounds */
export function clampToOrbit(p: Vec, anchor: Vec, orbit: number): Vec {
  const dx = p.x - anchor.x;
  const dy = p.y - anchor.y;
  const d = Math.hypot(dx, dy);
  let x = p.x;
  let y = p.y;
  if (d > orbit) {
    x = anchor.x + (dx / d) * orbit;
    y = anchor.y + (dy / d) * orbit;
  }
  const m = R_COIN + 4;
  x = Math.min(Math.max(x, PITCH.l + m), PITCH.r - m);
  y = Math.min(Math.max(y, PITCH.t + m), PITCH.b - m);
  return { x, y };
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export const easeInOut = (t: number) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

export function goalMouthPoint(team: Team, aim: Vec): Vec {
  const gx = team === 0 ? PITCH.r : PITCH.l;
  const y = Math.min(Math.max(aim.y, PITCH_CY - GOAL.half + 12), PITCH_CY + GOAL.half - 12);
  return { x: gx, y };
}

export function insideGoalMouth(p: Vec, scoringTeam: Team): boolean {
  const gx = scoringTeam === 0 ? PITCH.r : PITCH.l;
  const near = scoringTeam === 0 ? p.x > gx - 46 : p.x < gx + 46;
  return near && Math.abs(p.y - PITCH_CY) < GOAL.half;
}

/* ---------------- persistent settings ---------------- */

export interface Settings {
  flags: [string, string];
  forms: [string, string];
  sound: boolean;
  volume: number; // 0..1
}

export const DEFAULT_SETTINGS: Settings = {
  flags: ["bra", "blaugrana"],
  forms: ["2-1-2", "2-1-2"],
  sound: true,
  volume: 0.8,
};

const SETTINGS_KEY = "kickoff-tactics-settings";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
