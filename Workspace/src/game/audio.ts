// ── Tiny WebAudio synth — all game sounds generated, no assets ─────────
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = false;

export function initAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const len = Math.floor(ctx.sampleRate * 1.5);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* audio unavailable — game stays silent */
  }
}

export function setMuted(m: boolean) {
  muted = m;
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.5, ctx.currentTime, 0.02);
}
export function isMuted() {
  return muted;
}

function osc(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, when = 0) {
  if (!ctx || !master || muted) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(1, f0), t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur: number, vol: number, freq: number, q = 1, when = 0, sweepTo?: number) {
  if (!ctx || !master || !noiseBuf || muted) return;
  const t = ctx.currentTime + when;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f);
  f.connect(g);
  g.connect(master);
  s.start(t);
  s.stop(t + dur + 0.05);
}

export const sfx = {
  click() {
    osc('square', 680, 480, 0.06, 0.1);
  },
  select() {
    osc('square', 500, 780, 0.07, 0.13);
  },
  kick(p: number) {
    osc('sine', 150 + p * 70, 38, 0.17, 0.5);
    noise(0.13, 0.28, 1700, 0.7);
  },
  twang() {
    // bowstring snapping forward on release + arrow whooshing away
    osc('sawtooth', 260, 68, 0.26, 0.2);
    osc('triangle', 520, 110, 0.14, 0.1);
    noise(0.07, 0.16, 2400, 1.4);
    noise(0.2, 0.09, 700, 0.8, 0.02, 2600); // the arrow's flight whoosh
  },
  bounce(v: number) {
    const p = Math.min(1, v / 700);
    osc('sine', 190 + p * 260, 85, 0.08, 0.08 + p * 0.18);
  },
  clack(v: number) {
    const p = Math.min(1, v / 700);
    noise(0.05, 0.14 + p * 0.2, 900 + p * 900, 1.2);
    osc('triangle', 330, 130, 0.06, 0.1);
  },
  post() {
    osc('triangle', 1250, 600, 0.32, 0.28);
    osc('triangle', 1870, 900, 0.25, 0.14);
    noise(0.07, 0.2, 2600, 2);
  },
  whistle(n = 1) {
    for (let i = 0; i < n; i++) {
      osc('square', 2350, 2260, 0.2, 0.1, i * 0.3);
      osc('square', 2365, 2275, 0.2, 0.06, i * 0.3);
    }
  },
  tick() {
    osc('square', 1150, 950, 0.05, 0.09);
  },
  goal() {
    noise(1.5, 0.45, 700, 0.45, 0, 2600);
    osc('sawtooth', 392, 392, 0.11, 0.13, 0.05);
    osc('sawtooth', 523, 523, 0.11, 0.13, 0.17);
    osc('sawtooth', 659, 659, 0.11, 0.13, 0.29);
    osc('sawtooth', 784, 784, 0.32, 0.15, 0.41);
    sfx.whistle(1);
  },
  over() {
    sfx.whistle(3);
    noise(2.4, 0.4, 600, 0.45, 0.25, 1900);
  },
};

// ── Charge sounds: the "stretch" you hear while pulling a strike back ──
export interface ChargeSoundDef {
  id: string;
  name: string;
  desc: string;
  fresh?: boolean;
}

export const CHARGE_SOUNDS: ChargeSoundDef[] = [
  { id: 'arrow', name: 'ARROW DRAW', desc: 'The classic bow-draw: rising creak under tension, string strain, then a twang & whoosh on release.' },
  { id: 'rubber', name: 'RUBBER BAND', desc: 'A stretchy boing that rises smoothly and wobbles near full draw.' },
  { id: 'spring', name: 'SPRING RATCHET', desc: 'Mechanical coil clicks — rising sproing ticks as you pull further.' },
  { id: 'whistle', name: 'TURBO WHISTLE', desc: 'A clean accelerating whistle, like pressure building in a kettle.' },
  { id: 'rope', name: 'ROPE GROAN', desc: 'A soft woody creak under tension. The quietest, calmest option.' },
  { id: 'retro', name: 'RETRO RISER', desc: 'An 8-bit power-up glide climbing in chunky arcade steps.' },
];

export function isChargeId(id: string): boolean {
  return CHARGE_SOUNDS.some((s) => s.id === id);
}

interface ChargeImpl {
  start(): void;
  set(p: number): void;
  stop(): void;
}

function stopNode(n: AudioScheduledSourceNode | null) {
  if (!n || !ctx) return;
  try {
    n.stop(ctx.currentTime + 0.12);
    n.disconnect();
  } catch {
    /* already stopped */
  }
}

// 0 — ARROW: the classic bow-draw. A low creaking tension that climbs as you
//    pull, a strained detuned string layer, and rising wood/air rasp — exactly
//    the "drawing an arrow" feel, finished by the release twang + whoosh.
function makeArrow(): ChargeImpl {
  let o1: OscillatorNode | null = null;
  let o2: OscillatorNode | null = null;
  let g: GainNode | null = null;
  let n: AudioBufferSourceNode | null = null;
  let f: BiquadFilterNode | null = null;
  let ng: GainNode | null = null;
  let lfo: OscillatorNode | null = null;
  let lg: GainNode | null = null;
  return {
    start() {
      if (!ctx || !master) return;
      const t = ctx.currentTime;
      o1 = ctx.createOscillator();
      o1.type = 'sawtooth';
      o1.frequency.value = 56;
      o2 = ctx.createOscillator();
      o2.type = 'triangle';
      o2.frequency.value = 59;
      g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(muted ? 0 : 0.05, t + 0.12);
      lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 11;
      lg = ctx.createGain();
      lg.gain.value = 0;
      lfo.connect(lg);
      lg.connect(o1.frequency);
      lg.connect(o2.frequency);
      o1.connect(g);
      o2.connect(g);
      g.connect(master);
      o1.start(t);
      o2.start(t);
      lfo.start(t);
      if (noiseBuf) {
        n = ctx.createBufferSource();
        n.buffer = noiseBuf;
        n.loop = true;
        f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 340;
        f.Q.value = 6;
        ng = ctx.createGain();
        ng.gain.setValueAtTime(0.0001, t);
        ng.gain.linearRampToValueAtTime(muted ? 0 : 0.04, t + 0.15);
        n.connect(f);
        f.connect(ng);
        ng.connect(master);
        n.start(t);
      }
    },
    set(p) {
      if (!ctx || !o1 || !o2 || !g) return;
      const t = ctx.currentTime;
      const fr = 56 + p * p * 170; // tension climbs harder near full draw
      o1.frequency.setTargetAtTime(fr, t, 0.05);
      o2.frequency.setTargetAtTime(fr * 1.053, t, 0.05);
      lfo?.frequency.setTargetAtTime(11 + p * 6, t, 0.1);
      lg?.gain.setTargetAtTime(p * p * 9, t, 0.08); // strain vibrato when taut
      g.gain.setTargetAtTime(muted ? 0 : 0.04 + p * 0.05, t, 0.07);
      if (f) f.frequency.setTargetAtTime(340 + p * 540, t, 0.06);
      if (ng) ng.gain.setTargetAtTime(muted ? 0 : 0.03 + p * 0.04, t, 0.07);
    },
    stop() {
      if (!ctx) return;
      if (g) g.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      if (ng) ng.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      stopNode(o1);
      stopNode(o2);
      stopNode(lfo);
      stopNode(n);
      o1 = o2 = lfo = n = null;
      f = g = ng = lg = null;
    },
  };
}

// 1 — RUBBER BAND: triangle + octave sine glide up, vibrato LFO deepens with power.
function makeRubber(): ChargeImpl {
  let o1: OscillatorNode | null = null;
  let o2: OscillatorNode | null = null;
  let g: GainNode | null = null;
  let lfo: OscillatorNode | null = null;
  let lg: GainNode | null = null;
  return {
    start() {
      if (!ctx || !master) return;
      const t = ctx.currentTime;
      o1 = ctx.createOscillator();
      o1.type = 'triangle';
      o1.frequency.value = 82;
      o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = 165;
      g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(muted ? 0 : 0.05, t + 0.12);
      lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 8.5;
      lg = ctx.createGain();
      lg.gain.value = 0;
      lfo.connect(lg);
      lg.connect(o1.frequency);
      lg.connect(o2.frequency);
      o1.connect(g);
      o2.connect(g);
      g.connect(master);
      o1.start(t);
      o2.start(t);
      lfo.start(t);
    },
    set(p) {
      if (!ctx || !o1 || !o2 || !g || !lfo || !lg) return;
      const t = ctx.currentTime;
      const f = 82 + p * 300;
      o1.frequency.setTargetAtTime(f, t, 0.05);
      o2.frequency.setTargetAtTime(f * 2.01, t, 0.05);
      lfo.frequency.setTargetAtTime(8.5 + p * 7, t, 0.1);
      lg.gain.setTargetAtTime(p * p * 24, t, 0.08); // wobble only when taut
      g.gain.setTargetAtTime(muted ? 0 : 0.045 + p * 0.04, t, 0.07);
    },
    stop() {
      if (!ctx || !g) return;
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      stopNode(o1);
      stopNode(o2);
      stopNode(lfo);
      o1 = o2 = lfo = null;
      g = lg = null;
    },
  };
}

// 2 — SPRING RATCHET: discrete sproing ticks, each higher than the last.
function makeSpring(): ChargeImpl {
  let last = -1;
  return {
    start() {
      last = -1;
    },
    set(p) {
      if (!ctx || !master || muted) return;
      const step = Math.floor(p * 10.999);
      if (step <= last) return;
      last = step;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = 'sine';
      const f = 210 + step * 58;
      o.frequency.setValueAtTime(f * 1.55, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.085, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + 0.15);
      if (noiseBuf) {
        const n = ctx.createBufferSource();
        n.buffer = noiseBuf;
        const f2 = ctx.createBiquadFilter();
        f2.type = 'bandpass';
        f2.frequency.value = 2600 + step * 180;
        f2.Q.value = 2;
        const g2 = ctx.createGain();
        g2.gain.setValueAtTime(0.05, t);
        g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
        n.connect(f2);
        f2.connect(g2);
        g2.connect(master);
        n.start(t);
        n.stop(t + 0.06);
      }
    },
    stop() {
      last = -1;
    },
  };
}

// 3 — TURBO WHISTLE: two detuned sines gliding upward, air builds with power.
function makeWhistle(): ChargeImpl {
  let o1: OscillatorNode | null = null;
  let o2: OscillatorNode | null = null;
  let g: GainNode | null = null;
  return {
    start() {
      if (!ctx || !master) return;
      const t = ctx.currentTime;
      o1 = ctx.createOscillator();
      o1.type = 'sine';
      o1.frequency.value = 330;
      o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = 333;
      g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(muted ? 0 : 0.035, t + 0.12);
      o1.connect(g);
      o2.connect(g);
      g.connect(master);
      o1.start(t);
      o2.start(t);
    },
    set(p) {
      if (!ctx || !o1 || !o2 || !g) return;
      const t = ctx.currentTime;
      const f = 330 + Math.pow(p, 1.35) * 1150;
      o1.frequency.setTargetAtTime(f, t, 0.06);
      o2.frequency.setTargetAtTime(f * 1.009, t, 0.06);
      g.gain.setTargetAtTime(muted ? 0 : 0.03 + p * 0.04, t, 0.07);
    },
    stop() {
      if (!ctx || !g) return;
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      stopNode(o1);
      stopNode(o2);
      o1 = o2 = null;
      g = null;
    },
  };
}

// 4 — ROPE GROAN: band-passed noise creak + low sub, tension rises gently.
function makeRope(): ChargeImpl {
  let n: AudioBufferSourceNode | null = null;
  let f: BiquadFilterNode | null = null;
  let g: GainNode | null = null;
  let sub: OscillatorNode | null = null;
  let sg: GainNode | null = null;
  return {
    start() {
      if (!ctx || !master || !noiseBuf) return;
      const t = ctx.currentTime;
      n = ctx.createBufferSource();
      n.buffer = noiseBuf;
      n.loop = true;
      f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 150;
      f.Q.value = 7;
      g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(muted ? 0 : 0.05, t + 0.15);
      n.connect(f);
      f.connect(g);
      g.connect(master);
      n.start(t);
      sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.value = 52;
      sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t);
      sg.gain.linearRampToValueAtTime(muted ? 0 : 0.028, t + 0.15);
      sub.connect(sg);
      sg.connect(master);
      sub.start(t);
    },
    set(p) {
      if (!ctx || !f || !g || !sub || !sg) return;
      const t = ctx.currentTime;
      f.frequency.setTargetAtTime(150 + p * 290, t, 0.06);
      g.gain.setTargetAtTime(muted ? 0 : 0.045 + p * 0.03, t, 0.07);
      sub.frequency.setTargetAtTime(52 + p * 38, t, 0.06);
      sg.gain.setTargetAtTime(muted ? 0 : 0.025 + p * 0.02, t, 0.07);
    },
    stop() {
      if (!ctx) return;
      if (g) g.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      if (sg) sg.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      stopNode(n);
      stopNode(sub);
      n = sub = null;
      f = g = sg = null;
    },
  };
}

// 5 — RETRO RISER: square wave climbing in chunky two-semitone steps.
function makeRetro(): ChargeImpl {
  let o: OscillatorNode | null = null;
  let g: GainNode | null = null;
  let last = -1;
  return {
    start() {
      if (!ctx || !master) return;
      const t = ctx.currentTime;
      o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 150;
      g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(muted ? 0 : 0.032, t + 0.1);
      o.connect(g);
      g.connect(master);
      o.start(t);
      last = -1;
    },
    set(p) {
      if (!ctx || !o || !g) return;
      const t = ctx.currentTime;
      const step = Math.floor(p * 10.999);
      if (step !== last) {
        last = step;
        o.frequency.setTargetAtTime(150 * Math.pow(2, step / 6), t, 0.035);
      }
      g.gain.setTargetAtTime(muted ? 0 : 0.028 + p * 0.022, t, 0.06);
    },
    stop() {
      if (!ctx || !g) return;
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      stopNode(o);
      o = null;
      g = null;
    },
  };
}

const IMPLS: Record<string, () => ChargeImpl> = {
  arrow: makeArrow,
  rubber: makeRubber,
  spring: makeSpring,
  whistle: makeWhistle,
  rope: makeRope,
  retro: makeRetro,
};

let activeId = 'arrow'; // the requested bow-draw sound is the default
let impl: ChargeImpl | null = null;

export function getChargeSound() {
  return activeId;
}
export function setChargeSound(id: string) {
  activeId = isChargeId(id) ? id : 'rubber';
}

export function chargeStart() {
  initAudio();
  try {
    impl?.stop();
  } catch {
    /* noop */
  }
  impl = null;
  const make = IMPLS[activeId] ?? IMPLS.rubber;
  try {
    impl = make();
    impl.start();
  } catch {
    impl = null;
  }
}

export function chargeSet(p: number) {
  try {
    impl?.set(p);
  } catch {
    /* noop */
  }
}

export function chargeStop() {
  try {
    impl?.stop();
  } catch {
    /* noop */
  }
  impl = null;
}

// ── Preview runner: ramps a charge from 0 → full over ~1.5s so you can
//    audition a sound from the Sound Lab, ending with a release twang. ──
let previewToken = 0;

export function previewCharge(id: string, keepSelected: boolean) {
  initAudio();
  const cid = isChargeId(id) ? id : 'rubber';
  previewToken++;
  const token = previewToken;
  chargeStop();
  const prev = activeId;
  activeId = cid;
  chargeStart();
  const t0 = performance.now();
  const DUR = 1500;
  const tick = () => {
    if (token !== previewToken) return; // superseded by a newer preview
    const el = performance.now() - t0;
    const p = Math.min(1, el / DUR);
    const eased = p * p * (3 - 2 * p); // smoothstep stretch feel
    chargeSet(eased);
    if (p < 1) {
      window.setTimeout(tick, 28);
    } else {
      chargeStop();
      if (!keepSelected) activeId = prev;
      sfx.twang();
    }
  };
  window.setTimeout(tick, 28);
}
