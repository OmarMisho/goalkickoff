/* tiny synth kit — kicks, clanks, whistles & horns. Silent during planning. */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
}

function tone(
  freq: number,
  dur: number,
  opts: { type?: OscillatorType; vol?: number; slide?: number; delay?: number } = {},
) {
  if (!ctx || !master) return;
  const { type = "square", vol = 0.16, slide = 0, delay = 0 } = opts;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(dur: number, vol = 0.12, hp = 800) {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = hp;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

export const sfx = {
  click: () => tone(520, 0.06, { type: "square", vol: 0.1 }),
  pick: () => tone(660, 0.07, { type: "triangle", vol: 0.14, slide: 220 }),
  drop: () => tone(330, 0.09, { type: "triangle", vol: 0.12, slide: -140 }),
  denied: () => {
    tone(190, 0.12, { type: "sawtooth", vol: 0.12 });
    tone(140, 0.14, { type: "sawtooth", vol: 0.1, delay: 0.07 });
  },
  kick: () => {
    tone(210, 0.12, { type: "sine", vol: 0.3, slide: -140 });
    noise(0.08, 0.1, 1200);
  },
  thud: () => {
    tone(120, 0.14, { type: "sine", vol: 0.26, slide: -70 });
    noise(0.06, 0.12, 500);
  },
  catchSfx: () => {
    tone(440, 0.07, { type: "square", vol: 0.12 });
    tone(660, 0.08, { type: "square", vol: 0.1, delay: 0.06 });
  },
  zap: () => tone(880, 0.16, { type: "sawtooth", vol: 0.14, slide: -620 }),
  whistle: () => {
    tone(2200, 0.32, { type: "square", vol: 0.07 });
    tone(2330, 0.32, { type: "square", vol: 0.05 });
    tone(2200, 0.4, { type: "square", vol: 0.07, delay: 0.36 });
  },
  horn: () => {
    [220, 277, 330].forEach((f, i) => tone(f, 0.7, { type: "sawtooth", vol: 0.1, delay: i * 0.02 }));
    tone(440, 0.9, { type: "square", vol: 0.06, delay: 0.05 });
  },
  tickTock: () => tone(980, 0.045, { type: "square", vol: 0.06 }),
  cheer: () => {
    noise(0.7, 0.16, 400);
    noise(0.5, 0.1, 900);
  },
};
