import {
  W, H, PITCH, GOAL_W, GOAL_D, BALL_R, STICK_R, CX, MID_Y,
  TARGET_SCORE, AIM_TIME, MISS_LIMIT, TEAM, formationById, formationSlots,
  clamp, lerp,
} from './defs';
import type { Settings, HudState, Phase, EngineCallbacks, GameStats, Vec, Snapshot, StrikeMsg } from './defs';
import { sfx, chargeStart, chargeSet, chargeStop } from './audio';

export type EngineMode = 'hotseat' | 'host' | 'guest';

export interface EngineOpts {
  mode?: EngineMode;
  // guest only: called with strike params instead of simulating locally
  onGuestStrike?: (s: StrikeMsg) => void;
}
import { paintStick, drawFootball } from './skins';

const { x0, x1, y0, y1 } = PITCH;

interface Body {
  x: number; y: number; vx: number; vy: number;
  r: number; m: number;
  kind: 'ball' | 'stick' | 'post';
  team: 0 | 1;
  slot: number;
  spin: number;
  hx: number; hy: number; // home slot
  trail: Vec[];
}

interface Particle {
  x: number; y: number; vx: number; vy: number;
  t: number; life: number; size: number; color: string;
  kind: 'spark' | 'confetti' | 'dust' | 'flash';
  rot: number; vr: number;
}

interface Floater {
  x: number; y: number; t: number; life: number;
  text: string; size: number; color: string;
}

const LAUNCH_MIN = 300;
const LAUNCH_SPAN = 780;
const STRETCH = 170; // px of pull for full power

export class Engine {
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private cb: EngineCallbacks;
  private settings: Settings;

  private raf = 0;
  private last = 0;
  private destroyed = false;
  private paused = false;
  private time = 0;

  private mode: EngineMode = 'hotseat';
  private onGuestStrike: ((s: StrikeMsg) => void) | null = null;
  private snap: Snapshot | null = null;
  private guestCooldown = 0;

  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private viewS = 1;
  private viewX = 0;
  private viewY = 0;
  private ro: ResizeObserver | null = null;

  private phase: Phase = 'kickoff';
  private phaseT = 0;
  private turn: 0 | 1 = 0;
  private striker: 0 | 1 = 0;
  private scores: [number, number] = [0, 0];
  private shots: [number, number] = [0, 0];
  private hardest: [number, number] = [0, 0];
  private misses: [number, number] = [0, 0]; // consecutive missed turns (shot clock expired)
  private aimClock = AIM_TIME;
  private lastTick = 99;
  private simTime = 0;
  private settleT = 0;
  private pendingWinner: 0 | 1 | null = null;
  private goalSide: 0 | 1 = 0;
  private goalFlash = 0;
  private postToastCd = 0;

  private ball: Body;
  private sticks: Body[] = [];
  private posts: Body[] = [];

  private aimStick: Body | null = null;
  private dragging = false;
  private moved = 0;
  private px = 0;
  private py = 0;
  private power = 0;
  private dirX = 0;
  private dirY = -1;

  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  private shake = 0;

  private crowd: { x: number; y: number; c: string; tw: number }[] = [];
  private lastHud = '';

  constructor(canvas: HTMLCanvasElement, settings: Settings, cb: EngineCallbacks, opts?: EngineOpts) {
    this.cv = canvas;
    this.cb = cb;
    this.settings = settings;
    this.mode = opts?.mode ?? 'hotseat';
    this.onGuestStrike = opts?.onGuestStrike ?? null;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('no 2d context');
    this.g = g;

    this.ball = this.mkBody(CX, MID_Y, BALL_R, 1, 'ball', 0, -1);
    const mk = (p: 0 | 1) => {
      const f = formationById(p === 0 ? settings.f1 : settings.f2);
      formationSlots(f.rows, p).forEach((s, i) => {
        this.sticks.push(this.mkBody(s.x, s.y, STICK_R, 4.5, 'stick', p, i));
      });
    };
    mk(0);
    mk(1);
    const post = (x: number, y: number) => {
      const b = this.mkBody(x, y, 5, Infinity, 'post', 0, -1);
      this.posts.push(b);
    };
    post(CX - GOAL_W / 2, y0);
    post(CX + GOAL_W / 2, y0);
    post(CX - GOAL_W / 2, y1);
    post(CX + GOAL_W / 2, y1);

    // crowd dots in the stands around the pitch
    const strips = [
      { a: 0, b: W, c: 0, d: y0 - 6 },
      { a: 0, b: W, c: y1 + 6, d: H },
      { a: 0, b: x0 - 6, c: y0 - 6, d: y1 + 6 },
      { a: x1 + 6, b: W, c: y0 - 6, d: y1 + 6 },
    ];
    const palette = ['#14402b', '#0f3523', '#1a4a31', '#123a27', '#1e5438', '#0d2f1f'];
    for (let i = 0; i < 420; i++) {
      const s = strips[i % strips.length];
      this.crowd.push({
        x: s.a + Math.random() * (s.b - s.a),
        y: s.c + Math.random() * (s.d - s.c),
        c: palette[Math.floor(Math.random() * palette.length)],
        tw: Math.random() * Math.PI * 2,
      });
    }

    this.attachInput();
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
  }

  private mkBody(x: number, y: number, r: number, m: number, kind: Body['kind'], team: 0 | 1, slot: number): Body {
    return { x, y, vx: 0, vy: 0, r, m, kind, team, slot, spin: 0, hx: x, hy: y, trail: [] };
  }

  // ── lifecycle ────────────────────────────────────────────────────────
  start() {
    // guests receive banners as network events from the host
    if (this.mode !== 'guest') {
      this.cb.onBanner('KICK OFF', '#eaffdf', `${this.settings.p1Name} VS ${this.settings.p2Name}`);
    }
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.detachInput();
    chargeStop();
  }

  pause() {
    this.paused = true;
    this.dragging = false;
    chargeStop();
  }
  resume() {
    this.paused = false;
    this.last = performance.now();
  }
  getPaused() {
    return this.paused;
  }

  // ── input ────────────────────────────────────────────────────────────
  // In net play the local device always controls one fixed side:
  // host = team 0 (gold, bottom), guest = team 1 (cyan, top).
  private get localTeam(): 0 | 1 {
    return this.mode === 'guest' ? 1 : 0;
  }

  private onDown = (e: PointerEvent) => {
    if (this.phase !== 'aim' || this.paused) return;
    if (this.mode !== 'hotseat' && this.turn !== this.localTeam) return;
    if (this.mode === 'guest' && this.guestCooldown > 0) return;
    e.preventDefault();
    const p = this.toWorld(e);
    this.px = p.x;
    this.py = p.y;
    this.moved = 0;
    const own = this.sticks.filter((s) => s.team === this.turn);
    let hit: Body | null = null;
    let best = STICK_R * 2.1;
    for (const s of own) {
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d < best) {
        best = d;
        hit = s;
      }
    }
    if (hit) {
      if (this.aimStick !== hit) sfx.select();
      this.aimStick = hit;
    }
    if (this.aimStick) {
      this.dragging = true;
      try {
        this.cv.setPointerCapture(e.pointerId);
      } catch { /* noop */ }
      chargeStart();
      this.updateAim();
    }
  };

  private onMove = (e: PointerEvent) => {
    const p = this.toWorld(e);
    this.moved += Math.hypot(p.x - this.px, p.y - this.py);
    this.px = p.x;
    this.py = p.y;
    if (this.dragging) this.updateAim();
  };

  private onUp = () => {
    if (!this.dragging) return;
    this.dragging = false;
    chargeStop();
    if (this.phase !== 'aim') return;
    if (this.power >= 0.09 && this.moved > 8) this.launch();
    else this.power = 0;
  };

  private onCancel = () => {
    this.dragging = false;
    this.power = 0;
    chargeStop();
  };

  private onKey = (e: KeyboardEvent) => {
    if (this.phase !== 'aim' || this.paused) return;
    if (this.mode !== 'hotseat' && this.turn !== this.localTeam) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 5) {
      const own = this.sticks.filter((s) => s.team === this.turn);
      const s = own[n - 1];
      if (s && this.aimStick !== s) {
        this.aimStick = s;
        sfx.select();
      }
    }
    if (e.key === 'Escape') {
      this.aimStick = null;
      this.onCancel();
    }
  };

  private onCtx = (e: Event) => e.preventDefault();

  private attachInput() {
    this.cv.addEventListener('pointerdown', this.onDown);
    this.cv.addEventListener('pointermove', this.onMove);
    this.cv.addEventListener('pointerup', this.onUp);
    this.cv.addEventListener('pointercancel', this.onCancel);
    this.cv.addEventListener('contextmenu', this.onCtx);
    window.addEventListener('keydown', this.onKey);
  }
  private detachInput() {
    this.cv.removeEventListener('pointerdown', this.onDown);
    this.cv.removeEventListener('pointermove', this.onMove);
    this.cv.removeEventListener('pointerup', this.onUp);
    this.cv.removeEventListener('pointercancel', this.onCancel);
    this.cv.removeEventListener('contextmenu', this.onCtx);
    window.removeEventListener('keydown', this.onKey);
  }

  private toWorld(e: PointerEvent): Vec {
    const rect = this.cv.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - this.viewX) / this.viewS,
      y: (e.clientY - rect.top - this.viewY) / this.viewS,
    };
  }

  private resize() {
    const parent = this.cv.parentElement;
    const cw = parent ? parent.clientWidth : window.innerWidth;
    const ch = parent ? parent.clientHeight : window.innerHeight;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cssW = cw;
    this.cssH = ch;
    this.cv.width = Math.max(1, Math.round(cw * this.dpr));
    this.cv.height = Math.max(1, Math.round(ch * this.dpr));
    this.cv.style.width = `${cw}px`;
    this.cv.style.height = `${ch}px`;
    this.viewS = Math.min(cw / W, ch / H);
    this.viewX = (cw - W * this.viewS) / 2;
    this.viewY = (ch - H * this.viewS) / 2;
  }

  // ── aim ──────────────────────────────────────────────────────────────
  private updateAim() {
    const s = this.aimStick;
    if (!s) return;
    const dx = s.x - this.px;
    const dy = s.y - this.py;
    const len = Math.hypot(dx, dy);
    if (len < 1) {
      this.power = 0;
      return;
    }
    this.dirX = dx / len;
    this.dirY = dy / len;
    this.power = clamp(len / STRETCH, 0, 1);
    chargeSet(this.power);
  }

  private launch() {
    const s = this.aimStick;
    if (!s) return;
    const dx = this.dirX;
    const dy = this.dirY;
    const p = this.power;
    if (this.mode === 'guest') {
      // guest never simulates — the strike is shipped to the host, and the
      // resulting snapshots drive what this device renders
      this.dragging = false;
      chargeStop();
      this.aimStick = null;
      this.power = 0;
      this.guestCooldown = 0.45;
      this.onGuestStrike?.({ slot: s.slot, dx, dy, p });
      return;
    }
    this.launchStick(s, dx, dy, p);
  }

  private launchStick(s: Body, dx: number, dy: number, power: number) {
    const speed = LAUNCH_MIN + clamp(power, 0, 1) * LAUNCH_SPAN;
    s.vx = dx * speed;
    s.vy = dy * speed;
    this.shots[this.turn]++;
    this.hardest[this.turn] = Math.max(this.hardest[this.turn], speed);
    this.misses[this.turn] = 0; // they played — forfeit counter resets
    this.striker = this.turn;
    this.phase = 'sim';
    this.simTime = 0;
    this.settleT = 0;
    this.power = 0;
    this.shake = Math.max(this.shake, 3);
    sfx.twang();
    sfx.kick(power || 0.3);
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      this.particles.push({
        x: s.x, y: s.y, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60,
        t: 0, life: 0.35, size: 3 + Math.random() * 3,
        color: 'rgba(230,255,220,0.5)', kind: 'dust', rot: 0, vr: 0,
      });
    }
  }

  // Host: apply a strike received from the guest device.
  remoteStrike(slot: number, dx: number, dy: number, p: number) {
    if (this.mode !== 'host' || this.paused) return;
    if (this.phase !== 'aim' || this.turn !== 1) return;
    const s = this.sticks.find((st) => st.team === 1 && st.slot === slot);
    if (!s) return;
    this.launchStick(s, dx, dy, p);
  }

  // ── turn machine ─────────────────────────────────────────────────────
  private beginAim() {
    this.phase = 'aim';
    this.aimClock = AIM_TIME;
    this.lastTick = 99;
    this.nearestSelect();
    sfx.whistle(1);
  }

  private nearestSelect() {
    const own = this.sticks.filter((s) => s.team === this.turn);
    let best: Body | null = null;
    let bd = Infinity;
    for (const s of own) {
      const d = Math.hypot(s.x - this.ball.x, s.y - this.ball.y);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    this.aimStick = best;
  }

  private swapTurn() {
    this.turn = (1 - this.turn) as 0 | 1;
    this.striker = this.turn;
    this.phase = 'aim';
    this.aimClock = AIM_TIME;
    this.lastTick = 99;
    this.aimStick = null;
    this.power = 0;
    this.dragging = false;
    chargeStop();
    this.nearestSelect();
    const t = TEAM[this.turn];
    const name = this.turn === 0 ? this.settings.p1Name : this.settings.p2Name;
    this.cb.onBanner(`${name} TO STRIKE`, t.color, 'PICK A STICK • PULL BACK • RELEASE');
  }

  // Shot clock expired: the striker failed to play a turn.
  private missTurn() {
    const t = this.striker;
    this.misses[t] += 1;
    this.dragging = false;
    this.aimStick = null;
    this.power = 0;
    chargeStop();
    const name = t === 0 ? this.settings.p1Name : this.settings.p2Name;
    if (this.misses[t] >= MISS_LIMIT) {
      this.forfeitMatch(t);
      return;
    }
    this.floater(CX, MID_Y, 'SHOT CLOCK!', 34, '#ff4d1c');
    this.cb.onBanner(
      'TOO SLOW!',
      '#ff4d1c',
      `${name} MISSED A TURN (${this.misses[t]}/${MISS_LIMIT}) — ONE MORE AND IT'S A FORFEIT`
    );
    sfx.whistle(1);
    this.shake = Math.max(this.shake, 3);
    this.swapTurn();
  }

  // Two missed turns in a row: the rival is awarded the match at 3.
  private forfeitMatch(loser: 0 | 1) {
    const w = (1 - loser) as 0 | 1;
    this.scores[w] = Math.max(this.scores[w], TARGET_SCORE);
    this.phase = 'over';
    this.phaseT = 0;
    this.dragging = false;
    chargeStop();
    sfx.over();
    this.shake = 12;
    this.goalFlash = 1;
    const wName = w === 0 ? this.settings.p1Name : this.settings.p2Name;
    const lName = loser === 0 ? this.settings.p1Name : this.settings.p2Name;
    this.floater(CX, MID_Y, 'FORFEIT!', 58, '#ff4d1c');
    this.cb.onBanner(
      'FORFEIT!',
      '#ff4d1c',
      `${lName} MISSED ${MISS_LIMIT} TURNS — ${wName} WINS ${this.scores[0]}–${this.scores[1]}`
    );
    this.burst(CX, MID_Y, 90, ['#ff4d1c', '#ffc400', '#ffffff', TEAM[w].color]);
    this.cb.onGameOver({
      winner: w,
      s1: this.scores[0],
      s2: this.scores[1],
      shots: [...this.shots] as [number, number],
      goals: [...this.scores] as [number, number],
      hardest: [Math.round(this.hardest[0] * 0.12), Math.round(this.hardest[1] * 0.12)],
      reason: 'forfeit',
    });
    this.emitHud();
  }

  private resolveTurn() {
    const crossed = this.striker === 0 ? this.ball.y < MID_Y : this.ball.y > MID_Y;
    if (!crossed) {
      this.floater(CX, clamp(this.ball.y, y0 + 60, y1 - 60), "DIDN'T CROSS THE HALF!", 20, '#ffb59d');
    }
    this.swapTurn();
  }

  private kickoff(side: 0 | 1) {
    for (const s of this.sticks) {
      s.x = s.hx;
      s.y = s.hy;
      s.vx = 0;
      s.vy = 0;
    }
    this.ball.x = CX;
    this.ball.y = MID_Y;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.trail = [];
    this.turn = side;
    this.striker = side;
    this.phase = 'kickoff';
    this.phaseT = 0;
    this.aimStick = null;
    this.power = 0;
    this.cb.onBanner('KICK OFF', TEAM[side].color, `${side === 0 ? this.settings.p1Name : this.settings.p2Name} STRIKES FIRST`);
  }

  private goalScored(side: 0 | 1) {
    this.scores[side]++;
    this.goalSide = side;
    this.phase = 'goal';
    this.phaseT = 0;
    this.goalFlash = 1;
    this.shake = 17;
    this.dragging = false;
    chargeStop();
    sfx.goal();
    const gy = side === 0 ? y0 : y1;
    this.burst(CX, gy, 90, [TEAM[side].color, TEAM[side].light, '#ffffff', '#ff4d1c']);
    const name = side === 0 ? this.settings.p1Name : this.settings.p2Name;
    this.floater(CX, MID_Y, 'GOOOAL!', 64, TEAM[side].color);
    this.cb.onBanner(`GOAL — ${name}!`, TEAM[side].color, `${this.scores[0]} — ${this.scores[1]}`);
    if (this.scores[side] >= TARGET_SCORE) this.pendingWinner = side;
  }

  private finishMatch() {
    this.phase = 'over';
    this.phaseT = 0;
    sfx.over();
    const w = this.pendingWinner ?? 0;
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        if (this.destroyed) return;
        this.burst(CX + (i - 1) * 160, MID_Y - 120 + i * 90, 70, [TEAM[w].color, TEAM[w].light, '#ffffff', '#ffc400', '#00e0ff']);
      }, i * 350);
    }
    const stats: GameStats = {
      winner: w,
      s1: this.scores[0],
      s2: this.scores[1],
      shots: [...this.shots] as [number, number],
      goals: [...this.scores] as [number, number],
      hardest: [Math.round(this.hardest[0] * 0.12), Math.round(this.hardest[1] * 0.12)],
      reason: 'goals',
    };
    this.cb.onGameOver(stats);
  }

  // ── physics ──────────────────────────────────────────────────────────
  private physics(dt: number) {
    const steps = 4;
    const h = dt / steps;
    const bodies = [this.ball, ...this.sticks];
    for (let i = 0; i < steps; i++) {
      for (const b of bodies) {
        if (b.m === Infinity) continue;
        b.x += b.vx * h;
        b.y += b.vy * h;
        const k = b.kind === 'ball' ? 1.05 : 2.6;
        const f = Math.exp(-k * h);
        b.vx *= f;
        b.vy *= f;
        if (Math.hypot(b.vx, b.vy) < (b.kind === 'ball' ? 3 : 2)) {
          b.vx = 0;
          b.vy = 0;
        }
      }
      for (const b of bodies) this.walls(b);
      const all = [...bodies, ...this.posts];
      for (let a = 0; a < all.length; a++) {
        for (let c = a + 1; c < all.length; c++) this.collide(all[a], all[c]);
      }
      if (this.phase === 'sim') this.checkGoal();
    }
    // ball spin + trail
    const b = this.ball;
    b.spin += b.vx * dt * 0.045;
    if (Math.hypot(b.vx, b.vy) > 60) {
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > 12) b.trail.shift();
    } else if (b.trail.length) {
      b.trail.shift();
    }
  }

  private walls(b: Body) {
    if (b.kind === 'post') return;
    const e = b.kind === 'ball' ? 0.86 : 0.55;
    if (b.kind === 'stick') {
      if (b.x < x0 + b.r) { b.x = x0 + b.r; b.vx = Math.abs(b.vx) * e; }
      if (b.x > x1 - b.r) { b.x = x1 - b.r; b.vx = -Math.abs(b.vx) * e; }
      if (b.y < y0 + b.r) { b.y = y0 + b.r; b.vy = Math.abs(b.vy) * e; }
      if (b.y > y1 - b.r) { b.y = y1 - b.r; b.vy = -Math.abs(b.vy) * e; }
      return;
    }
    // ball
    const inMouth = Math.abs(b.x - CX) < GOAL_W / 2 - b.r * 0.35;
    if (b.x < x0 + b.r) { b.x = x0 + b.r; b.vx = Math.abs(b.vx) * e; this.wallFx(b); }
    if (b.x > x1 - b.r) { b.x = x1 - b.r; b.vx = -Math.abs(b.vx) * e; this.wallFx(b); }
    if (!inMouth) {
      if (b.y < y0 + b.r) { b.y = y0 + b.r; b.vy = Math.abs(b.vy) * e; this.wallFx(b); }
      if (b.y > y1 - b.r) { b.y = y1 - b.r; b.vy = -Math.abs(b.vy) * e; this.wallFx(b); }
    } else {
      // inside goal boxes
      if (b.y < y0) {
        const back = y0 - GOAL_D + b.r;
        if (b.y < back) { b.y = back; b.vy = Math.abs(b.vy) * 0.25; }
        const gl = CX - GOAL_W / 2 + b.r;
        const gr = CX + GOAL_W / 2 - b.r;
        if (b.x < gl) { b.x = gl; b.vx = Math.abs(b.vx) * 0.5; }
        if (b.x > gr) { b.x = gr; b.vx = -Math.abs(b.vx) * 0.5; }
      }
      if (b.y > y1) {
        const back = y1 + GOAL_D - b.r;
        if (b.y > back) { b.y = back; b.vy = -Math.abs(b.vy) * 0.25; }
        const gl = CX - GOAL_W / 2 + b.r;
        const gr = CX + GOAL_W / 2 - b.r;
        if (b.x < gl) { b.x = gl; b.vx = Math.abs(b.vx) * 0.5; }
        if (b.x > gr) { b.x = gr; b.vx = -Math.abs(b.vx) * 0.5; }
      }
    }
  }

  private wallFx(b: Body) {
    const v = Math.hypot(b.vx, b.vy);
    if (v > 90) {
      sfx.bounce(v);
      this.sparks(b.x, b.y, 3, '#eaffdf');
    }
  }

  private collide(a: Body, b: Body) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let d = Math.hypot(dx, dy);
    const min = a.r + b.r;
    if (d >= min) return;
    if (d < 0.001) d = 0.001;
    const nx = dx / d;
    const ny = dy / d;
    const ima = a.m === Infinity ? 0 : 1 / a.m;
    const imb = b.m === Infinity ? 0 : 1 / b.m;
    const ims = ima + imb;
    if (ims === 0) return;
    const overlap = min - d;
    a.x -= nx * overlap * (ima / ims);
    a.y -= ny * overlap * (ima / ims);
    b.x += nx * overlap * (imb / ims);
    b.y += ny * overlap * (imb / ims);
    const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rv >= 0) return;
    const ballIn = a.kind === 'ball' || b.kind === 'ball';
    const postIn = a.kind === 'post' || b.kind === 'post';
    const e = postIn ? 0.92 : ballIn ? 0.88 : 0.55;
    const j = (-(1 + e) * rv) / ims;
    a.vx -= nx * j * ima;
    a.vy -= ny * j * ima;
    b.vx += nx * j * imb;
    b.vy += ny * j * imb;
    const impact = -rv;
    const cx = a.x + nx * a.r;
    const cy = a.y + ny * a.r;
    if (postIn && ballIn) {
      if (impact > 120) {
        sfx.post();
        this.sparks(cx, cy, 10, '#ffffff');
        this.shake = Math.max(this.shake, 5);
        if (this.postToastCd <= 0) {
          this.floater(CX, a.kind === 'ball' && a.y < MID_Y ? y0 + 70 : y1 - 70, 'OFF THE POST!', 26, '#ffffff');
          this.postToastCd = 1.2;
        }
      }
    } else if (impact > 110) {
      if (ballIn) {
        sfx.kick(clamp(impact / 900, 0.2, 1));
        this.sparks(cx, cy, 8, TEAM[a.kind === 'ball' ? b.team : a.team].light);
        if (impact > 420) this.shake = Math.max(this.shake, 4);
      } else {
        sfx.clack(impact);
        this.sparks(cx, cy, 5, '#cfe9d8');
      }
    }
  }

  private checkGoal() {
    const b = this.ball;
    if (b.y < y0 - 7) this.goalScored(0);
    else if (b.y > y1 + 7) this.goalScored(1);
  }

  private allSettled() {
    if (Math.hypot(this.ball.vx, this.ball.vy) > 7) return false;
    for (const s of this.sticks) if (Math.hypot(s.vx, s.vy) > 4) return false;
    return true;
  }

  private freezeAll() {
    this.ball.vx = this.ball.vy = 0;
    for (const s of this.sticks) {
      s.vx = 0;
      s.vy = 0;
    }
  }

  // ── fx ───────────────────────────────────────────────────────────────
  private sparks(x: number, y: number, n: number, color: string) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 90 + Math.random() * 260;
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        t: 0, life: 0.25 + Math.random() * 0.25, size: 1.5 + Math.random() * 2.5,
        color, kind: 'spark', rot: 0, vr: 0,
      });
    }
  }

  private burst(x: number, y: number, n: number, colors: string[]) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 380;
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120,
        t: 0, life: 0.9 + Math.random() * 0.9, size: 3 + Math.random() * 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        kind: 'confetti', rot: Math.random() * 6.3, vr: (Math.random() - 0.5) * 12,
      });
    }
  }

  private floater(x: number, y: number, text: string, size: number, color: string) {
    this.floaters.push({ x, y, t: 0, life: 1.3, text, size, color });
  }

  private updateParticles(dt: number) {
    for (const p of this.particles) {
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'confetti') {
        p.vy += 420 * dt;
        p.vx *= Math.exp(-1.2 * dt);
        p.rot += p.vr * dt;
      } else if (p.kind === 'spark') {
        p.vx *= Math.exp(-4 * dt);
        p.vy *= Math.exp(-4 * dt);
      } else {
        p.vx *= Math.exp(-3 * dt);
        p.vy *= Math.exp(-3 * dt);
      }
    }
    this.particles = this.particles.filter((p) => p.t < p.life);
    for (const f of this.floaters) {
      f.t += dt;
      f.y -= 22 * dt;
    }
    this.floaters = this.floaters.filter((f) => f.t < f.life);
  }

  // ── main loop ────────────────────────────────────────────────────────
  private loop = (t: number) => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = clamp((t - this.last) / 1000, 0.001, 0.05);
    this.last = t;
    if (!this.paused) {
      this.time += dt;
      this.update(dt);
    }
    this.render();
  };

  private update(dt: number) {
    this.phaseT += dt;
    this.postToastCd -= dt;
    this.shake *= Math.exp(-6 * dt);
    this.goalFlash = Math.max(0, this.goalFlash - dt * 1.1);
    this.updateParticles(dt);

    if (this.mode === 'guest') {
      // guest renders what the host simulates: glide bodies toward the
      // latest snapshot instead of stepping physics locally
      this.guestCooldown = Math.max(0, this.guestCooldown - dt);
      this.smoothSnap(dt);
      return;
    }

    if (this.phase === 'kickoff') {
      if (this.phaseT > 1.15) this.beginAim();
    } else if (this.phase === 'aim') {
      this.aimClock -= dt;
      const c = Math.ceil(this.aimClock);
      if (c <= 5 && c > 0 && c !== this.lastTick) {
        this.lastTick = c;
        sfx.tick();
      }
      if (this.aimClock <= 0) this.missTurn();
      this.physics(dt);
    } else if (this.phase === 'sim') {
      this.simTime += dt;
      this.physics(dt);
      if (this.allSettled()) {
        this.settleT += dt;
        if (this.settleT > 0.35) this.resolveTurn();
      } else this.settleT = 0;
      if (this.simTime > 9) {
        this.freezeAll();
        this.resolveTurn();
      }
    } else if (this.phase === 'goal') {
      if (this.phaseT > 1.9) {
        if (this.pendingWinner !== null) this.finishMatch();
        else this.kickoff((1 - this.goalSide) as 0 | 1);
      }
    }
    this.emitHud();
  }

  // ── network sync (host ↔ guest) ─────────────────────────────────────
  getSnapshot(): Snapshot {
    const st: number[] = [];
    for (const s of this.sticks) {
      st.push(s.x, s.y);
    }
    return {
      s1: this.scores[0],
      s2: this.scores[1],
      turn: this.turn,
      phase: this.phase,
      clock: Math.max(0, Math.ceil(this.phase === 'aim' ? this.aimClock : 0)),
      m1: this.misses[0],
      m2: this.misses[1],
      bx: this.ball.x,
      by: this.ball.y,
      bvx: this.ball.vx,
      bvy: this.ball.vy,
      bsp: this.ball.spin,
      st,
    };
  }

  applySnapshot(s: Snapshot) {
    const prevPhase = this.phase;
    const prevS1 = this.scores[0];
    const prevS2 = this.scores[1];
    this.scores = [s.s1, s.s2];
    this.misses = [s.m1, s.m2];
    this.turn = s.turn;
    this.striker = s.turn;
    this.aimClock = s.clock;
    if (s.phase !== prevPhase) this.phaseT = 0;
    this.phase = s.phase;
    if (s.phase === 'kickoff' && prevPhase !== 'kickoff') {
      // hard-reset every body to the kickoff layout (no gliding across the pitch)
      this.applyPositions(s, true);
    }
    this.snap = s;
    // derive local juice from state transitions
    if (s.phase === 'sim' && prevPhase === 'aim') {
      sfx.kick(0.55);
      this.shake = Math.max(this.shake, 2);
    }
    if (s.phase === 'aim' && (prevPhase === 'sim' || prevPhase === 'kickoff')) sfx.whistle(1);
    if (s.phase === 'kickoff' && prevPhase === 'goal') sfx.whistle(1);
    if (s.s1 > prevS1 || s.s2 > prevS2) {
      const side: 0 | 1 = s.s1 > prevS1 ? 0 : 1;
      this.goalSide = side;
      this.goalFlash = 1;
      this.shake = 17;
      sfx.goal();
      this.burst(CX, side === 0 ? y0 : y1, 90, [TEAM[side].color, TEAM[side].light, '#ffffff', '#ff4d1c']);
      this.floater(CX, MID_Y, 'GOOOAL!', 64, TEAM[side].color);
    }
    if (s.phase === 'aim' && s.clock <= 5 && s.clock > 0 && s.clock !== Math.ceil(this.lastTick)) {
      if (s.clock < this.lastTick) sfx.tick();
      this.lastTick = s.clock;
    }
    this.emitHud();
  }

  private applyPositions(s: Snapshot, hard: boolean) {
    const b = this.ball;
    const k = hard ? 1 : 0.3;
    b.x += (s.bx - b.x) * k;
    b.y += (s.by - b.y) * k;
    if (hard) b.trail = [];
    for (let i = 0; i < this.sticks.length && i * 2 + 1 < s.st.length; i++) {
      const st = this.sticks[i];
      st.x += (s.st[i * 2] - st.x) * k;
      st.y += (s.st[i * 2 + 1] - st.y) * k;
      st.vx = 0;
      st.vy = 0;
    }
  }

  private smoothSnap(dt: number) {
    const s = this.snap;
    if (!s) return;
    const k = 1 - Math.exp(-16 * dt);
    const b = this.ball;
    b.x += (s.bx - b.x) * k;
    b.y += (s.by - b.y) * k;
    b.vx = s.bvx;
    b.vy = s.bvy;
    b.spin += (s.bsp - b.spin) * k;
    for (let i = 0; i < this.sticks.length && i * 2 + 1 < s.st.length; i++) {
      const st = this.sticks[i];
      st.x += (s.st[i * 2] - st.x) * k;
      st.y += (s.st[i * 2 + 1] - st.y) * k;
      st.vx = 0;
      st.vy = 0;
    }
    if (Math.hypot(s.bvx, s.bvy) > 60) {
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > 12) b.trail.shift();
    } else if (b.trail.length) {
      b.trail.shift();
    }
  }

  private emitHud() {
    const h: HudState = {
      s1: this.scores[0],
      s2: this.scores[1],
      turn: this.turn,
      phase: this.phase,
      clock: Math.max(0, Math.ceil(this.phase === 'aim' ? this.aimClock : 0)),
      m1: this.misses[0],
      m2: this.misses[1],
    };
    const key = `${h.s1}|${h.s2}|${h.turn}|${h.phase}|${h.clock}|${h.m1}|${h.m2}`;
    if (key !== this.lastHud) {
      this.lastHud = key;
      this.cb.onHud(h);
    }
  }

  // ── rendering ────────────────────────────────────────────────────────
  private render() {
    const g = this.g;
    const { cssW, cssH, dpr } = this;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // stadium backdrop
    const bg = g.createLinearGradient(0, 0, 0, cssH);
    bg.addColorStop(0, '#03110a');
    bg.addColorStop(0.5, '#052015');
    bg.addColorStop(1, '#03110a');
    g.fillStyle = bg;
    g.fillRect(0, 0, cssW, cssH);

    const shx = (Math.random() - 0.5) * this.shake;
    const shy = (Math.random() - 0.5) * this.shake;
    g.setTransform(dpr * this.viewS, 0, 0, dpr * this.viewS, dpr * (this.viewX + shx * this.viewS), dpr * (this.viewY + shy * this.viewS));

    this.drawStands(g);
    this.drawPitch(g);
    this.drawGoals(g);
    this.drawBodies(g);
    if (this.phase === 'aim') this.drawAim(g);
    this.drawParticles(g);
    this.drawFloaters(g);

    // screen-space light overlays
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const [lx, ly] of [[0, 0], [cssW, 0], [0, cssH], [cssW, cssH]] as const) {
      const lg = g.createRadialGradient(lx, ly, 0, lx, ly, Math.max(cssW, cssH) * 0.55);
      lg.addColorStop(0, 'rgba(240,255,230,0.07)');
      lg.addColorStop(1, 'rgba(240,255,230,0)');
      g.fillStyle = lg;
      g.fillRect(0, 0, cssW, cssH);
    }
    const vg = g.createRadialGradient(cssW / 2, cssH / 2, Math.min(cssW, cssH) * 0.35, cssW / 2, cssH / 2, Math.max(cssW, cssH) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = vg;
    g.fillRect(0, 0, cssW, cssH);
  }

  private drawStands(g: CanvasRenderingContext2D) {
    // stand base
    g.fillStyle = '#062318';
    g.fillRect(0, 0, W, H);
    // crowd
    for (const c of this.crowd) {
      const a = 0.55 + 0.4 * Math.sin(this.time * 2.2 + c.tw);
      g.globalAlpha = a;
      g.fillStyle = c.c;
      g.fillRect(c.x, c.y, 3, 3);
    }
    g.globalAlpha = 1;
    // camera flashes
    if (Math.random() < 0.06 && this.crowd.length) {
      const c = this.crowd[Math.floor(Math.random() * this.crowd.length)];
      this.particles.push({ x: c.x, y: c.y, vx: 0, vy: 0, t: 0, life: 0.25, size: 5, color: '#ffffff', kind: 'flash', rot: 0, vr: 0 });
    }
    // LED ad boards along both touchlines
    g.save();
    g.fillStyle = '#02100a';
    g.fillRect(x0 - 26, y0, 20, y1 - y0);
    g.fillRect(x1 + 6, y0, 20, y1 - y0);
    g.strokeStyle = '#123a27';
    g.lineWidth = 2;
    g.strokeRect(x0 - 26, y0, 20, y1 - y0);
    g.strokeRect(x1 + 6, y0, 20, y1 - y0);
    const msg = '  TURF CLASH ★ STICK SOCCER ★ FIRST TO 3 ★ MISS 2 TURNS = FORFEIT ★ PASS & PLAY ★';
    g.font = '700 13px Rubik, sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    const mw = g.measureText(msg).width;
    const off = (this.time * 46) % mw;
    g.fillStyle = '#ffb400';
    for (const side of [0, 1]) {
      g.save();
      const bx = side === 0 ? x0 - 12 : x1 + 20;
      g.translate(bx, y0);
      g.rotate(Math.PI / 2);
      for (let rep = -1; rep < 3; rep++) g.fillText(msg, rep * mw - off, 0);
      g.restore();
    }
    g.restore();
    // team nameplates behind goals
    g.font = '900 20px Bungee, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = TEAM[1].color;
    g.globalAlpha = 0.85;
    g.fillText(this.settings.p2Name, CX, 30);
    g.fillStyle = TEAM[0].color;
    g.fillText(this.settings.p1Name, CX, H - 30);
    g.globalAlpha = 1;
  }

  private drawPitch(g: CanvasRenderingContext2D) {
    // mowed stripes
    const stripes = 8;
    const sh = (y1 - y0) / stripes;
    for (let i = 0; i < stripes; i++) {
      g.fillStyle = i % 2 === 0 ? '#0b6a31' : '#0a5f2c';
      g.fillRect(x0, y0 + i * sh, x1 - x0, sh);
    }
    // centre glow
    const cg = g.createRadialGradient(CX, MID_Y, 20, CX, MID_Y, 320);
    cg.addColorStop(0, 'rgba(210,255,190,0.10)');
    cg.addColorStop(1, 'rgba(210,255,190,0)');
    g.fillStyle = cg;
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    // team tints
    g.fillStyle = TEAM[1].glow.replace('0.55', '0.05');
    g.fillRect(x0, y0, x1 - x0, MID_Y - y0);
    g.fillStyle = TEAM[0].glow.replace('0.55', '0.05');
    g.fillRect(x0, MID_Y, x1 - x0, y1 - MID_Y);

    // markings
    g.strokeStyle = 'rgba(238,255,228,0.85)';
    g.lineWidth = 3;
    g.lineCap = 'round';
    const gw = GOAL_W / 2;
    g.beginPath();
    // top line with goal gap
    g.moveTo(x0, y0);
    g.lineTo(CX - gw, y0);
    g.moveTo(CX + gw, y0);
    g.lineTo(x1, y0);
    // bottom line with goal gap
    g.moveTo(x0, y1);
    g.lineTo(CX - gw, y1);
    g.moveTo(CX + gw, y1);
    g.lineTo(x1, y1);
    // touchlines
    g.moveTo(x0, y0);
    g.lineTo(x0, y1);
    g.moveTo(x1, y0);
    g.lineTo(x1, y1);
    g.stroke();
    // halfway + centre
    g.beginPath();
    g.moveTo(x0, MID_Y);
    g.lineTo(x1, MID_Y);
    g.stroke();
    g.beginPath();
    g.arc(CX, MID_Y, 70, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = 'rgba(238,255,228,0.85)';
    g.beginPath();
    g.arc(CX, MID_Y, 4.5, 0, Math.PI * 2);
    g.fill();
    // boxes + spots + corners
    g.strokeStyle = 'rgba(238,255,228,0.7)';
    g.lineWidth = 2.5;
    const box = (by: number, dir: number) => {
      g.strokeRect(CX - 130, dir === -1 ? by : by - 100, 260, 100);
      g.strokeRect(CX - 80, dir === -1 ? by : by - 44, 160, 44);
      g.beginPath();
      g.arc(CX, by + dir * 66, 4, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(CX, by + dir * 100, 70, dir === -1 ? 0.15 * Math.PI : 1.15 * Math.PI, dir === -1 ? 0.85 * Math.PI : 1.85 * Math.PI);
      g.stroke();
    };
    box(y0, 1);
    box(y1, -1);
    for (const [cx2, cy2, a0, a1] of [
      [x0, y0, 0, Math.PI / 2],
      [x1, y0, Math.PI / 2, Math.PI],
      [x0, y1, -Math.PI / 2, 0],
      [x1, y1, Math.PI, 1.5 * Math.PI],
    ] as const) {
      g.beginPath();
      g.arc(cx2, cy2, 15, a0, a1);
      g.stroke();
    }
  }

  private drawGoals(g: CanvasRenderingContext2D) {
    const gw = GOAL_W / 2;
    const draw = (lineY: number, dir: number, team: 0 | 1) => {
      const gy = dir === -1 ? lineY - GOAL_D : lineY;
      // net bed
      g.fillStyle = 'rgba(2,20,12,0.65)';
      g.fillRect(CX - gw, gy, GOAL_W, GOAL_D);
      g.save();
      g.beginPath();
      g.rect(CX - gw, gy, GOAL_W, GOAL_D);
      g.clip();
      g.strokeStyle = 'rgba(235,255,235,0.32)';
      g.lineWidth = 1;
      for (let x = CX - gw; x <= CX + gw; x += 9) {
        g.beginPath();
        g.moveTo(x, gy);
        g.lineTo(x, gy + GOAL_D);
        g.stroke();
      }
      for (let yy = gy; yy <= gy + GOAL_D; yy += 9) {
        g.beginPath();
        g.moveTo(CX - gw, yy);
        g.lineTo(CX + gw, yy);
        g.stroke();
      }
      g.restore();
      // goal flash
      if (this.goalFlash > 0) {
        const fg = g.createRadialGradient(CX, lineY, 5, CX, lineY, 130);
        fg.addColorStop(0, TEAM[team].glow.replace('0.55', String(0.6 * this.goalFlash)));
        fg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = fg;
        g.fillRect(CX - 150, Math.min(gy, lineY) - 40, 300, GOAL_D + 80);
      }
      // frame
      g.strokeStyle = '#f4fff0';
      g.lineWidth = 4;
      g.strokeRect(CX - gw, gy, GOAL_W, GOAL_D);
      // posts
      g.fillStyle = '#f4fff0';
      g.beginPath();
      g.arc(CX - gw, lineY, 5.5, 0, Math.PI * 2);
      g.arc(CX + gw, lineY, 5.5, 0, Math.PI * 2);
      g.fill();
    };
    draw(y0, -1, 0); // flash uses the scoring team's color (team 0 scores at the top goal)
    draw(y1, 1, 1);
  }

  private drawBodies(g: CanvasRenderingContext2D) {
    const b = this.ball;
    // ball trail
    for (let i = 0; i < b.trail.length; i++) {
      const t = b.trail[i];
      const a = ((i + 1) / b.trail.length) * 0.3;
      g.fillStyle = `rgba(255,255,255,${a})`;
      g.beginPath();
      g.arc(t.x, t.y, b.r * (0.4 + 0.6 * ((i + 1) / b.trail.length)), 0, Math.PI * 2);
      g.fill();
    }
    // sticks
    for (const s of this.sticks) {
      const t = TEAM[s.team];
      const active = this.phase === 'aim' && s.team === this.turn;
      const isAim = this.aimStick === s && this.phase === 'aim';
      g.globalAlpha = active || this.phase !== 'aim' ? 1 : 0.82;
      // shadow
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.ellipse(s.x, s.y + s.r * 0.42, s.r * 0.95, s.r * 0.5, 0, 0, Math.PI * 2);
      g.fill();
      g.save();
      g.translate(s.x, s.y);
      if (isAim && this.dragging) {
        const ang = Math.atan2(this.dirY, this.dirX);
        g.rotate(ang);
        g.scale(1 + this.power * 0.18, 1 - this.power * 0.1);
        g.rotate(-ang);
      }
      paintStick(g, s.team === 0 ? this.settings.skin1 : this.settings.skin2, t, s.r);
      g.restore();
      // rings
      if (active) {
        g.strokeStyle = t.glow;
        g.lineWidth = 2.5;
        g.setLineDash([6, 7]);
        g.lineDashOffset = -this.time * 26;
        g.beginPath();
        g.arc(s.x, s.y, s.r + 6 + (isAim ? Math.sin(this.time * 6) * 1.5 : 0), 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      }
      if (isAim) {
        g.strokeStyle = t.color;
        g.lineWidth = 3.5;
        g.beginPath();
        g.arc(s.x, s.y, s.r + 12, 0, Math.PI * 2);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
    // ball
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    g.ellipse(b.x, b.y + b.r * 0.5, b.r * 0.95, b.r * 0.45, 0, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.translate(b.x, b.y);
    g.rotate(b.spin);
    drawFootball(g, b.r);
    g.restore();
    // fixed sheen so the light stays put while the panels roll
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.beginPath();
    g.ellipse(b.x - b.r * 0.34, b.y - b.r * 0.44, b.r * 0.38, b.r * 0.2, -0.7, 0, Math.PI * 2);
    g.fill();
    // live ball ring during sim
    if (this.phase === 'sim' && Math.hypot(b.vx, b.vy) > 40) {
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(b.x, b.y, b.r + 4 + Math.sin(this.time * 10) * 1.5, 0, Math.PI * 2);
      g.stroke();
    }
  }

  private castRay(sx: number, sy: number, dx: number, dy: number): { t: number; body: Body | null } {
    let bestT = Infinity;
    let hit: Body | null = null;
    const s = this.aimStick!;
    const test = (b: Body) => {
      if (b === s || b.kind === 'post') return;
      const ox = sx - b.x;
      const oy = sy - b.y;
      const R = b.r + s.r;
      const bq = ox * dx + oy * dy;
      const cq = ox * ox + oy * oy - R * R;
      const disc = bq * bq - cq;
      if (disc < 0) return;
      const t = -bq - Math.sqrt(disc);
      if (t > 0.5 && t < bestT) {
        bestT = t;
        hit = b;
      }
    };
    test(this.ball);
    for (const st of this.sticks) test(st);
    // walls (sticks are confined to the full pitch rect)
    const wallT: number[] = [];
    if (dx < 0) wallT.push((x0 + s.r - sx) / dx);
    if (dx > 0) wallT.push((x1 - s.r - sx) / dx);
    if (dy < 0) wallT.push((y0 + s.r - sy) / dy);
    if (dy > 0) wallT.push((y1 - s.r - sy) / dy);
    for (const t of wallT) if (t > 0.5 && t < bestT) { bestT = t; hit = null; }
    return { t: bestT === Infinity ? 500 : bestT, body: hit };
  }

  private drawAim(g: CanvasRenderingContext2D) {
    const s = this.aimStick;
    if (!s || s.team !== this.turn) return;
    const t = TEAM[this.turn];
    if (this.dragging && this.power > 0.02) {
      const p = this.power;
      const ray = this.castRay(s.x, s.y, this.dirX, this.dirY);
      const ex = s.x + this.dirX * ray.t;
      const ey = s.y + this.dirY * ray.t;
      // stretch line back to pointer
      g.strokeStyle = 'rgba(255,255,255,0.3)';
      g.lineWidth = 2;
      g.setLineDash([3, 6]);
      g.beginPath();
      g.moveTo(s.x, s.y);
      g.lineTo(s.x - this.dirX * p * STRETCH, s.y - this.dirY * p * STRETCH);
      g.stroke();
      // trajectory
      const col = p < 0.5 ? t.color : p < 0.8 ? '#ff8a1c' : '#ff4d1c';
      g.strokeStyle = col;
      g.lineWidth = 4;
      g.setLineDash([10, 9]);
      g.lineDashOffset = -this.time * 60;
      g.beginPath();
      g.moveTo(s.x + this.dirX * (s.r + 4), s.y + this.dirY * (s.r + 4));
      g.lineTo(ex, ey);
      g.stroke();
      g.setLineDash([]);
      // arrowhead
      const ah = Math.atan2(this.dirY, this.dirX);
      g.fillStyle = col;
      g.save();
      g.translate(ex, ey);
      g.rotate(ah);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(-13, -7);
      g.lineTo(-13, 7);
      g.closePath();
      g.fill();
      g.restore();
      // impact marker + ball deflection hint
      if (ray.body === this.ball) {
        const hx = s.x + this.dirX * ray.t;
        const hy = s.y + this.dirY * ray.t;
        let nx = this.ball.x - hx;
        let ny = this.ball.y - hy;
        const nl = Math.hypot(nx, ny) || 1;
        nx /= nl;
        ny /= nl;
        g.strokeStyle = '#ffffff';
        g.lineWidth = 3;
        g.beginPath();
        g.arc(this.ball.x, this.ball.y, this.ball.r + 7, 0, Math.PI * 2);
        g.stroke();
        const bl = 34 + p * 78;
        g.strokeStyle = 'rgba(255,255,255,0.9)';
        g.setLineDash([5, 6]);
        g.beginPath();
        g.moveTo(this.ball.x + nx * (this.ball.r + 4), this.ball.y + ny * (this.ball.r + 4));
        g.lineTo(this.ball.x + nx * (this.ball.r + 4 + bl), this.ball.y + ny * (this.ball.r + 4 + bl));
        g.stroke();
        g.setLineDash([]);
      } else if (ray.body) {
        g.strokeStyle = 'rgba(255,255,255,0.65)';
        g.lineWidth = 2.5;
        g.beginPath();
        g.arc(ex, ey, 8, 0, Math.PI * 2);
        g.stroke();
      }
      // power arc around the stick
      g.strokeStyle = col;
      g.lineWidth = 6;
      g.lineCap = 'round';
      g.beginPath();
      g.arc(s.x, s.y, s.r + 17, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 1.999);
      g.stroke();
      g.lineCap = 'butt';
      // power %
      g.font = '800 15px Bungee, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#04150d';
      const tx = s.x + 46;
      const ty = s.y - 30;
      const label = `${Math.round(p * 100)}`;
      g.fillStyle = col;
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = 4;
      g.strokeText(label, tx, ty);
      g.fillText(label, tx, ty);
    } else {
      // idle hint pulse on the selected stick
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 4);
      g.strokeStyle = t.glow.replace('0.55', String(0.25 + pulse * 0.3));
      g.lineWidth = 3;
      g.beginPath();
      g.arc(s.x, s.y, s.r + 11 + pulse * 4, 0, Math.PI * 2);
      g.stroke();
    }
  }

  private drawParticles(g: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      const k = 1 - p.t / p.life;
      if (p.kind === 'confetti') {
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.globalAlpha = Math.min(1, k * 2);
        g.fillStyle = p.color;
        g.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
        g.restore();
      } else if (p.kind === 'flash') {
        g.globalAlpha = k;
        g.fillStyle = p.color;
        g.beginPath();
        g.arc(p.x, p.y, p.size * k + 1, 0, Math.PI * 2);
        g.fill();
      } else {
        g.globalAlpha = k * 0.9;
        g.fillStyle = p.color;
        g.beginPath();
        g.arc(p.x, p.y, p.size * (p.kind === 'dust' ? 1 + p.t * 3 : k), 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;
  }

  private drawFloaters(g: CanvasRenderingContext2D) {
    for (const f of this.floaters) {
      const k = f.t / f.life;
      const pop = f.t < 0.18 ? f.t / 0.18 : 1;
      const a = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      g.save();
      g.translate(f.x, f.y);
      const sc = 0.6 + 0.4 * pop;
      g.scale(sc, sc);
      g.globalAlpha = a;
      g.font = `900 ${f.size}px Bungee, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = Math.max(4, f.size * 0.14);
      g.strokeStyle = 'rgba(2,16,10,0.85)';
      g.lineJoin = 'round';
      g.strokeText(f.text, 0, 0);
      g.fillStyle = f.color;
      g.fillText(f.text, 0, 0);
      g.restore();
    }
    g.globalAlpha = 1;
  }
}

export const engineHelpers = { lerp };
