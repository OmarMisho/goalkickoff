import {
  W, H, PITCH, PITCH_CX, PITCH_CY, GOAL, R_COIN, R_BALL,
  PLAN_TIME, FORM_TIME, MOVE_DUR, PHYS_DUR, RESOLVE_TOTAL,
  WIN_GOALS, TICKS_PER_ROUND, TEAM_COLOR, ORBIT,
  type Team, type Vec, type Role, type TeamPlan, type PassPlan, emptyPlan,
  FORMATIONS, formationSlotsWithRoles, clampToOrbit, dist, goalMouthPoint, insideGoalMouth,
  loadSettings, saveSettings, type Settings,
} from "./core";
import { makeEmblem } from "./flags";
import { sfx, setSoundEnabled, setSoundVolume } from "./audio";

export type Mode =
  | "title" | "flags" | "formPick" | "handoff" | "roundIntro"
  | "plan" | "resolve" | "goal" | "roundEnd" | "champion" | "howto" | "settings";

export interface TeamStats {
  passes: number; completed: number; interceptions: number; blocks: number; turnovers: number;
}

export interface UiSnapshot {
  mode: Mode;
  planner: Team;
  handoffNext: "form" | "plan";
  scores: [number, number];
  round: number;
  tick: number;
  planLeft: number;
  planTotal: number;
  flags: [string, string];
  forms: [string, string];
  stats: [TeamStats, TeamStats];
  winner: Team | null;
  goalTeam: Team | null;
  bannerId: number;
  ballTeam: Team | null;
  holderIdx: number | null;
  ballInFlight: boolean;
  flightTeam: Team | null;
  online: boolean;
  myTeam: Team | null;
  oppLocked: boolean;
  awaiting: boolean;
  lockedIn: boolean;
}

interface Coin {
  team: Team; idx: number; role: Role;
  x: number; y: number; vx: number; vy: number;
  ax: number; ay: number; orbit: number; zone: number; // anchor + outer circle + inner keep-out
  flash: number;
}

interface Particle {
  x: number; y: number; vx: number; vy: number; life: number; maxLife: number;
  size: number; color: string; kind: "spark" | "ring" | "confetti" | "text" | "flash";
  rot: number; vr: number; label?: string;
}

interface REvent {
  t: number;
  type: "clash" | "kick" | "intercept" | "catch" | "goal" | "loose" | "pickup" | "push" | "turnover" | "save";
  x: number; y: number; team: Team;
  power?: number;
}

interface Key { t: number; x: number; y: number; }

const freshStats = (): TeamStats => ({ passes: 0, completed: 0, interceptions: 0, blocks: 0, turnovers: 0 });

const SUBSTEPS = 288; // physics granularity of the baked resolve

export class Engine {
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private onUi: (s: UiSnapshot) => void;
  private raf = 0;
  private last = 0;
  private time = 0;
  private scale = 1;

  mode: Mode = "title";
  private modeUntil = 0;
  private lastEmit = 0;

  private coins: Coin[] = [];
  private ball = { x: PITCH_CX, y: PITCH_CY, mode: "loose" as "held" | "loose", holderId: null as number | null, spin: 0 };
  private plans: [TeamPlan, TeamPlan] = [emptyPlan(), emptyPlan()];
  private flags: [string, string] = ["bra", "blaugrana"];
  private forms: [string, string] = ["2-1-2", "2-1-2"];
  private scores: [number, number] = [0, 0];
  private stats: [TeamStats, TeamStats] = [freshStats(), freshStats()];
  private round = 0;
  private tick = 0;
  private planner: Team = 0;
  private handoffNext: "form" | "plan" = "plan";
  private winner: Team | null = null;
  private goalTeam: Team | null = null;
  private bannerId = 0;
  private howtoFrom: Mode = "title";

  /* ---------------- netplay state ---------------- */
  private net = {
    active: false,
    isHost: false,
    myTeam: 0 as Team,
    send: (_m: any) => {},
    oppLocked: false,
    awaiting: false,
    guestPlanIn: false,
    guestFormIn: false,
    planSent: false,
    formSent: false,
    hostLocked: false,
    hostFormLocked: false,
  };

  private resolve = {
    t: 0,
    coinKeys: [] as Key[][],
    ballKeys: [] as Key[],
    events: [] as REvent[],
    evIdx: 0,
    flightWindow: null as { t0: number; t1: number; team: Team } | null,
    result: { ballMode: "held" as "held" | "loose", holderId: null as number | null, goal: null as Team | null },
  };

  private particles: Particle[] = [];
  private shake = 0;
  private drag: { kind: "move" | "pass"; coinIdx: number } | null = null;
  private dragAim: Vec | null = null;
  private hoverCoin: number | null = null;
  private lastSpaceWarn = -9;
  private lastPlanSec = 99;

  private bg: HTMLCanvasElement | null = null;

  constructor(cv: HTMLCanvasElement, onUi: (s: UiSnapshot) => void) {
    this.cv = cv;
    this.ctx = cv.getContext("2d")!;
    this.onUi = onUi;
    // persisted defaults (flag, formation, sound) — editable in the Settings page
    const s = loadSettings();
    this.flags = [...s.flags] as [string, string];
    this.forms = [...s.forms] as [string, string];
    setSoundEnabled(s.sound);
    setSoundVolume(s.volume);
    this.resize();
    window.addEventListener("resize", this.resize);
    cv.addEventListener("pointerdown", this.onDown);
    cv.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("keydown", this.onKey);
    if (document.fonts?.ready) document.fonts.ready.then(() => { this.bg = null; });
    this.setupIdleField();
    this.last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - this.last) / 1000);
      this.last = t;
      this.time += dt;
      this.update(dt);
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    this.cv.removeEventListener("pointerdown", this.onDown);
    this.cv.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("keydown", this.onKey);
  }

  private resize = () => {
    const rect = this.cv.parentElement!.getBoundingClientRect();
    this.scale = Math.min(rect.width / W, rect.height / H);
    this.cv.width = W * this.scale * devicePixelRatio;
    this.cv.height = H * this.scale * devicePixelRatio;
    this.cv.style.width = `${W * this.scale}px`;
    this.cv.style.height = `${H * this.scale}px`;
    this.ctx.setTransform(this.scale * devicePixelRatio, 0, 0, this.scale * devicePixelRatio, 0, 0);
  };

  /* ---------------- UI API ---------------- */

  uiStart() { this.mode = "flags"; this.planner = 0; this.bannerId++; sfx.click(); this.emit(true); }
  uiPickFlag(p: Team, id: string) { this.flags[p] = id; sfx.pick(); this.emit(true); }
  uiConfirmFlags() {
    sfx.click();
    if (this.planner === 0) { this.planner = 1; this.bannerId++; }
    else { this.planner = 0; this.handoffNext = "form"; this.mode = "handoff"; this.bannerId++; }
    this.emit(true);
  }
  uiSetForm(p: Team, id: string) { this.forms[p] = id; sfx.pick(); this.setupIdleField(p); this.emit(true); }
  uiConfirmForm() {
    sfx.click();
    if (this.net.active) {
      if (this.net.isHost) {
        // host confirmed: proceed now if the guest's form is already in
        this.net.hostFormLocked = true;
        if (this.net.guestFormIn) this.modeUntil = Math.min(this.modeUntil, this.time + 0.01);
      } else if (!this.net.formSent) {
        this.net.send({ t: "form", id: this.forms[this.net.myTeam] });
        this.net.formSent = true;
        this.net.awaiting = true;
      }
      this.emit(true);
      return;
    }
    if (this.planner === 0) {
      this.planner = 1;
      this.modeUntil = this.time + FORM_TIME; // give P2 the full window
      this.bannerId++;
      this.setupIdleField(1);
    } else this.beginRound();
    this.emit(true);
  }
  uiContinueHandoff() {
    sfx.click();
    if (this.handoffNext === "form") {
      this.mode = "formPick";
      this.modeUntil = this.time + FORM_TIME;
      this.setupIdleField(this.planner);
    } else {
      this.startPlan();
    }
    this.emit(true);
  }
  uiLock() { this.lockPlan(); }
  uiClearPlan() {
    if (this.mode !== "plan") return;
    this.plans[this.planner] = emptyPlan();
    sfx.drop();
    this.emit(true);
  }
  uiRematch() {
    sfx.whistle();
    this.scores = [0, 0];
    this.stats = [freshStats(), freshStats()];
    this.round = 0;
    this.tick = 0;
    this.winner = null;
    this.goalTeam = null;
    this.planner = 0;
    this.plans = [emptyPlan(), emptyPlan()];
    this.net.guestFormIn = false;
    this.net.guestPlanIn = false;
    this.net.hostLocked = false;
    this.net.hostFormLocked = false;
    if (this.net.active && this.net.isHost) {
      this.mode = "formPick";
      this.modeUntil = this.time + FORM_TIME;
      this.setupIdleField(0);
      this.net.send({ t: "phase", kind: "form", fresh: true, round: 1, deadline: Date.now() + FORM_TIME * 1000, scores: this.scores, forms: this.forms });
    } else if (!this.net.active) {
      this.handoffNext = "form";
      this.mode = "handoff";
    }
    this.bannerId++;
    this.emit(true);
  }
  uiToTitle() {
    this.mode = "title";
    this.winner = null;
    this.setupIdleField();
    this.emit(true);
  }
  uiOpenHowto() {
    this.howtoFrom = this.mode === "champion" ? "champion" : "title";
    this.mode = "howto";
    this.bannerId++;
    sfx.click();
    this.emit(true);
  }
  uiCloseHowto() {
    this.mode = this.howtoFrom;
    sfx.click();
    this.emit(true);
  }
  uiOpenSettings() {
    this.howtoFrom = this.mode === "champion" ? "champion" : "title";
    this.mode = "settings";
    this.bannerId++;
    sfx.click();
    this.emit(true);
  }
  uiCloseSettings() {
    this.mode = this.howtoFrom;
    sfx.click();
    this.emit(true);
  }
  /** save defaults + apply them live (flags/formations preselect, sound applied instantly) */
  uiApplySettings(s: Settings) {
    saveSettings(s);
    this.flags = [...s.flags] as [string, string];
    this.forms = [...s.forms] as [string, string];
    setSoundEnabled(s.sound);
    setSoundVolume(s.volume);
    if (this.mode !== "resolve" && this.mode !== "plan") this.setupIdleField();
    this.emit(true);
  }

  /* ---------------- online play (host authoritative) ---------------- */

  onlineInit(role: "host" | "guest", myFlag: string, oppFlag: string, send: (m: any) => void) {
    const isHost = role === "host";
    this.net = {
      active: true, isHost,
      myTeam: isHost ? 0 : 1,
      send,
      oppLocked: false, awaiting: false,
      guestPlanIn: false, guestFormIn: false, planSent: false, formSent: false,
      hostLocked: false, hostFormLocked: false,
    };
    this.flags = isHost ? [myFlag, oppFlag] : [oppFlag, myFlag];
    this.scores = [0, 0];
    this.stats = [freshStats(), freshStats()];
    this.round = 0; this.tick = 0;
    this.winner = null; this.goalTeam = null;
    this.plans = [emptyPlan(), emptyPlan()];
    this.setupIdleField(isHost ? 0 : 1);
    if (isHost) {
      // straight into the strategy phase — no handoffs online
      this.planner = 0;
      this.mode = "formPick";
      this.modeUntil = this.time + FORM_TIME;
      this.setupIdleField(0);
      this.net.send({ t: "phase", kind: "form", fresh: true, round: 1, deadline: Date.now() + FORM_TIME * 1000, scores: this.scores, forms: this.forms });
    }
    this.bannerId++;
    this.emit(true);
  }

  onlineDisconnect() {
    this.net.active = false;
    this.mode = "title";
    this.setupIdleField();
    this.emit(true);
  }

  netActive(): boolean {
    return this.net.active;
  }

  /** keep the guest's team plan structurally sane */
  private sanitizePlan(raw: any): TeamPlan {
    const p = emptyPlan();
    if (!raw) return p;
    if (Array.isArray(raw.moves)) {
      for (let i = 0; i < 5; i++) {
        const m = raw.moves[i];
        if (m && typeof m.x === "number" && typeof m.y === "number" &&
          isFinite(m.x) && isFinite(m.y)) {
          p.moves[i] = { x: Math.min(Math.max(m.x, PITCH.l), PITCH.r), y: Math.min(Math.max(m.y, PITCH.t), PITCH.b) };
        }
      }
    }
    const ps = raw.pass;
    if (ps && ps.target && isFinite(ps.target.x) && isFinite(ps.target.y) && (ps.kind === "point" || ps.kind === "goal")) {
      const plan: PassPlan = { target: { x: ps.target.x, y: ps.target.y }, kind: ps.kind };
      if (typeof ps.receiverId === "number") {
        const gi = ps.receiverId | 0;
        if (gi >= 0 && gi < 10 && this.coins[gi] && this.coins[gi].team === 1) plan.receiverId = gi;
      }
      p.pass = plan;
    }
    return p;
  }

  private compactKeys(keys: Key[]): Key[] {
    const out: Key[] = [];
    for (let i = 0; i < keys.length; i++) {
      if (i % 3 === 0 || i === keys.length - 1) {
        out.push({ t: +keys[i].t.toFixed(3), x: Math.round(keys[i].x * 10) / 10, y: Math.round(keys[i].y * 10) / 10 });
      }
    }
    return out;
  }

  netReceive(m: any) {
    if (!this.net.active) return;
    switch (m.t) {
      case "form": {
        if (!this.net.isHost) return;
        const id = typeof m.id === "string" ? m.id : "";
        if (FORMATIONS.some((f) => f.id === id)) this.forms[1] = id;
        this.net.guestFormIn = true;
        this.maybeBeginRoundOnline();
        this.emit(true);
        break;
      }
      case "plan": {
        if (!this.net.isHost) return;
        this.plans[1] = this.sanitizePlan(m.p);
        this.net.guestPlanIn = true;
        if (m.locked) this.net.oppLocked = true;
        this.emit(true);
        break;
      }
      case "locked": {
        if (this.net.isHost) { this.net.oppLocked = true; this.emit(true); }
        break;
      }
      case "resolve": {
        if (this.net.isHost || !m.p) return;
        this.applyResolve(m.p);
        break;
      }
      case "phase": {
        if (this.net.isHost) return;
        this.onPhaseMsg(m);
        break;
      }
      case "champion": {
        if (this.net.isHost) return;
        this.scores = [...m.scores] as [number, number];
        this.stats = [{ ...m.stats[0] }, { ...m.stats[1] }];
        this.winner = m.winner;
        this.mode = "champion";
        this.bannerId++;
        sfx.horn();
        this.emit(true);
        break;
      }
    }
  }

  /** guest side: host says what phase comes next */
  private onPhaseMsg(m: any) {
    this.net.awaiting = false;
    this.net.planSent = false;
    this.net.formSent = false;
    this.net.oppLocked = false;
    this.plans[this.net.myTeam] = emptyPlan();
    if (m.scores) this.scores = [...m.scores] as [number, number];
    // keep the host's formation in sync so opponent coins render in the right slots
    // (the guest always keeps its own locally-chosen formation for team 1)
    if (Array.isArray(m.forms) && m.forms.length === 2) this.forms = [m.forms[0], this.forms[1]];
    switch (m.kind) {
      case "form": {
        if (m.fresh) {
          this.scores = [0, 0];
          this.stats = [freshStats(), freshStats()];
          this.round = 0; this.tick = 0;
          this.winner = null; this.goalTeam = null;
        }
        this.planner = this.net.myTeam;
        this.mode = "formPick";
        this.modeUntil = this.time + Math.max(1, ((m.deadline ?? Date.now() + FORM_TIME * 1000) - Date.now()) / 1000);
        this.setupIdleField(this.net.myTeam);
        break;
      }
      case "intro": {
        this.round = m.round ?? this.round + 1;
        this.tick = 0;
        this.plans = [emptyPlan(), emptyPlan()];
        this.placeFormations();
        const holderTeam = (m.holderTeam ?? 0) as Team;
        const holder = this.centerCoin(holderTeam);
        this.ball.mode = "held";
        this.ball.holderId = holder;
        this.syncBallToHolder();
        this.mode = "roundIntro";
        this.modeUntil = this.time + 1.7;
        sfx.whistle();
        break;
      }
      case "plan": {
        this.tick = typeof m.tick === "number" ? m.tick : this.tick;
        if (m.reset) {
          // post-goal kickoff: rebuild the exact same layout the host built
          this.placeFormations();
          const ht = (typeof m.holderTeam === "number" ? m.holderTeam : 0) as Team;
          const holder = this.centerCoin(ht);
          this.ball.mode = "held";
          this.ball.holderId = holder;
          this.syncBallToHolder();
        }
        this.planner = this.net.myTeam;
        this.startPlan();
        this.modeUntil = this.time + Math.max(1, ((m.deadline ?? Date.now() + PLAN_TIME * 1000) - Date.now()) / 1000);
        break;
      }
      case "roundEnd": {
        this.mode = "roundEnd";
        this.modeUntil = this.time + 9999; // host drives the next phase
        this.bannerId++;
        sfx.whistle();
        break;
      }
    }
    this.bannerId++;
    this.emit(true);
  }

  /** guest: replay the host's baked resolve reel */
  private applyResolve(p: any) {
    const R = this.resolve;
    R.t = 0; R.evIdx = 0;
    R.events = Array.isArray(p.events) ? p.events : [];
    R.coinKeys = Array.isArray(p.ck) ? p.ck : [];
    R.ballKeys = Array.isArray(p.bk) ? p.bk : [];
    R.flightWindow = p.fw ?? null;
    R.result = p.result ?? { ballMode: "loose", holderId: null, goal: null };
    if (p.scores) this.scores = [...p.scores] as [number, number];
    if (p.stats) this.stats = [{ ...p.stats[0] }, { ...p.stats[1] }];
    if (typeof p.tick === "number") this.tick = p.tick;
    this.mode = "resolve";
    this.net.awaiting = false;
    this.net.oppLocked = false;
    this.bannerId++;
    this.emit(true);
  }

  /* host-side online orchestration */

  private maybeBeginRoundOnline() {
    // host waits for the guest's formation (with a grace window past the deadline)
    if (this.mode !== "formPick" || this.planner !== 0) return;
    if (!this.net.guestFormIn && this.time < this.modeUntil + 0.6) return;
    this.net.guestFormIn = false;
    this.beginRound();
    this.net.send({ t: "phase", kind: "intro", round: this.round, holderTeam: (this.round - 1) % 2, scores: this.scores, forms: this.forms });
  }

  private onlineNextPhase() {
    // host: advance the match and tell the guest where we are
    if (this.tick >= TICKS_PER_ROUND) {
      this.mode = "roundEnd";
      this.modeUntil = this.time + 2.5;
      this.bannerId++;
      sfx.whistle();
      this.net.send({ t: "phase", kind: "roundEnd", scores: this.scores });
    } else {
      this.planner = 0; // online: Player 1 (host) always plans first
      this.plans[1] = emptyPlan(); // drop last segment's guest plan — never reuse stale orders
      this.net.guestPlanIn = false;
      this.startPlan();
      this.net.send({ t: "phase", kind: "plan", tick: this.tick, deadline: Date.now() + PLAN_TIME * 1000, scores: this.scores, forms: this.forms });
    }
    this.emit(true);
  }

  /* ---------------- placement ---------------- */

  private placeFormations() {
    this.coins = [];
    ([0, 1] as Team[]).forEach((team) => {
      const f = FORMATIONS.find((x) => x.id === this.forms[team]) ?? FORMATIONS[0];
      formationSlotsWithRoles(f, team).forEach((s, i) => {
        this.coins.push({
          team, idx: i, role: s.role,
          x: s.x, y: s.y, vx: 0, vy: 0,
          ax: s.x, ay: s.y, orbit: ORBIT[s.role], zone: ORBIT[s.role] / 2, flash: 0,
        });
      });
    });
  }

  private setupIdleField(previewTeam?: Team) {
    this.placeFormations();
    this.ball.mode = "loose";
    this.ball.holderId = null;
    this.ball.x = PITCH_CX; this.ball.y = PITCH_CY;
    if (previewTeam !== undefined) {
      const h = this.centerCoin(previewTeam);
      this.ball.mode = "held"; this.ball.holderId = h; this.syncBallToHolder();
    }
  }

  private centerCoin(team: Team): number {
    let best = -1, bd = Infinity;
    this.coins.forEach((c, gi) => {
      if (c.team !== team) return;
      const d = Math.hypot(c.x - PITCH_CX, c.y - PITCH_CY);
      if (d < bd) { bd = d; best = gi; }
    });
    return best;
  }

  private syncBallToHolder() {
    if (this.ball.holderId == null) return;
    const h = this.coins[this.ball.holderId];
    const dir = h.team === 0 ? 1 : -1;
    this.ball.x = h.x + dir * (R_COIN + R_BALL + 3);
    this.ball.y = h.y;
  }

  /* ---------------- round / segment flow ---------------- */

  private beginRound() {
    this.round++;
    this.tick = 0;
    this.plans = [emptyPlan(), emptyPlan()];
    this.placeFormations();
    const holderTeam: Team = ((this.round - 1) % 2) as Team; // round 1 -> player 1
    const holder = this.centerCoin(holderTeam);
    this.ball.mode = "held";
    this.ball.holderId = holder;
    this.syncBallToHolder();
    this.mode = "roundIntro";
    this.modeUntil = this.time + 1.7;
    this.bannerId++;
    sfx.whistle();
    this.emit(true);
  }

  /** decide the next phase after a segment / intro / goal completes */
  private nextSegment() {
    if (this.net.active) {
      if (this.net.isHost) this.onlineNextPhase();
      return; // guest: the host drives every phase transition
    }
    if (this.tick >= TICKS_PER_ROUND) {
      this.mode = "roundEnd";
      this.modeUntil = this.time + 2.5;
      this.bannerId++;
      sfx.whistle();
    } else {
      // every segment: player 1 plots first, then player 2, then both execute
      this.planner = 0;
      this.handoffNext = "plan";
      this.mode = "handoff";
      this.bannerId++;
    }
    this.emit(true);
  }

  private startPlan() {
    this.mode = "plan";
    // only the current planner starts with a clean sheet — the other
    // player's locked-in plan must survive until the simultaneous resolve
    this.plans[this.planner] = emptyPlan();
    this.modeUntil = this.time + PLAN_TIME;
    this.lastPlanSec = 99;
    this.drag = null;
    this.dragAim = null;
    this.net.planSent = false;
    this.net.oppLocked = false;
    this.net.awaiting = false;
    this.net.hostLocked = false;
    this.bannerId++;
  }

  private lockPlan() {
    if (this.mode !== "plan") return;
    sfx.click();
    if (this.net.active) {
      if (this.net.isHost) {
        // host locks in — the shared 10s window keeps running for player 2;
        // the resolve fires the moment BOTH are locked (update loop)
        this.net.hostLocked = true;
      } else if (!this.net.planSent) {
        // guest ships their secret orders to the host
        this.net.send({
          t: "plan",
          p: this.plans[this.net.myTeam],
          locked: true,
        });
        this.net.planSent = true;
        this.net.awaiting = true;
        this.modeUntil = this.time + 9999; // countdown done — waiting for the clash
      }
      this.emit(true);
      return;
    }
    if (this.planner === 0) {
      this.planner = 1;
      this.handoffNext = "plan";
      this.mode = "handoff";
      this.bannerId++;
    } else {
      this.startResolve();
    }
    this.emit(true);
  }

  /* ---------------- resolve: baked physics sim ---------------- */

  private startResolve() {
    this.mode = "resolve";
    this.bannerId++;
    const R = this.resolve;
    R.t = 0; R.evIdx = 0; R.events = []; R.ballKeys = []; R.flightWindow = null;
    R.coinKeys = this.coins.map((c) => [{ t: 0, x: c.x, y: c.y }]);
    R.result = { ballMode: "held", holderId: this.ball.holderId, goal: null };

    const dt = PHYS_DUR / SUBSTEPS;
    const pos: Vec[] = this.coins.map((c) => ({ x: c.x, y: c.y }));
    // RULE: the coin with the ball cannot move this segment — it must pass.
    const frozenGi = this.ball.mode === "held" && this.ball.holderId != null ? this.ball.holderId : -1;
    const vel: Vec[] = this.coins.map((c, gi) => {
      if (gi === frozenGi) return { x: 0, y: 0 };
      const plan = this.plans[c.team].moves[c.idx];
      if (!plan) return { x: 0, y: 0 };
      const d = dist(c, plan);
      if (d < 4) return { x: 0, y: 0 };
      const sp = Math.min(470, Math.max(50, d / MOVE_DUR)); // farther stretch = more power
      return { x: ((plan.x - c.x) / d) * sp, y: ((plan.y - c.y) / d) * sp };
    });
    // projected resting targets (planned ones get spacing-enforced later by the relaxation pass)
    const rest: Vec[] = this.coins.map((c, gi) =>
      this.plans[c.team].moves[c.idx] ?? { x: c.x, y: c.y },
    );
    const lastClash = new Array<number>(100).fill(-9);
    const pushCd = new Array<number>(10).fill(-9);
    const ownGoalX = (team: Team) => (team === 0 ? PITCH.l : PITCH.r);

    // ball state
    let bMode: "held" | "flight" | "loose" = this.ball.mode === "held" ? "held" : "loose";
    let bHolder = this.ball.holderId;
    let bx = this.ball.x, by = this.ball.y, bvx = 0, bvy = 0;
    let goal: Team | null = null;

    // pass plan (or forced turnover)
    let pass: PassPlan | null = null;
    let passerTeam: Team = 0;
    let kickAt = -1;
    let kicked = false;
    let forcedPass = false;
    if (bMode === "held" && bHolder != null) {
      const holder = this.coins[bHolder];
      passerTeam = holder.team;
      const planned = this.plans[holder.team].pass;
      if (planned) {
        pass = { ...planned };
        kickAt = 0.02; // the pass fires the instant the segment resolves
        this.stats[passerTeam].passes++;
      } else {
        // RULE: the carrier MUST pass this segment or loses the ball
        kickAt = 0.06;
        this.stats[passerTeam].turnovers++;
        R.events.push({ t: 0.05, type: "turnover", x: pos[bHolder].x, y: pos[bHolder].y, team: passerTeam });
      }
    }

    let bFrom: Vec | null = null, bTo: Vec | null = null, bT0 = 0;

    for (let st = 1; st <= SUBSTEPS; st++) {
      const t = st * dt;

      /* --- coins --- */
      for (let gi = 0; gi < 10; gi++) {
        if (gi === frozenGi) { R.coinKeys[gi].push({ t, x: pos[gi].x, y: pos[gi].y }); continue; }
        if (t > MOVE_DUR) {
          const damp = Math.pow(0.012, dt); // settle after the push
          vel[gi].x *= damp; vel[gi].y *= damp;
        }
        pos[gi].x += vel[gi].x * dt;
        pos[gi].y += vel[gi].y * dt;
      }
      // pairwise collisions — momentum exchange, power = stretch speed
      for (let i = 0; i < 10; i++) {
        for (let j = i + 1; j < 10; j++) {
          const dx = pos[j].x - pos[i].x;
          const dy = pos[j].y - pos[i].y;
          const d = Math.hypot(dx, dy);
          const minD = R_COIN * 2;
          if (d < minD && d > 0.001) {
            const nx = dx / d, ny = dy / d;
            const iFrozen = i === frozenGi, jFrozen = j === frozenGi;
            if (iFrozen || jFrozen) {
              const push = minD - d; // the carrier is an immovable object
              if (iFrozen) { pos[j].x += nx * push; pos[j].y += ny * push; }
              else { pos[i].x -= nx * push; pos[i].y -= ny * push; }
            } else {
              const push = (minD - d) / 2;
              pos[i].x -= nx * push; pos[i].y -= ny * push;
              pos[j].x += nx * push; pos[j].y += ny * push;
            }
            const vn = iFrozen
              ? -(vel[j].x * nx + vel[j].y * ny)
              : jFrozen
                ? (vel[i].x * nx + vel[i].y * ny)
                : (vel[i].x - vel[j].x) * nx + (vel[i].y - vel[j].y) * ny;
            if (vn > 0) {
              const sameTeam = this.coins[i].team === this.coins[j].team;
              const e = sameTeam ? 0.45 : 0.92;
              if (iFrozen || jFrozen) {
                const jm = (1 + e) * vn; // full rebound off the static carrier
                if (iFrozen) { vel[j].x += nx * jm; vel[j].y += ny * jm; }
                else { vel[i].x -= nx * jm; vel[i].y -= ny * jm; }
              } else {
                const jm = ((1 + e) * vn) / 2;
                vel[i].x -= nx * jm; vel[i].y -= ny * jm;
                vel[j].x += nx * jm; vel[j].y += ny * jm;
              }
              if (!sameTeam && vn > 55 && t - lastClash[i * 10 + j] > 0.3) {
                lastClash[i * 10 + j] = t;
                this.coins[i].flash = 1; this.coins[j].flash = 1;
                const dI = Math.abs(pos[i].x - ownGoalX(this.coins[i].team));
                const dJ = Math.abs(pos[j].x - ownGoalX(this.coins[j].team));
                const def = dI < dJ ? i : j;
                this.stats[this.coins[def].team].blocks++;
                R.events.push({
                  t, type: "clash", team: this.coins[def].team,
                  x: (pos[i].x + pos[j].x) / 2, y: (pos[i].y + pos[j].y) / 2,
                  power: Math.min(1, vn / 430),
                });
              }
            }
          }
        }
      }
      // outer movement circle (no reflection — the rim absorbs) + pitch walls
      for (let gi = 0; gi < 10; gi++) {
        if (gi === frozenGi) continue;
        const c = this.coins[gi];
        const ox = pos[gi].x - c.ax, oy = pos[gi].y - c.ay;
        const od = Math.hypot(ox, oy);
        if (od > c.orbit) {
          const nx = ox / od, ny = oy / od;
          pos[gi].x = c.ax + nx * c.orbit;
          pos[gi].y = c.ay + ny * c.orbit;
          const vn = vel[gi].x * nx + vel[gi].y * ny;
          if (vn > 0) { vel[gi].x -= nx * vn; vel[gi].y -= ny * vn; } // slide along the rim
        }
        const m = R_COIN;
        if (pos[gi].x < PITCH.l + m) { pos[gi].x = PITCH.l + m; vel[gi].x = Math.abs(vel[gi].x) * 0.5; }
        if (pos[gi].x > PITCH.r - m) { pos[gi].x = PITCH.r - m; vel[gi].x = -Math.abs(vel[gi].x) * 0.5; }
        if (pos[gi].y < PITCH.t + m) { pos[gi].y = PITCH.t + m; vel[gi].y = Math.abs(vel[gi].y) * 0.5; }
        if (pos[gi].y > PITCH.b - m) { pos[gi].y = PITCH.b - m; vel[gi].y = -Math.abs(vel[gi].y) * 0.5; }
        if (st % 2 === 0) R.coinKeys[gi].push({ t, x: pos[gi].x, y: pos[gi].y });
      }

      /* --- ball --- */
      if (bMode === "held" && bHolder != null) {
        const hc = this.coins[bHolder];
        const dir = hc.team === 0 ? 1 : -1;
        bx = pos[bHolder].x + dir * (R_COIN + R_BALL + 3);
        by = pos[bHolder].y;
        if (!kicked && t >= kickAt) {
          kicked = true;
          if (!pass) {
            // forced turnover: punt to the nearest rival
            let best = -1, bd = Infinity;
            for (let gi = 0; gi < 10; gi++) {
              if (this.coins[gi].team === passerTeam) continue;
              const d = Math.hypot(pos[gi].x - bx, pos[gi].y - by);
              if (d < bd) { bd = d; best = gi; }
            }
            if (best >= 0) {
              pass = { target: { x: pos[best].x, y: pos[best].y }, kind: "point", receiverId: best };
              forcedPass = true;
            }
          }
          if (pass) {
            bMode = "flight";
            bFrom = { x: bx, y: by };
            bT0 = t;
            R.flightWindow = { t0: bT0, t1: MOVE_DUR, team: passerTeam };
            if (pass.kind === "goal") {
              bTo = { x: pass.target.x + (passerTeam === 0 ? 26 : -26), y: pass.target.y };
            } else if (pass.receiverId != null) {
              bTo = { x: rest[pass.receiverId].x, y: rest[pass.receiverId].y };
            } else {
              bTo = { x: pass.target.x, y: pass.target.y };
            }
            R.events.push({ t, type: "kick", x: bx, y: by, team: passerTeam });
          }
        }
        R.ballKeys.push({ t, x: bx, y: by });
      } else if (bMode === "flight" && pass && bFrom && bTo) {
        // glide over the coins' travel window — lands the instant the receiver stops
        const span = Math.max(0.05, MOVE_DUR - bT0);
        let f = (t - bT0) / span;
        f = Math.min(1, Math.max(0, f));
        bx = bFrom.x + (bTo.x - bFrom.x) * f;
        by = bFrom.y + (bTo.y - bFrom.y) * f;
        const arrive = f >= 1;
        // defenders on the lane cut the ball
        let cutBy = -1;
        for (let gi = 0; gi < 10; gi++) {
          if (this.coins[gi].team === passerTeam) continue;
          if (Math.hypot(pos[gi].x - bx, pos[gi].y - by) < R_COIN + R_BALL + 2) { cutBy = gi; break; }
        }
        if (cutBy >= 0) {
          if (pass.kind === "goal") {
            const def = this.coins[cutBy];
            this.stats[def.team].blocks++;
            R.events.push({ t, type: "save", x: bx, y: by, team: def.team });
            bMode = "loose";
            const away = passerTeam === 0 ? -1 : 1;
            bvx = away * (240 + Math.random() * 120);
            bvy = (Math.random() - 0.5) * 320;
          } else {
            const def = this.coins[cutBy];
            this.stats[def.team].interceptions++;
            R.events.push({ t, type: "intercept", x: bx, y: by, team: def.team });
            bMode = "held"; bHolder = cutBy;
          }
        } else if (arrive) {
          if (pass.kind === "goal") {
            goal = passerTeam;
            R.events.push({ t, type: "goal", x: pass.target.x, y: pass.target.y, team: passerTeam });
            bMode = "loose"; bvx = 0; bvy = 0;
            bx = pass.target.x + (passerTeam === 0 ? 18 : -18); by = pass.target.y;
          } else if (pass.receiverId != null) {
            if (!forcedPass) this.stats[passerTeam].completed++;
            R.events.push({ t, type: "catch", x: bx, y: by, team: this.coins[pass.receiverId].team });
            bMode = "held"; bHolder = pass.receiverId;
          } else {
            // lead pass into space — closest coin claims it
            let best = -1, bd = Infinity;
            for (let gi = 0; gi < 10; gi++) {
              const d = Math.hypot(pos[gi].x - bx, pos[gi].y - by);
              if (d < bd) { bd = d; best = gi; }
            }
            if (best >= 0 && bd < 175) {
              const c = this.coins[best];
              if (c.team === passerTeam) {
                this.stats[passerTeam].completed++;
                R.events.push({ t, type: "catch", x: bx, y: by, team: c.team });
              } else {
                this.stats[c.team].interceptions++;
                R.events.push({ t, type: "intercept", x: bx, y: by, team: c.team });
              }
              bMode = "held"; bHolder = best;
            } else {
              R.events.push({ t, type: "loose", x: bx, y: by, team: passerTeam });
              bMode = "loose"; bvx = (Math.random() - 0.5) * 60; bvy = (Math.random() - 0.5) * 60;
            }
          }
        }
        R.ballKeys.push({ t, x: bx, y: by });
      } else if (bMode === "loose") {
        const damp = Math.exp(-2.1 * dt);
        bvx *= damp; bvy *= damp;
        bx += bvx * dt; by += bvy * dt;
        if (!goal) {
          if (bx < PITCH.l + R_BALL) {
            if (Math.abs(by - PITCH_CY) < GOAL.half && bx < PITCH.l - 2) {
              goal = 1; R.events.push({ t, type: "goal", x: bx, y: by, team: 1 }); bvx = 0; bvy = 0;
            } else { bx = PITCH.l + R_BALL; bvx = Math.abs(bvx) * 0.6; }
          }
          if (bx > PITCH.r - R_BALL) {
            if (Math.abs(by - PITCH_CY) < GOAL.half && bx > PITCH.r + 2) {
              goal = 0; R.events.push({ t, type: "goal", x: bx, y: by, team: 0 }); bvx = 0; bvy = 0;
            } else { bx = PITCH.r - R_BALL; bvx = -Math.abs(bvx) * 0.6; }
          }
          if (by < PITCH.t + R_BALL) { by = PITCH.t + R_BALL; bvy = Math.abs(bvy) * 0.6; }
          if (by > PITCH.b - R_BALL) { by = PITCH.b - R_BALL; bvy = -Math.abs(bvy) * 0.6; }
        }
        // moving coins strike the loose ball (not after a goal is decided)
        if (!goal) {
          for (let gi = 0; gi < 10; gi++) {
            const spd = Math.hypot(vel[gi].x, vel[gi].y);
            if (spd > 55 && t > pushCd[gi] && Math.hypot(pos[gi].x - bx, pos[gi].y - by) < R_COIN + R_BALL + 2) {
              pushCd[gi] = t + 0.35;
              const kk = 170 + spd * 0.9;
              bvx = (vel[gi].x / spd) * kk;
              bvy = (vel[gi].y / spd) * kk;
              R.events.push({ t, type: "push", x: bx, y: by, team: this.coins[gi].team });
            }
            if (Math.hypot(pos[gi].x - bx, pos[gi].y - by) < R_COIN + R_BALL + 3) {
              bMode = "held"; bHolder = gi;
              R.events.push({ t, type: "pickup", x: bx, y: by, team: this.coins[gi].team });
              break;
            }
          }
        }
        R.ballKeys.push({ t, x: bx, y: by });
      } else {
        R.ballKeys.push({ t, x: bx, y: by });
      }
      if (goal && st % 6 === 0) R.ballKeys.push({ t, x: bx, y: by });
    }

    // RULE: teammates may crash freely, but at rest they must stay out of each
    // other's inner keep-out circle (zone = half the movement circle).
    for (let it = 0; it < 12; it++) {
      let moved = false;
      for (let i = 0; i < 10; i++) {
        for (let j = i + 1; j < 10; j++) {
          if (this.coins[i].team !== this.coins[j].team) continue;
          const minSep = Math.max(this.coins[i].zone, this.coins[j].zone);
          const dx = pos[j].x - pos[i].x, dy = pos[j].y - pos[i].y;
          let d = Math.hypot(dx, dy);
          if (d >= minSep) continue;
          if (d < 0.01) d = 0.01;
          const nx = dx / d, ny = dy / d;
          const push = (minSep - d) / 2 + 0.5;
          const iFrozen = i === frozenGi, jFrozen = j === frozenGi;
          if (iFrozen) { pos[j].x += nx * push * 2; pos[j].y += ny * push * 2; }
          else if (jFrozen) { pos[i].x -= nx * push * 2; pos[i].y -= ny * push * 2; }
          else {
            pos[i].x -= nx * push; pos[i].y -= ny * push;
            pos[j].x += nx * push; pos[j].y += ny * push;
          }
          for (const gi of [i, j]) {
            if (gi === frozenGi) continue;
            const c = this.coins[gi];
            const ox = pos[gi].x - c.ax, oy = pos[gi].y - c.ay;
            const od = Math.hypot(ox, oy);
            if (od > c.orbit) { pos[gi].x = c.ax + (ox / od) * c.orbit; pos[gi].y = c.ay + (oy / od) * c.orbit; }
            pos[gi].x = Math.min(Math.max(pos[gi].x, PITCH.l + R_COIN), PITCH.r - R_COIN);
            pos[gi].y = Math.min(Math.max(pos[gi].y, PITCH.t + R_COIN), PITCH.b - R_COIN);
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
    // glide coins into their corrected resting spots during the playback tail
    for (let gi = 0; gi < 10; gi++) {
      R.coinKeys[gi].push({ t: PHYS_DUR + 0.22, x: pos[gi].x, y: pos[gi].y });
    }

    // tail: settle the outcome into the playback window
    if (!goal) {
      if (bMode === "loose") {
        let best = -1, bd = Infinity;
        for (let gi = 0; gi < 10; gi++) {
          const d = Math.hypot(pos[gi].x - bx, pos[gi].y - by);
          if (d < bd) { bd = d; best = gi; }
        }
        if (best >= 0 && bd < 190) {
          const c = this.coins[best];
          R.events.push({ t: PHYS_DUR + 0.06, type: "pickup", x: bx, y: by, team: c.team });
          const ex = pos[best].x + (c.team === 0 ? R_COIN + R_BALL + 3 : -(R_COIN + R_BALL + 3));
          const NK = 10;
          for (let k = 1; k <= NK; k++) {
            R.ballKeys.push({
              t: PHYS_DUR + 0.02 + (0.22 * k) / NK,
              x: bx + ((ex - bx) * k) / NK,
              y: by + ((pos[best].y - by) * k) / NK,
            });
          }
          R.result = { ballMode: "held", holderId: best, goal: null };
        } else {
          R.result = { ballMode: "loose", holderId: null, goal: null };
        }
      } else if (bMode === "held") {
        R.result = { ballMode: "held", holderId: bHolder, goal: null };
      }
      for (let tt = PHYS_DUR + 0.2; tt <= RESOLVE_TOTAL; tt += 0.22) {
        if (R.result.ballMode === "held" && R.result.holderId != null) {
          const gi = R.result.holderId;
          const c = this.coins[gi];
          R.ballKeys.push({
            t: tt,
            x: pos[gi].x + (c.team === 0 ? R_COIN + R_BALL + 3 : -(R_COIN + R_BALL + 3)),
            y: pos[gi].y,
          });
        } else {
          R.ballKeys.push({ t: tt, x: bx, y: by });
        }
      }
    } else {
      R.result = { ballMode: "loose", holderId: null, goal };
      for (let tt = PHYS_DUR + 0.2; tt <= RESOLVE_TOTAL; tt += 0.22) R.ballKeys.push({ t: tt, x: bx, y: by });
    }

    // ONLINE host: compact the reel ONCE, then both devices play back the
    // very same keys — zero sub-pixel drift between the two phones
    if (this.net.active && this.net.isHost) {
      const ck = R.coinKeys.map((k) => this.compactKeys(k));
      const bk = this.compactKeys(R.ballKeys);
      R.coinKeys = ck.map((arr) => arr.map((k) => ({ ...k })));
      R.ballKeys = bk.map((k) => ({ ...k }));
      this.net.send({
        t: "resolve",
        p: { ck, bk, events: R.events, fw: R.flightWindow, result: R.result, scores: this.scores, stats: this.stats, tick: this.tick },
      });
    }

    this.emit(true);
  }

  private keyAt(keys: Key[], t: number): Key {
    if (keys.length === 0) return { t, x: PITCH_CX, y: PITCH_CY };
    if (t <= keys[0].t) return keys[0];
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i].t) {
        const a = keys[i - 1], b = keys[i];
        const f = (t - a.t) / Math.max(0.0001, b.t - a.t);
        return { t, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      }
    }
    return keys[keys.length - 1];
  }

  private coinPosAt(gi: number, t: number): Vec {
    return this.keyAt(this.resolve.coinKeys[gi] ?? [], t);
  }

  private fire(e: REvent) {
    const col = TEAM_COLOR[e.team];
    switch (e.type) {
      case "clash": {
        const p = e.power ?? 0.5;
        sfx.thud();
        this.shake = Math.max(this.shake, 3 + 8 * p);
        this.burst(e.x, e.y, "#ffe9a8", Math.round(6 + 12 * p), "spark");
        this.addP({ x: e.x, y: e.y, kind: "ring", color: col, life: 0.4, size: 6 });
        if (p > 0.72) this.addP({ x: e.x, y: e.y - 30, kind: "text", label: "CLASH!", color: "#ffe9a8", life: 0.7, vy: -46, size: 20 });
        break;
      }
      case "turnover":
        sfx.denied(); sfx.zap();
        this.shake = Math.max(this.shake, 8);
        this.addP({ x: e.x, y: e.y, kind: "ring", color: "#ff5c5c", life: 0.55, size: 10 });
        this.addP({ x: e.x, y: e.y - 34, kind: "text", label: "TURNOVER!", color: "#ff5c5c", life: 1, vy: -40, size: 22 });
        break;
      case "save":
        sfx.thud(); sfx.zap();
        this.shake = Math.max(this.shake, 10);
        this.burst(e.x, e.y, col, 14, "spark");
        this.addP({ x: e.x, y: e.y - 32, kind: "text", label: "SAVED!", color: col, life: 0.9, vy: -42, size: 21 });
        break;
      case "intercept":
        sfx.zap();
        this.shake = Math.max(this.shake, 9);
        this.burst(e.x, e.y, col, 16, "spark");
        this.addP({ x: e.x, y: e.y, kind: "ring", color: col, life: 0.5, size: 10 });
        this.addP({ x: e.x, y: e.y - 32, kind: "text", label: "CUT!", color: col, life: 0.9, vy: -42, size: 21 });
        break;
      case "kick":
        sfx.kick();
        this.burst(e.x, e.y, "#ffffff", 8, "spark");
        break;
      case "catch":
      case "pickup":
        sfx.catchSfx();
        this.addP({ x: e.x, y: e.y, kind: "ring", color: col, life: 0.35, size: 8 });
        break;
      case "push":
        sfx.kick();
        break;
      case "loose":
        sfx.drop();
        break;
      case "goal":
        break; // handled at resolve end
    }
  }

  private finishResolve() {
    const res = this.resolve.result;
    this.coins.forEach((c, gi) => {
      const arr = this.resolve.coinKeys[gi];
      const k = arr[arr.length - 1];
      c.x = k.x; c.y = k.y; c.vx = 0; c.vy = 0;
      // the movement circle re-centers on where the coin now is
      c.ax = k.x; c.ay = k.y;
    });
    const bp = this.keyAt(this.resolve.ballKeys, RESOLVE_TOTAL);
    this.ball.x = bp.x; this.ball.y = bp.y;
    this.ball.mode = res.ballMode;
    this.ball.holderId = res.holderId;
    if (res.ballMode === "held") this.syncBallToHolder();
    this.plans = [emptyPlan(), emptyPlan()];

    // ONLINE guest: settle the reel, then wait for the host's next phase
    if (this.net.active && !this.net.isHost) {
      if (res.goal != null) {
        this.goalTeam = res.goal;
        this.mode = "goal";
        this.modeUntil = this.time + 9999; // host sends the restart / champion message
        this.bannerId++;
        sfx.horn(); sfx.cheer();
        this.shake = 14;
        const gx = res.goal === 0 ? PITCH.r : PITCH.l;
        for (let i = 0; i < 60; i++) {
          this.addP({
            x: gx, y: PITCH_CY + (Math.random() - 0.5) * 160,
            kind: "confetti", color: Math.random() < 0.5 ? TEAM_COLOR[res.goal] : "#ffd23f",
            life: 1.6 + Math.random(), vx: (Math.random() - 0.5) * 420, vy: -120 - Math.random() * 320,
          });
        }
      } else {
        this.net.awaiting = true;
      }
      this.emit(true);
      return;
    }

    if (res.goal != null) {
      this.goalTeam = res.goal;
      this.scores[res.goal]++;
      this.mode = "goal";
      this.modeUntil = this.time + 2.3;
      this.bannerId++;
      sfx.horn(); sfx.cheer();
      this.shake = 14;
      const gx = res.goal === 0 ? PITCH.r : PITCH.l;
      for (let i = 0; i < 60; i++) {
        this.addP({
          x: gx, y: PITCH_CY + (Math.random() - 0.5) * 160,
          kind: "confetti", color: Math.random() < 0.5 ? TEAM_COLOR[res.goal] : "#ffd23f",
          life: 1.6 + Math.random(), vx: (Math.random() - 0.5) * 420, vy: -120 - Math.random() * 320,
        });
      }
    } else {
      this.tick++;
      this.nextSegment();
    }
    this.emit(true);
  }

  private goalDone() {
    const gt = this.goalTeam;
    if (gt != null && this.scores[gt] >= WIN_GOALS) {
      this.winner = gt;
      this.mode = "champion";
      this.bannerId++;
      sfx.horn();
      if (this.net.active && this.net.isHost) {
        this.net.send({ t: "champion", winner: gt, scores: this.scores, stats: this.stats });
      }
      this.emit(true);
      return;
    }
    // RULE: a goal restarts the 120s round clock
    this.tick = 0;
    this.plans = [emptyPlan(), emptyPlan()];
    this.placeFormations();
    const conceded: Team = (1 - (gt ?? 0)) as Team;
    const holder = this.centerCoin(conceded);
    this.ball.mode = "held";
    this.ball.holderId = holder;
    this.syncBallToHolder();
    if (this.net.active && this.net.isHost) {
      // tell the guest to rebuild the identical kickoff layout before planning
      this.planner = 0;
      this.startPlan();
      this.net.send({
        t: "phase", kind: "plan", tick: 0, reset: true, holderTeam: conceded,
        deadline: Date.now() + PLAN_TIME * 1000, scores: this.scores, forms: this.forms,
      });
      this.emit(true);
      return;
    }
    this.nextSegment();
  }

  /* ---------------- update ---------------- */

  private update(dt: number) {
    this.shake = Math.max(0, this.shake - dt * 26);
    this.coins.forEach((c) => (c.flash = Math.max(0, c.flash - dt * 2.4)));

    // ONLINE: resolve the instant BOTH devices have locked in
    if (
      this.mode === "plan" && this.net.active && this.net.isHost &&
      this.net.hostLocked && this.net.guestPlanIn && this.net.oppLocked
    ) {
      this.net.guestPlanIn = false;
      this.net.oppLocked = false;
      this.startResolve();
    }

    if ((this.mode === "formPick" || this.mode === "plan") && this.time >= this.modeUntil) {
      if (this.mode === "formPick") {
        if (this.net.active) {
          if (this.net.isHost) {
            this.maybeBeginRoundOnline();
          } else if (!this.net.formSent) {
            this.net.send({ t: "form", id: this.forms[this.net.myTeam] });
            this.net.formSent = true;
            this.net.awaiting = true;
            this.modeUntil = this.time + 9999;
            this.emit(true);
          }
        } else if (this.planner === 0) {
          this.planner = 1; this.modeUntil = this.time + FORM_TIME; this.setupIdleField(1); this.emit(true);
        } else this.uiConfirmForm();
      } else if (this.net.active) {
        if (this.net.isHost) {
          // resolve once the guest's plan is in, or after a short grace past the deadline
          if (this.net.guestPlanIn || this.time >= this.modeUntil + 0.6) {
            this.net.guestPlanIn = false;
            this.net.oppLocked = false;
            this.startResolve();
          }
        } else this.lockPlan(); // ships the guest's orders at the deadline
      } else this.lockPlan();
    }
    if (this.mode === "roundIntro" && this.time >= this.modeUntil) this.nextSegment();
    if (this.mode === "roundEnd" && this.time >= this.modeUntil) {
      if (this.net.active) {
        if (this.net.isHost) {
          this.planner = 0;
          this.mode = "formPick";
          this.modeUntil = this.time + FORM_TIME;
          this.setupIdleField(0);
          this.net.send({ t: "phase", kind: "form", fresh: false, round: this.round + 1, deadline: Date.now() + FORM_TIME * 1000, scores: this.scores, forms: this.forms });
        }
        // guest waits for the host's next phase message
        this.emit(true);
      } else {
        this.planner = 0;
        this.handoffNext = "form";
        this.mode = "handoff";
        this.bannerId++;
        this.emit(true);
      }
    }
    if (this.mode === "goal" && this.time >= this.modeUntil) {
      if (this.net.active && !this.net.isHost) {
        // guest: the host decides when the restart / champion screen lands
      } else this.goalDone();
    }

    if (this.mode === "plan") {
      const left = Math.max(0, this.modeUntil - this.time);
      const sec = Math.ceil(left);
      if (sec !== this.lastPlanSec && sec <= 5) { sfx.tickTock(); }
      this.lastPlanSec = sec;
    }

    if (this.mode === "resolve") {
      this.resolve.t += dt;
      const evs = this.resolve.events;
      while (this.resolve.evIdx < evs.length && evs[this.resolve.evIdx].t <= this.resolve.t) {
        this.fire(evs[this.resolve.evIdx++]);
      }
      if (this.resolve.t >= RESOLVE_TOTAL) this.finishResolve();
    }

    if (this.ball.mode === "held" && this.mode !== "resolve") this.syncBallToHolder();
    if (this.mode !== "resolve") this.ball.spin += dt * 0.6;

    // particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      if (p.kind === "confetti") p.vy += 380 * dt;
      if (p.kind === "text") p.vy *= Math.pow(0.2, dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }

    if ((this.mode === "plan" || this.mode === "formPick" || this.mode === "resolve") && this.time - this.lastEmit > 0.1) this.emit();
  }

  private emit(force = false) {
    if (!force && this.time - this.lastEmit < 0.1) return;
    this.lastEmit = this.time;
    const total = this.mode === "formPick" ? FORM_TIME : PLAN_TIME;
    this.onUi({
      mode: this.mode,
      planner: this.planner,
      handoffNext: this.handoffNext,
      scores: [...this.scores] as [number, number],
      round: this.round,
      tick: this.tick,
      planLeft: this.mode === "formPick" || this.mode === "plan" ? Math.max(0, this.modeUntil - this.time) : 0,
      planTotal: total,
      flags: [...this.flags] as [string, string],
      forms: [...this.forms] as [string, string],
      stats: [{ ...this.stats[0] }, { ...this.stats[1] }],
      winner: this.winner,
      goalTeam: this.goalTeam,
      bannerId: this.bannerId,
      ballTeam: this.ball.holderId != null ? this.coins[this.ball.holderId].team : null,
      holderIdx: this.ball.holderId,
      ballInFlight:
        this.mode === "resolve" && this.resolve.flightWindow != null &&
        this.resolve.t >= this.resolve.flightWindow.t0 && this.resolve.t <= this.resolve.flightWindow.t1,
      flightTeam: this.mode === "resolve" && this.resolve.flightWindow ? this.resolve.flightWindow.team : null,
      online: this.net.active,
      myTeam: this.net.active ? this.net.myTeam : null,
      oppLocked: this.net.active && this.net.oppLocked,
      awaiting: this.net.active && this.net.awaiting,
      lockedIn: this.net.active
        ? (this.net.isHost
          ? (this.mode === "formPick" ? this.net.hostFormLocked : this.net.hostLocked)
          : (this.mode === "formPick" ? this.net.formSent : this.net.planSent))
        : false,
    });
  }

  /* ---------------- particles ---------------- */

  private addP(p: { x: number; y: number; kind: Particle["kind"]; color: string; life?: number; vx?: number; vy?: number; size?: number; label?: string }) {
    if (this.particles.length > 420) this.particles.shift();
    this.particles.push({
      x: p.x, y: p.y,
      vx: p.vx ?? (Math.random() - 0.5) * 60,
      vy: p.vy ?? (Math.random() - 0.5) * 60,
      life: p.life ?? 0.6, maxLife: p.life ?? 0.6,
      size: p.size ?? 5, color: p.color, kind: p.kind,
      rot: Math.random() * 7, vr: (Math.random() - 0.5) * 9,
      label: p.label,
    });
  }

  private burst(x: number, y: number, color: string, n: number, kind: Particle["kind"]) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 260;
      this.addP({ x, y, kind, color, life: 0.35 + Math.random() * 0.4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: 2.5 + Math.random() * 3.5 });
    }
  }

  /* ---------------- input ---------------- */

  private toLocal(e: PointerEvent): Vec {
    const r = this.cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }

  private hitCoin(p: Vec, team: Team): number | null {
    let best: number | null = null, bd = R_COIN + 26; // generous finger-sized hit area
    this.coins.forEach((c, gi) => {
      if (c.team !== team) return;
      const d = dist(p, c);
      if (d < bd) { bd = d; best = gi; }
    });
    return best;
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== "Escape") return;
    if (this.mode === "howto" && (e.key === "Enter" || e.key === "Escape")) { this.uiCloseHowto(); return; }
    if (this.mode === "settings" && (e.key === "Enter" || e.key === "Escape")) { this.uiCloseSettings(); return; }
    if (e.key !== "Enter") return;
    switch (this.mode) {
      case "title": this.uiStart(); break;
      case "handoff": this.uiContinueHandoff(); break;
      case "formPick": this.uiConfirmForm(); break;
      case "plan": this.uiLock(); break;
      case "champion": this.uiRematch(); break;
    }
  };

  private onDown = (e: PointerEvent) => {
    if (e.button === 2) return;
    if (this.mode !== "plan") return;
    // online guest: orders already shipped — the board is read-only until the clash
    if (this.net.active && !this.net.isHost && this.net.planSent) return;
    const p = this.toLocal(e);
    // grab the ball itself to plan a pass
    if (
      this.ball.mode === "held" && this.ball.holderId != null &&
      this.coins[this.ball.holderId].team === this.planner &&
      dist(p, { x: this.ball.x, y: this.ball.y }) < R_BALL + 28
    ) {
      this.drag = { kind: "pass", coinIdx: this.ball.holderId };
      this.dragAim = p;
      (this.cv as any).setPointerCapture?.(e.pointerId);
      sfx.pick();
      return;
    }
    const gi = this.hitCoin(p, this.planner);
    if (gi == null) return;
    // the carrier is frozen in place, but it is selectable: dragging from the
    // carrier coin plans the pass (exactly like dragging the ball itself)
    if (this.ball.mode === "held" && this.ball.holderId === gi) {
      this.drag = { kind: "pass", coinIdx: gi };
      this.dragAim = p;
      (this.cv as any).setPointerCapture?.(e.pointerId);
      sfx.pick();
      return;
    }
    this.drag = { kind: "move", coinIdx: gi };
    (this.cv as any).setPointerCapture?.(e.pointerId);
    sfx.pick();
  };

  private onMove = (e: PointerEvent) => {
    const p = this.toLocal(e);
    if (this.mode === "plan" && !this.drag) {
      const nearBall =
        this.ball.mode === "held" && this.ball.holderId != null &&
        this.coins[this.ball.holderId].team === this.planner &&
        dist(p, { x: this.ball.x, y: this.ball.y }) < R_BALL + 28;
      this.hoverCoin = this.hitCoin(p, this.planner);
      // both the ball and the carrier coin are grabbable (they start a pass)
      this.cv.style.cursor = nearBall || this.hoverCoin != null ? "grab" : "default";
    }
    if (!this.drag || this.mode !== "plan") return;
    this.cv.style.cursor = "grabbing";
    if (this.drag.kind === "pass") {
      this.dragAim = p;
    } else {
      const c = this.coins[this.drag.coinIdx];
      const clamped = clampToOrbit(p, { x: c.ax, y: c.ay }, c.orbit);
      const t = this.enforceSpacing(clamped, this.planner, this.drag.coinIdx);
      if (Math.hypot(t.x - clamped.x, t.y - clamped.y) > 4 && this.time - this.lastSpaceWarn > 0.5) {
        this.lastSpaceWarn = this.time;
        sfx.denied();
        this.addP({ x: t.x, y: t.y - 36, kind: "text", label: "KEEP-OUT!", color: "#ffd23f", life: 0.75, vy: -38, size: 15 });
      }
      this.plans[this.planner].moves[c.idx] = t;
    }
  };

  /** planned targets must rest outside every teammate's inner keep-out zone */
  private enforceSpacing(target: Vec, team: Team, idx: number): Vec {
    const me = this.coins[idx];
    let t = { ...target };
    for (let it = 0; it < 3; it++) {
      let ok = true;
      for (let gi = 0; gi < 10; gi++) {
        const c2 = this.coins[gi];
        if (c2.team !== team || gi === idx) continue;
        const eff = this.plans[team].moves[c2.idx] ?? { x: c2.x, y: c2.y };
        const minSep = Math.max(me.zone, c2.zone);
        let dx = t.x - eff.x, dy = t.y - eff.y;
        let d = Math.hypot(dx, dy);
        if (d < minSep) {
          if (d < 0.01) { dx = me.team === 0 ? 1 : -1; dy = 0; d = 1; }
          t = { x: eff.x + (dx / d) * (minSep + 1), y: eff.y + (dy / d) * (minSep + 1) };
          ok = false;
        }
      }
      if (ok) break;
    }
    return clampToOrbit(t, { x: me.ax, y: me.ay }, me.orbit);
  }

  private onUp = (e: PointerEvent) => {
    if (!this.drag || this.mode !== "plan") { this.drag = null; return; }
    const p = this.toLocal(e);
    const team = this.planner;
    const c = this.coins[this.drag.coinIdx];
    if (this.drag.kind === "pass") {
      this.commitPass(team, c, p);
    } else {
      const mv = this.plans[team].moves[c.idx];
      if (mv && dist(mv, c) < 8) {
        this.plans[team].moves[c.idx] = null;
      } else if (mv) sfx.drop();
    }
    this.drag = null;
    this.dragAim = null;
    this.cv.style.cursor = "default";
    this.emit(true);
  };

  private commitPass(team: Team, holder: Coin, aim: Vec) {
    const plan = this.plans[team];
    if (dist(aim, holder) < 20) { plan.pass = null; sfx.drop(); return; }
    let mate = -1, bd = R_COIN + 34; // roomy snap radius for touch
    this.coins.forEach((c2, gi) => {
      if (c2.team !== team || c2 === holder) return;
      const d = dist(aim, c2);
      if (d < bd) { bd = d; mate = gi; }
    });
    if (insideGoalMouth(aim, team)) {
      plan.pass = { target: goalMouthPoint(team, aim), kind: "goal" };
      sfx.kick();
    } else if (mate >= 0) {
      const m = this.coins[mate];
      plan.pass = { target: { x: m.x, y: m.y }, kind: "point", receiverId: mate };
      sfx.pick();
    } else {
      plan.pass = { target: { ...aim }, kind: "point" };
      sfx.pick();
    }
  }

  /* ---------------- stadium background ---------------- */

  private buildStadium() {
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const c = cv.getContext("2d")!;
    // stands
    c.fillStyle = "#07131d";
    c.fillRect(0, 0, W, H);
    const crowd = c.createLinearGradient(0, 0, 0, H);
    crowd.addColorStop(0, "#0d2431");
    crowd.addColorStop(1, "#081824");
    c.fillStyle = crowd;
    c.fillRect(0, 0, W, H);
    for (let i = 0; i < 2400; i++) {
      const x = Math.random() * W, y = Math.random() * H;
      if (x > PITCH.l - 26 && x < PITCH.r + 26 && y > PITCH.t - 24 && y < PITCH.b + 24) continue;
      const cols = ["#274b5e", "#3a5a70", "#51384a", "#2e5a4c", "#5c5346", "#23364a"];
      c.fillStyle = cols[(Math.random() * cols.length) | 0];
      c.globalAlpha = 0.25 + Math.random() * 0.5;
      c.fillRect(x, y, 2, 2);
    }
    c.globalAlpha = 1;

    // pitch surround + stripes
    c.fillStyle = "#0b3d28";
    c.fillRect(PITCH.l - 26, PITCH.t - 24, PITCH.r - PITCH.l + 52, PITCH.b - PITCH.t + 48);
    const stripeW = (PITCH.r - PITCH.l) / 12;
    for (let i = 0; i < 12; i++) {
      c.fillStyle = i % 2 ? "rgba(255,255,255,0.028)" : "rgba(0,0,0,0.05)";
      c.fillRect(PITCH.l + i * stripeW, PITCH.t, stripeW, PITCH.b - PITCH.t);
    }

    // chalk
    c.strokeStyle = "rgba(240,250,244,0.85)";
    c.lineWidth = 2.5;
    c.strokeRect(PITCH.l, PITCH.t, PITCH.r - PITCH.l, PITCH.b - PITCH.t);
    c.beginPath(); c.moveTo(PITCH_CX, PITCH.t); c.lineTo(PITCH_CX, PITCH.b); c.stroke();
    c.beginPath(); c.arc(PITCH_CX, PITCH_CY, 80, 0, 7); c.stroke();
    c.fillStyle = "rgba(240,250,244,0.85)";
    c.beginPath(); c.arc(PITCH_CX, PITCH_CY, 3, 0, 7); c.fill();

    const box = (left: boolean) => {
      const x = left ? PITCH.l : PITCH.r;
      const d = left ? 1 : -1;
      c.strokeRect(Math.min(x, x + d * 150), PITCH_CY - 168, 150, 336);
      c.strokeRect(Math.min(x, x + d * 62), PITCH_CY - 84, 62, 168);
      c.fillStyle = "rgba(240,250,244,0.85)";
      c.beginPath();
      c.arc(x + d * 110, PITCH_CY, 3, 0, 7);
      c.fill();
      c.beginPath();
      if (left) c.arc(x + 118, PITCH_CY, 62, -0.92, 0.92);
      else c.arc(x - 118, PITCH_CY, 62, Math.PI - 0.92, Math.PI + 0.92);
      c.stroke();
    };
    box(true); box(false);

    // goals + nets
    const goal = (left: boolean) => {
      const gx = left ? PITCH.l : PITCH.r;
      const d = left ? -GOAL.depth : GOAL.depth;
      c.strokeStyle = "rgba(240,250,244,0.95)";
      c.lineWidth = 4;
      c.beginPath();
      c.moveTo(gx, PITCH_CY - GOAL.half);
      c.lineTo(gx + d, PITCH_CY - GOAL.half + 8);
      c.lineTo(gx + d, PITCH_CY + GOAL.half - 8);
      c.lineTo(gx, PITCH_CY + GOAL.half);
      c.stroke();
      c.lineWidth = 1;
      c.strokeStyle = "rgba(230,244,236,0.4)";
      for (let i = 0; i <= 10; i++) {
        const f = i / 10;
        const y1 = PITCH_CY - GOAL.half + f * GOAL.half * 2;
        const y2 = PITCH_CY - GOAL.half + 8 + f * (GOAL.half - 8) * 2;
        c.beginPath(); c.moveTo(gx, y1); c.lineTo(gx + d, y2); c.stroke();
      }
      for (let i = 0; i <= 6; i++) {
        const f = i / 6;
        const x1 = gx + d * f;
        c.beginPath(); c.moveTo(x1, PITCH_CY - GOAL.half + 8 * f); c.lineTo(x1, PITCH_CY + GOAL.half - 8 * f); c.stroke();
      }
      c.fillStyle = left ? "rgba(25,211,255,0.14)" : "rgba(255,56,96,0.14)";
      c.fillRect(Math.min(gx, gx + d), PITCH_CY - GOAL.half, Math.abs(d), GOAL.half * 2);
    };
    goal(true); goal(false);

    // ad boards
    c.font = "bold 15px 'Chakra Petch', sans-serif";
    c.textAlign = "center";
    const ads = ["KICKOFF TACTICS", "COIN LEAGUE", "FIRST TO TWO", "12 × 10 SECONDS", "NO STICKS · ALL COINS"];
    c.fillStyle = "#0a1e2a";
    c.fillRect(PITCH.l - 10, 34, PITCH.r - PITCH.l + 20, 26);
    c.fillStyle = "#0a1e2a";
    c.fillRect(PITCH.l - 10, PITCH.b + 42, PITCH.r - PITCH.l + 20, 26);
    ads.forEach((a, i) => {
      c.fillStyle = i % 2 ? "#ffd23f" : "#9fd8e8";
      c.globalAlpha = 0.75;
      c.fillText(a, PITCH.l + ((i + 0.5) * (PITCH.r - PITCH.l)) / ads.length, 52);
      c.fillText(ads[(i + 2) % ads.length], PITCH.l + ((i + 0.5) * (PITCH.r - PITCH.l)) / ads.length, PITCH.b + 60);
    });
    c.globalAlpha = 1;

    // floodlights
    const light = (x: number, y: number) => {
      const g = c.createRadialGradient(x, y, 4, x, y, 240);
      g.addColorStop(0, "rgba(255,250,220,0.5)");
      g.addColorStop(0.25, "rgba(255,250,220,0.12)");
      g.addColorStop(1, "rgba(255,250,220,0)");
      c.fillStyle = g;
      c.fillRect(x - 240, y - 240, 480, 480);
      c.fillStyle = "rgba(255,252,235,0.95)";
      c.beginPath(); c.arc(x, y, 5, 0, 7); c.fill();
    };
    light(60, 12); light(W - 60, 12); light(60, H - 12); light(W - 60, H - 12);

    // vignette
    const v = c.createRadialGradient(PITCH_CX, PITCH_CY, 300, PITCH_CX, PITCH_CY, 820);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,4,10,0.55)");
    c.fillStyle = v;
    c.fillRect(0, 0, W, H);

    this.bg = cv;
  }

  /* ---------------- draw ---------------- */

  private draw() {
    const c = this.ctx;
    const S = this.scale;
    c.setTransform(S * devicePixelRatio, 0, 0, S * devicePixelRatio, 0, 0);
    if (this.shake > 0.2) {
      c.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }
    if (!this.bg) this.buildStadium();
    if (this.bg) c.drawImage(this.bg, 0, 0, W, H);

    // crowd camera flashes
    if (Math.random() < 0.03) {
      const x = Math.random() < 0.5 ? Math.random() * (PITCH.l - 30) : PITCH.r + 30 + Math.random() * (W - PITCH.r - 30);
      this.addP({ x, y: Math.random() * H, kind: "flash", color: "#fffbe6", life: 0.18, size: 2 + Math.random() * 3 });
    }

    this.drawOrbits(c);
    this.drawPlans(c);
    this.drawCoins(c);
    this.drawBall(c);
    this.drawParticles(c);
  }

  private teamOf(gi: number): Team { return this.coins[gi]?.team ?? 0; }

  private drawOrbits(c: CanvasRenderingContext2D) {
    if (this.mode !== "plan" && this.mode !== "resolve") return;

    if (this.mode === "resolve") {
      // faint live keep-out rings for both teams
      c.save();
      for (let gi = 0; gi < 10; gi++) {
        const cn = this.coins[gi];
        const p = this.coinPosAt(gi, this.resolve.t);
        c.globalAlpha = 0.1;
        c.strokeStyle = TEAM_COLOR[cn.team];
        c.lineWidth = 1.2;
        c.beginPath(); c.arc(p.x, p.y, cn.zone, 0, 7); c.stroke();
      }
      c.restore();
      return;
    }

    const team = this.planner;
    const col = TEAM_COLOR[team];
    const lockedGi = this.ball.mode === "held" ? this.ball.holderId : null;
    const plan = this.plans[team];
    c.save();
    c.font = "bold 9px 'Chakra Petch', sans-serif";
    c.textAlign = "center";
    this.coins.forEach((cn, gi) => {
      if (cn.team !== team) return;

      // inner keep-out zone sits at the coin's projected resting spot
      const mv = plan.moves[cn.idx];
      const rp = mv ?? { x: cn.x, y: cn.y };
      let violated = false;
      this.coins.forEach((c2, g2) => {
        if (g2 === gi || c2.team !== team) return;
        const eff = plan.moves[c2.idx] ?? { x: c2.x, y: c2.y };
        if (dist(rp, eff) < cn.zone - 1) violated = true;
      });
      const zcol = violated ? "#ff5c5c" : col;
      c.globalAlpha = violated ? 0.2 : 0.07;
      c.fillStyle = zcol;
      c.beginPath(); c.arc(rp.x, rp.y, cn.zone, 0, 7); c.fill();
      c.globalAlpha = violated ? 0.95 : 0.38;
      c.strokeStyle = zcol;
      c.lineWidth = violated ? 2 : 1.3;
      c.setLineDash(violated ? [] : [2, 5]);
      c.beginPath(); c.arc(rp.x, rp.y, cn.zone, 0, 7); c.stroke();
      c.setLineDash([]);

      if (gi === lockedGi) {
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 5);
        c.globalAlpha = 0.55 + pulse * 0.35;
        c.fillStyle = "#ffd23f";
        c.fillText("HOLDER · DRAG COIN OR BALL TO PASS ▸", cn.ax, cn.ay + R_COIN + 17);
        return;
      }

      const active = this.drag?.kind === "move" && this.drag.coinIdx === gi;
      const hov = this.hoverCoin === gi;
      // outer movement circle
      c.globalAlpha = active ? 0.55 : hov ? 0.34 : 0.15;
      c.strokeStyle = col;
      c.setLineDash([4, 8]);
      c.lineWidth = active ? 2 : 1.4;
      c.beginPath(); c.arc(cn.ax, cn.ay, cn.orbit, 0, 7); c.stroke();
      c.setLineDash([]);
      if (active) {
        c.globalAlpha = 0.06;
        c.fillStyle = col;
        c.beginPath(); c.arc(cn.ax, cn.ay, cn.orbit, 0, 7); c.fill();
      }
      c.globalAlpha = active ? 0.8 : 0.3;
      c.fillStyle = col;
      c.beginPath(); c.arc(cn.ax, cn.ay, 2.4, 0, 7); c.fill();
      c.globalAlpha = active ? 0.75 : 0.28;
      c.fillText(cn.role.toUpperCase(), cn.ax, cn.ay - cn.orbit - 5);
      if (violated) {
        c.fillStyle = "#ff5c5c";
        c.globalAlpha = 0.95;
        c.fillText("TOO CLOSE", rp.x, rp.y + cn.zone + 11);
      }
    });
    c.restore();
  }

  private drawPlans(c: CanvasRenderingContext2D) {
    if (this.mode !== "plan") return;
    const team = this.planner;
    const plan = this.plans[team];
    const col = TEAM_COLOR[team];

    this.coins.forEach((cn, gi) => {
      if (cn.team !== team) return;
      const mv = plan.moves[cn.idx];
      const active = this.drag?.kind === "move" && this.drag.coinIdx === gi;
      if (mv) {
        const d = dist(cn, mv);
        const power = Math.min(1, d / cn.orbit);
        c.save();
        c.strokeStyle = col;
        c.globalAlpha = active ? 0.95 : 0.6;
        c.setLineDash([7, 7]);
        c.lineWidth = 2 + 3.2 * power; // thicker = more power
        c.beginPath(); c.moveTo(cn.x, cn.y); c.lineTo(mv.x, mv.y); c.stroke();
        c.setLineDash([]);
        const a = Math.atan2(mv.y - cn.y, mv.x - cn.x);
        c.fillStyle = col;
        c.beginPath();
        c.moveTo(mv.x - Math.cos(a - 0.42) * 12, mv.y - Math.sin(a - 0.42) * 12);
        c.lineTo(mv.x, mv.y);
        c.lineTo(mv.x - Math.cos(a + 0.42) * 12, mv.y - Math.sin(a + 0.42) * 12);
        c.closePath(); c.fill();
        c.globalAlpha = 0.38;
        const gD = R_COIN * 2;
        const em = makeEmblem(this.flags[team], gD, col);
        c.drawImage(em, mv.x - R_COIN, mv.y - R_COIN, gD, gD);
        c.globalAlpha = 0.8;
        c.setLineDash([4, 5]);
        c.lineWidth = 1.6;
        c.beginPath(); c.arc(mv.x, mv.y, R_COIN + 5, 0, 7); c.stroke();
        c.restore();
      } else if (active || this.hoverCoin === gi) {
        c.save();
        c.strokeStyle = col;
        c.globalAlpha = 0.8;
        c.setLineDash([3, 6]);
        c.lineWidth = 2;
        c.beginPath(); c.arc(cn.x, cn.y, R_COIN + 9 + Math.sin(this.time * 6) * 2, 0, 7); c.stroke();
        c.restore();
      }
    });

    // pass plan / live aim
    if (this.ball.mode === "held" && this.ball.holderId != null && this.teamOf(this.ball.holderId) === team) {
      const holder = this.coins[this.ball.holderId];
      const aiming = this.drag?.kind === "pass" && this.dragAim;
      let target: Vec | null = null;
      let kind: "point" | "goal" = "point";
      let receiver: number | null = null;
      if (aiming && this.dragAim) {
        if (insideGoalMouth(this.dragAim, team)) { target = goalMouthPoint(team, this.dragAim); kind = "goal"; }
        else {
          let mate = -1, bd = R_COIN + 34;
          this.coins.forEach((c2, gi) => {
            if (c2.team !== team || c2 === holder) return;
            const d = dist(this.dragAim!, c2);
            if (d < bd) { bd = d; mate = gi; }
          });
          if (mate >= 0) {
            receiver = mate;
            const m = this.coins[mate];
            target = plan.moves[m.idx] ?? { x: m.x, y: m.y };
          } else target = this.dragAim;
        }
      } else if (plan.pass) {
        target = plan.pass.target;
        kind = plan.pass.kind;
        receiver = plan.pass.receiverId ?? null;
        if (receiver != null) {
          const m = this.coins[receiver];
          target = plan.moves[m.idx] ?? target;
        }
      }
      if (target) {
        c.save();
        const pcol = kind === "goal" ? "#ffd23f" : col;
        c.strokeStyle = pcol;
        c.globalAlpha = aiming ? 0.95 : 0.75;
        c.lineWidth = 2.6;
        c.setLineDash(kind === "goal" ? [2, 8] : [10, 8]);
        c.lineCap = "round";
        c.beginPath(); c.moveTo(holder.x, holder.y); c.lineTo(target.x, target.y); c.stroke();
        c.setLineDash([]);
        const a = Math.atan2(target.y - holder.y, target.x - holder.x);
        c.fillStyle = pcol;
        c.beginPath();
        c.moveTo(target.x, target.y);
        c.lineTo(target.x - Math.cos(a - 0.4) * 15, target.y - Math.sin(a - 0.4) * 15);
        c.lineTo(target.x - Math.cos(a + 0.4) * 15, target.y - Math.sin(a + 0.4) * 15);
        c.closePath(); c.fill();
        c.font = "bold 13px 'Chakra Petch', sans-serif";
        c.textAlign = "center";
        if (kind === "goal") {
          c.globalAlpha = 0.85;
          c.fillStyle = "#ffd23f";
          c.fillText("SHOT!", target.x + (team === 0 ? -46 : 46), target.y - 14);
        }
        if (receiver != null) {
          const m = this.coins[receiver];
          c.globalAlpha = 0.9;
          c.lineWidth = 2.4;
          c.beginPath(); c.arc(m.x, m.y, R_COIN + 8, 0, 7); c.stroke();
        }
        c.restore();
      } else if (!aiming) {
        // pulsing hint: grab the ball to pass
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 5);
        c.save();
        c.strokeStyle = "#ffd23f";
        c.globalAlpha = 0.45 + pulse * 0.4;
        c.setLineDash([4, 5]);
        c.lineWidth = 2;
        c.beginPath(); c.arc(this.ball.x, this.ball.y, R_BALL + 7 + pulse * 3, 0, 7); c.stroke();
        c.restore();
      }
    }
  }

  private drawCoins(c: CanvasRenderingContext2D) {
    this.coins.forEach((cn, gi) => {
      let x = cn.x, y = cn.y;
      if (this.mode === "resolve") {
        const p = this.coinPosAt(gi, this.resolve.t);
        x = p.x; y = p.y;
      }
      const col = TEAM_COLOR[cn.team];
      const isHolder = this.ball.mode === "held" && this.ball.holderId === gi;

      c.save();
      // shadow
      c.globalAlpha = 0.35;
      c.fillStyle = "#000";
      c.beginPath(); c.ellipse(x + 3, y + 6, R_COIN * 0.95, R_COIN * 0.5, 0, 0, 7); c.fill();
      c.globalAlpha = 1;

      // metallic body
      const g = c.createRadialGradient(x - 7, y - 8, 4, x, y, R_COIN + 4);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.35, col);
      g.addColorStop(1, cn.team === 0 ? "#063c50" : "#5c0a1e");
      c.fillStyle = g;
      c.beginPath(); c.arc(x, y, R_COIN, 0, 7); c.fill();

      // face emblem (scaled to fill the coin face)
      const faceD = Math.round((R_COIN - 4) * 2);
      const em = makeEmblem(this.flags[cn.team], faceD, "rgba(0,0,0,0.35)");
      c.save();
      c.beginPath(); c.arc(x, y, R_COIN - 4, 0, 7); c.clip();
      c.drawImage(em, x - faceD / 2, y - faceD / 2, faceD, faceD);
      c.restore();

      // rim
      c.lineWidth = 3;
      c.strokeStyle = col;
      c.beginPath(); c.arc(x, y, R_COIN - 1.5, 0, 7); c.stroke();

      // holder gold ring + pulse
      if (isHolder && this.mode !== "resolve") {
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
        c.strokeStyle = "#ffd23f";
        c.lineWidth = 3;
        c.globalAlpha = 0.85;
        c.beginPath(); c.arc(x, y, R_COIN + 5 + pulse * 2, 0, 7); c.stroke();
      }

      // flash on clash
      if (cn.flash > 0) {
        c.globalAlpha = cn.flash * 0.8;
        c.strokeStyle = "#fff";
        c.lineWidth = 3;
        c.beginPath(); c.arc(x, y, R_COIN + 6 + (1 - cn.flash) * 8, 0, 7); c.stroke();
      }
      c.restore();
    });
  }

  private drawBall(c: CanvasRenderingContext2D) {
    let bx = this.ball.x, by = this.ball.y, spin = this.ball.spin;
    let flying = false;
    if (this.mode === "resolve") {
      const p = this.keyAt(this.resolve.ballKeys, this.resolve.t);
      bx = p.x; by = p.y;
      spin = this.resolve.t * 9;
      const fw = this.resolve.flightWindow;
      flying = fw != null && this.resolve.t >= fw.t0 && this.resolve.t <= fw.t1 + 0.12;
    }

    if (flying) {
      for (let i = 1; i <= 5; i++) {
        const q = this.keyAt(this.resolve.ballKeys, this.resolve.t - i * 0.03);
        c.globalAlpha = 0.16 - i * 0.028;
        c.fillStyle = "#fff";
        c.beginPath(); c.arc(q.x, q.y, R_BALL - i * 0.8, 0, 7); c.fill();
      }
      c.globalAlpha = 1;
    }

    c.save();
    c.globalAlpha = 0.35;
    c.fillStyle = "#000";
    c.beginPath(); c.ellipse(bx + 2, by + 5, R_BALL * 0.9, R_BALL * 0.45, 0, 0, 7); c.fill();
    c.globalAlpha = 1;
    c.translate(bx, by);
    c.rotate(spin);
    c.fillStyle = "#f4f6f5";
    c.beginPath(); c.arc(0, 0, R_BALL, 0, 7); c.fill();
    const bk = R_BALL / 11; // pattern scale (tuned for an 11px ball)
    c.fillStyle = "#17181c";
    c.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      const px = Math.cos(a) * 4.6 * bk, py = Math.sin(a) * 4.6 * bk;
      i === 0 ? c.moveTo(px, py) : c.lineTo(px, py);
    }
    c.closePath(); c.fill();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2 + Math.PI / 5;
      c.beginPath();
      c.arc(Math.cos(a) * 10.4 * bk, Math.sin(a) * 10.4 * bk, 3.4 * bk, 0, 7);
      c.fill();
    }
    c.strokeStyle = "rgba(0,0,0,0.4)";
    c.lineWidth = 1.4;
    c.beginPath(); c.arc(0, 0, R_BALL - 0.7, 0, 7); c.stroke();
    c.restore();
  }

  private drawParticles(c: CanvasRenderingContext2D) {
    this.particles.forEach((p) => {
      const f = p.life / p.maxLife;
      c.save();
      if (p.kind === "spark") {
        c.globalAlpha = f;
        c.fillStyle = p.color;
        c.beginPath(); c.arc(p.x, p.y, p.size * f, 0, 7); c.fill();
      } else if (p.kind === "ring") {
        c.globalAlpha = f * 0.9;
        c.strokeStyle = p.color;
        c.lineWidth = 3;
        c.beginPath(); c.arc(p.x, p.y, p.size + (1 - f) * 42, 0, 7); c.stroke();
      } else if (p.kind === "confetti") {
        c.globalAlpha = Math.min(1, f * 1.6);
        c.translate(p.x, p.y);
        c.rotate(p.rot);
        c.fillStyle = p.color;
        c.fillRect(-4, -2.5, 8, 5);
      } else if (p.kind === "flash") {
        c.globalAlpha = f;
        c.fillStyle = p.color;
        c.beginPath(); c.arc(p.x, p.y, p.size * (2 - f), 0, 7); c.fill();
      } else if (p.kind === "text" && p.label) {
        c.globalAlpha = Math.min(1, f * 1.8);
        c.font = `${p.size}px 'Archivo Black', sans-serif`;
        c.textAlign = "center";
        c.lineWidth = 4;
        c.strokeStyle = "rgba(0,0,0,0.7)";
        c.strokeText(p.label, p.x, p.y);
        c.fillStyle = p.color;
        c.fillText(p.label, p.x, p.y);
      }
      c.restore();
    });
  }
}

export type { Team };
export { TEAM_COLOR, WIN_GOALS, TICKS_PER_ROUND, SEG_SECS } from "./core";
