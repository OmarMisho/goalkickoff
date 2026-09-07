import { useEffect, useRef, useState } from 'react';
import type { GameStats, Settings } from '../game/defs';
import {
  FORMATIONS, TEAM, formationById, formationSlots, TARGET_SCORE, MISS_LIMIT,
  PITCH, CX, MID_Y, GOAL_W, GOAL_D,
} from '../game/defs';
import { SKINS, skinById, paintStick } from '../game/skins';
import { CHARGE_SOUNDS, previewCharge } from '../game/audio';

// ── shared bits ────────────────────────────────────────────────────────
function BallMark({ size = 42, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 48 48">
      <circle cx="24" cy="24" r="21" fill="#f4fff0" stroke="#123324" strokeWidth="2.5" />
      <path d="M24 17.5l5.6 4.1-2.1 6.6h-7l-2.1-6.6z" fill="#123324" />
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2 + Math.PI / 5;
        return <circle key={i} cx={24 + Math.cos(a) * 13.5} cy={24 + Math.sin(a) * 13.5} r="3.4" fill="#123324" />;
      })}
    </svg>
  );
}

function Ticker({ text }: { text: string }) {
  return (
    <div className="w-full overflow-hidden bg-[#02100a] border-y-2 border-[#123a27] py-1.5">
      <div className="ticker-track flex whitespace-nowrap font-body font-bold tracking-[0.28em] text-[12px] text-[#ffb400]">
        <span className="pr-8">{text}</span>
        <span className="pr-8" aria-hidden>{text}</span>
      </div>
    </div>
  );
}

export const FormationDots = ({ rows, color, dark }: { rows: [number, number, number]; color: string; dark: string }) => {
  const offs: Record<number, number[]> = { 1: [0], 2: [-24, 24], 3: [-36, 0, 36] };
  const pts: { x: number; y: number }[] = [];
  rows.forEach((count, r) => {
    const y = 118 - r * 38;
    for (const o of offs[count] ?? [0]) pts.push({ x: 50 + o, y });
  });
  return (
    <svg viewBox="0 0 100 140" className="w-full h-auto">
      <rect x="4" y="4" width="92" height="132" fill="#0a4d26" stroke="#2b6b48" strokeWidth="2" />
      <line x1="4" y1="70" x2="96" y2="70" stroke="#2b6b48" strokeWidth="1.5" />
      <circle cx="50" cy="70" r="13" fill="none" stroke="#2b6b48" strokeWidth="1.5" />
      <rect x="28" y="4" width="44" height="12" fill="none" stroke="#2b6b48" strokeWidth="1.5" />
      <rect x="28" y="124" width="44" height="12" fill="none" stroke="#2b6b48" strokeWidth="1.5" />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="8" fill={color} stroke={dark} strokeWidth="2.5" />
      ))}
    </svg>
  );
};

const PitchPreview = ({ settings }: { settings: Settings }) => {
  const f1 = formationById(settings.f1);
  const f2 = formationById(settings.f2);
  const s1 = formationSlots(f1.rows, 0);
  const s2 = formationSlots(f2.rows, 1);
  const { x0, x1, y0, y1 } = PITCH;
  const dot = (p: { x: number; y: number }, i: number, t: 0 | 1) => (
    <g key={`${t}-${i}`} style={{ transform: `translate(${p.x}px, ${p.y}px)`, transition: 'transform 320ms cubic-bezier(.2,1.4,.4,1)' }}>
      <circle r="20" fill={TEAM[t].color} stroke="#04150d" strokeWidth="5" />
      <circle r="8" cx="-4" cy="-4" fill={TEAM[t].light} />
    </g>
  );
  return (
    <svg viewBox="0 0 700 980" className="w-full h-auto border-2 border-[#1c5c40] bg-[#06231a] shadow-[6px_6px_0_rgba(0,0,0,0.5)]">
      <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="#0a5f2c" />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={x0} y={y0 + i * ((y1 - y0) / 8) * 2} width={x1 - x0} height={(y1 - y0) / 8} fill="#0b6a31" />
      ))}
      <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="none" stroke="#eaffdf" strokeWidth="5" />
      <line x1={x0} y1={MID_Y} x2={x1} y2={MID_Y} stroke="#eaffdf" strokeWidth="5" />
      <circle cx={CX} cy={MID_Y} r="70" fill="none" stroke="#eaffdf" strokeWidth="5" />
      <rect x={CX - 130} y={y0} width="260" height="100" fill="none" stroke="#eaffdf" strokeWidth="4" opacity="0.7" />
      <rect x={CX - 130} y={y1 - 100} width="260" height="100" fill="none" stroke="#eaffdf" strokeWidth="4" opacity="0.7" />
      <rect x={CX - GOAL_W / 2} y={y0 - GOAL_D} width={GOAL_W} height={GOAL_D} fill="#02100a" stroke="#f4fff0" strokeWidth="5" />
      <rect x={CX - GOAL_W / 2} y={y1} width={GOAL_W} height={GOAL_D} fill="#02100a" stroke="#f4fff0" strokeWidth="5" />
      <circle cx={CX} cy={MID_Y} r="12" fill="#f4fff0" stroke="#1c2b20" strokeWidth="2" />
      {s2.map((p, i) => dot(p, i, 1))}
      {s1.map((p, i) => dot(p, i, 0))}
    </svg>
  );
};

// Canvas-rendered emblem tile — exact same paint code as the match itself.
export function SkinTile({
  id, team, selected, onClick,
}: {
  id: string; team: 0 | 1; selected: boolean; onClick: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = 42;
    c.width = size * dpr;
    c.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(size / 2, size / 2);
    paintStick(ctx, id, TEAM[team], size / 2 - 2);
    ctx.restore();
  }, [id, team]);
  const skin = skinById(id);
  const t = TEAM[team];
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-0.5 border-2 px-1 pb-1 pt-1 transition-all duration-150 ${
        selected ? 'bg-[#0a3524] -translate-y-0.5' : 'border-[#1c5c40] bg-[#04150d] opacity-75 hover:opacity-100 hover:border-[#5f8f77]'
      }`}
      style={selected ? { borderColor: t.color, boxShadow: `0 0 12px ${t.glow}` } : undefined}
      title={skin.name}
    >
      <canvas ref={ref} style={{ width: 42, height: 42 }} />
      <span
        className="font-body text-[8px] font-bold tracking-wider leading-none truncate max-w-full"
        style={{ color: selected ? t.color : '#5f8f77' }}
      >
        {skin.name}
      </span>
    </button>
  );
}

const SkinPicker = ({ team, value, onChange }: { team: 0 | 1; value: string; onChange: (id: string) => void }) => (
  <div className="flex gap-3">
    {(['club', 'flag'] as const).map((kind) => (
      <div key={kind} className="flex-1 min-w-0">
        <div className="font-body text-[9px] font-bold tracking-[0.22em] text-[#5f8f77] mb-1.5">
          {kind === 'club' ? 'CLUB CRESTS' : 'NATION FLAGS'}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {SKINS.filter((s) => s.kind === kind).map((s) => (
            <SkinTile key={s.id} id={s.id} team={team} selected={value === s.id} onClick={() => onChange(s.id)} />
          ))}
        </div>
      </div>
    ))}
  </div>
);

// ── TITLE ──────────────────────────────────────────────────────────────
const EqBars = ({ color = '#ffc400' }: { color?: string }) => (
  <span className="inline-flex items-end gap-[3px] h-4" aria-hidden>
    {[0, 1, 2, 3].map((i) => (
      <span key={i} className="eq-bar w-[4px]" style={{ height: '100%', background: color, animationDelay: `${i * 0.13}s` }} />
    ))}
  </span>
);

export function TitleScreen({
  onStart,
  onNet,
  chargeId,
  onCharge,
}: {
  onStart: () => void;
  onNet: () => void;
  chargeId: string;
  onCharge: (id: string) => void;
}) {
  const [panel, setPanel] = useState<'none' | 'how' | 'sound'>('none');
  const equip = (id: string) => {
    previewCharge(id, true);
    onCharge(id);
  };
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[#04150d]">
      <div className="title-stripes absolute inset-0 opacity-[0.35]" />
      <div className="absolute -top-32 -left-32 w-[560px] h-[560px] rounded-full bg-[radial-gradient(circle,rgba(255,244,200,0.14),transparent_65%)]" />
      <div className="absolute -bottom-40 -right-32 w-[620px] h-[620px] rounded-full bg-[radial-gradient(circle,rgba(0,224,255,0.10),transparent_65%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_35%,rgba(0,0,0,0.55)_100%)]" />

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-8 gap-7">
        <div className="flex items-center gap-4 -rotate-2">
          <BallMark size={54} className="ball-bounce hidden sm:block" />
          <div className="text-center">
            <h1 className="font-display leading-[0.9] select-none">
              <span className="block text-6xl sm:text-8xl text-[#ffc400] drop-shadow-[5px_5px_0_rgba(0,224,255,0.55)]">TURF</span>
              <span className="block text-6xl sm:text-8xl text-[#00e0ff] drop-shadow-[5px_5px_0_rgba(255,196,0,0.5)]">CLASH</span>
            </h1>
          </div>
          <BallMark size={54} className="ball-bounce2 hidden sm:block" />
        </div>
        <div className="skew-x-[-8deg] border-2 border-[#ff8a1c] bg-[#04150d] px-5 py-1.5 shadow-[4px_4px_0_rgba(0,0,0,0.6)]">
          <span className="inline-block skew-x-[8deg] font-body font-bold tracking-[0.34em] text-[12px] sm:text-sm text-[#ff8a1c]">
            STICK SOCCER SHOWDOWN
          </span>
        </div>

        {panel === 'none' && (
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <button className="btn btn-gold text-lg px-10 py-3.5" onClick={onStart}>
              KICK OFF
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="ml-2 inline-block -mt-0.5">
                <path d="M6 4l14 8-14 8z" />
              </svg>
            </button>
            <button className="btn btn-line text-lg px-8 py-3.5" onClick={() => setPanel('how')}>
              HOW TO PLAY
            </button>
            <button className="btn btn-line text-lg px-8 py-3.5" onClick={() => setPanel('sound')}>
              <EqBars color="#00e0ff" />
              <span className="ml-2.5">SOUND LAB</span>
            </button>
            <button className="btn btn-net text-lg px-8 py-3.5" onClick={onNet}>
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" className="mr-2.5">
                <rect x="2" y="5" width="7.5" height="14" rx="1.5" />
                <rect x="14.5" y="5" width="7.5" height="14" rx="1.5" />
                <path d="M9.5 10.5h5M9.5 13.5h5" />
              </svg>
              NET DUEL · 2 PHONES
            </button>
          </div>
        )}

        {panel === 'how' && (
          <div className="max-w-2xl w-full bg-[rgba(6,37,26,0.92)] border-2 border-[#1c5c40] p-5 sm:p-6 shadow-[8px_8px_0_rgba(0,0,0,0.5)]">
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-4">
              {[
                { n: '01', t: 'PICK A STICK', d: 'Each coach fields 5 sticks. Click one of your glowing mallets — or press 1–5.' },
                { n: '02', t: 'PULL BACK', d: 'Stretch back like a slingshot — your charge sound builds with the power and the arrow shows your line.' },
                { n: '03', t: 'RELEASE TO STRIKE', d: 'The string twangs, your stick rockets out and smacks the ball. One strike per turn.' },
                { n: '04', t: 'FIRST TO 3 — OR THEY BAIL', d: `Set a formation, pick an emblem, outsmart the rival. Miss ${MISS_LIMIT} turns in a row and you forfeit the match.` },
              ].map((s) => (
                <div key={s.n} className="flex gap-3">
                  <div className="font-display text-2xl text-[#ff8a1c] leading-none pt-0.5">{s.n}</div>
                  <div>
                    <div className="font-display text-sm text-[#ffc400] tracking-wide">{s.t}</div>
                    <div className="font-body text-[13px] font-medium text-[#9dc4ae] leading-snug mt-0.5">{s.d}</div>
                  </div>
                </div>
              ))}
            </div>
            <button className="btn btn-line mt-5 px-6 py-2" onClick={() => setPanel('none')}>
              BACK
            </button>
          </div>
        )}

        {panel === 'sound' && (
          <div className="max-w-2xl w-full bg-[rgba(6,37,26,0.92)] border-2 border-[#1c5c40] p-5 sm:p-6 shadow-[8px_8px_0_rgba(0,0,0,0.5)]">
            <div className="flex items-center justify-between gap-3 mb-1">
              <div className="font-display text-xl sm:text-2xl text-[#ffc400] flex items-center gap-3">
                STRETCH SOUND LAB
                <EqBars />
              </div>
              <button className="btn btn-line px-5 py-1.5 text-xs" onClick={() => setPanel('none')}>
                BACK
              </button>
            </div>
            <p className="font-body text-[13px] font-medium text-[#9dc4ae] mb-4 leading-snug">
              This plays while you pull a strike back. Hit <span className="text-[#eaffdf] font-bold">TRY</span> to audition each one —
              then <span className="text-[#ffc400] font-bold">EQUIP</span> your favourite. The choice is saved for future matches.
            </p>
            <div className="flex flex-col gap-2">
              {CHARGE_SOUNDS.map((s, i) => {
                const equipped = s.id === chargeId;
                return (
                  <div
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => equip(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        equip(s.id);
                      }
                    }}
                    className={`flex items-center gap-3 border-2 px-3.5 py-2.5 cursor-pointer transition-all duration-150 text-left ${
                      equipped
                        ? 'bg-[#0a3524] border-[#ffc400] shadow-[0_0_16px_rgba(255,196,0,0.25)]'
                        : 'border-[#1c5c40] bg-[#04150d] hover:border-[#5f8f77] hover:translate-x-1'
                    }`}
                  >
                    <div className="font-display text-lg text-[#ff8a1c] w-7 shrink-0">{String(i + 1).padStart(2, '0')}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-display text-sm tracking-wide flex items-center gap-2" style={{ color: equipped ? '#ffc400' : '#eaffdf' }}>
                        {s.name}
                        {equipped && (
                          <span className="font-body text-[9px] font-bold tracking-[0.2em] bg-[#ffc400] text-[#1a1200] px-1.5 py-0.5 -skew-x-6">
                            EQUIPPED
                          </span>
                        )}
                      </div>
                      <div className="font-body text-[12px] font-medium text-[#9dc4ae] leading-snug">{s.desc}</div>
                    </div>
                    <button
                      className="btn btn-line px-4 py-1.5 text-xs shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        previewCharge(s.id, false);
                      }}
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" className="mr-1.5">
                        <path d="M6 4l14 8-14 8z" />
                      </svg>
                      TRY
                    </button>
                    {!equipped && (
                      <button
                        className="btn btn-gold px-4 py-1.5 text-xs shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          equip(s.id);
                        }}
                      >
                        EQUIP
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <p className="font-body text-[11px] font-bold tracking-[0.3em] text-[#5f8f77] uppercase">
          Local 2-player • one device • pass &amp; play
        </p>
      </div>

      <div className="relative z-10">
        <Ticker text={`FIRST TO ${TARGET_SCORE} GOALS WINS ★ PICK YOUR FORMATION ★ CHOOSE YOUR EMBLEM ★ SLINGSHOT STRIKES ★ MISS ${MISS_LIMIT} TURNS = FORFEIT ★ GOLD VS CYAN ★ `} />
      </div>
    </div>
  );
}

// ── SETUP ──────────────────────────────────────────────────────────────
export function SetupScreen({
  settings,
  onChange,
  onBack,
  onLaunch,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  onBack: () => void;
  onLaunch: () => void;
}) {
  const teamCard = (team: 0 | 1) => {
    const t = TEAM[team];
    const name = team === 0 ? settings.p1Name : settings.p2Name;
    const fid = team === 0 ? settings.f1 : settings.f2;
    const skin = team === 0 ? settings.skin1 : settings.skin2;
    const setSkin = (id: string) => onChange(team === 0 ? { ...settings, skin1: id } : { ...settings, skin2: id });
    return (
      <div
        className="bg-[#06251a] border-2 p-4 sm:p-5 shadow-[6px_6px_0_rgba(0,0,0,0.5)]"
        style={{ borderColor: t.color }}
      >
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="skew-x-[-8deg] px-3 py-1 font-display text-sm" style={{ background: t.color, color: '#04150d' }}>
            <span className="inline-block skew-x-[8deg]">{team === 0 ? 'HOME • BOTTOM' : 'AWAY • TOP'}</span>
          </div>
          <div className="w-3.5 h-3.5 rounded-full" style={{ background: t.color, boxShadow: `0 0 12px ${t.glow}` }} />
        </div>
        <label className="block font-body text-[10px] font-bold tracking-[0.25em] text-[#5f8f77] mb-1">COACH NAME</label>
        <input
          value={name}
          maxLength={12}
          onChange={(e) =>
            onChange(team === 0 ? { ...settings, p1Name: e.target.value.toUpperCase() } : { ...settings, p2Name: e.target.value.toUpperCase() })
          }
          className="w-full mb-4 bg-[#04150d] border-2 border-[#1c5c40] px-3 py-2 font-display text-sm tracking-wider text-[#eaffdf] outline-none focus:border-[#ff8a1c] transition-colors"
        />
        <label className="block font-body text-[10px] font-bold tracking-[0.25em] text-[#5f8f77] mb-2">FORMATION — 5 STICKS</label>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {FORMATIONS.map((f) => {
            const sel = f.id === fid;
            return (
              <button
                key={f.id}
                onClick={() => onChange(team === 0 ? { ...settings, f1: f.id } : { ...settings, f2: f.id })}
                className={`border-2 p-1.5 transition-all duration-150 text-left ${
                  sel ? 'bg-[#0a3524] -translate-y-0.5' : 'border-[#1c5c40] bg-[#04150d] hover:border-[#5f8f77] opacity-80 hover:opacity-100'
                }`}
                style={sel ? { borderColor: t.color, boxShadow: `0 0 14px ${t.glow}` } : undefined}
              >
                <FormationDots rows={f.rows} color={sel ? t.color : '#3f6f56'} dark={sel ? t.dark : '#04150d'} />
                <div className="mt-1 font-display text-[13px] leading-none" style={{ color: sel ? t.color : '#9dc4ae' }}>
                  {f.name}
                </div>
                <div className="font-body text-[9px] font-bold tracking-[0.14em] text-[#5f8f77]">{f.tag}</div>
              </button>
            );
          })}
        </div>
        <label className="block font-body text-[10px] font-bold tracking-[0.25em] text-[#5f8f77] mb-2">STICK EMBLEM</label>
        <SkinPicker team={team} value={skin} onChange={setSkin} />
      </div>
    );
  };

  return (
    <div className="relative h-full overflow-y-auto bg-[#04150d]">
      <div className="title-stripes absolute inset-0 opacity-[0.22] pointer-events-none" />
      <div className="relative z-10 max-w-6xl mx-auto px-4 py-6 sm:py-8">
        <div className="flex items-center justify-between mb-6">
          <button className="btn btn-line px-5 py-2" onClick={onBack}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="inline-block mr-2 -mt-0.5">
              <path d="M18 4L4 12l14 8z" />
            </svg>
            BACK
          </button>
          <h2 className="font-display text-2xl sm:text-4xl text-[#eaffdf] drop-shadow-[3px_3px_0_rgba(255,196,0,0.4)]">MATCH SETUP</h2>
          <div className="w-[86px] hidden sm:block" />
        </div>

        <div className="grid lg:grid-cols-[1fr_300px_1fr] gap-5 items-start">
          {teamCard(0)}
          <div className="order-first lg:order-none">
            <div className="font-body text-[10px] font-bold tracking-[0.25em] text-[#5f8f77] text-center mb-2">LIVE PITCH PREVIEW</div>
            <PitchPreview settings={settings} />
          </div>
          {teamCard(1)}
        </div>

        <div className="mt-7 flex flex-col items-center gap-3 pb-4">
          <button className="btn btn-gold text-xl px-14 py-4" onClick={onLaunch}>
            KICK OFF
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" className="ml-2 inline-block -mt-1">
              <path d="M6 4l14 8-14 8z" />
            </svg>
          </button>
          <div className="font-body text-[11px] font-semibold tracking-[0.2em] text-[#5f8f77] uppercase text-center">
            First to {TARGET_SCORE} goals • miss {MISS_LIMIT} turns in a row = forfeit • sticks stay where they slide
          </div>
        </div>
      </div>
    </div>
  );
}

// ── PAUSE ──────────────────────────────────────────────────────────────
export function PauseOverlay({
  onResume,
  onSetup,
  onTitle,
}: {
  onResume: () => void;
  onSetup: () => void;
  onTitle: () => void;
}) {
  return (
    <div className="absolute inset-0 z-40 bg-[rgba(2,12,7,0.86)] backdrop-blur-[3px] flex items-center justify-center p-4">
      <div className="bg-[#06251a] border-2 border-[#1c5c40] shadow-[10px_10px_0_rgba(0,0,0,0.55)] px-8 py-8 max-w-md w-full text-center">
        <div className="font-display text-4xl text-[#ffc400] drop-shadow-[3px_3px_0_rgba(0,0,0,0.7)] mb-1">PAUSED</div>
        <div className="font-body text-[11px] font-bold tracking-[0.3em] text-[#5f8f77] mb-6">THE REF HAS STOPPED PLAY</div>
        <div className="font-body text-[13px] font-semibold text-[#9dc4ae] text-left bg-[#04150d] border border-[#123a27] p-4 mb-6 leading-relaxed">
          Drag your glowing stick back like a bow, aim the arrow, release to strike. One strike per turn — the shot clock is 20
          seconds. Knock the ball into the enemy net. First to {TARGET_SCORE} wins; miss {MISS_LIMIT} turns in a row and you
          forfeit the match.
        </div>
        <div className="flex flex-col gap-3">
          <button className="btn btn-gold px-6 py-3" onClick={onResume}>RESUME MATCH</button>
          <div className="flex gap-3">
            <button className="btn btn-line flex-1 px-4 py-2.5 text-sm" onClick={onSetup}>NEW FORMATIONS</button>
            <button className="btn btn-line flex-1 px-4 py-2.5 text-sm" onClick={onTitle}>QUIT TO TITLE</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── FULL TIME ──────────────────────────────────────────────────────────
export function GameOverScreen({
  stats,
  settings,
  onRematch,
  onSetup,
  onTitle,
  net = false,
  onLobby,
}: {
  stats: GameStats;
  settings: Settings;
  onRematch: () => void;
  onSetup: () => void;
  onTitle: () => void;
  net?: boolean;
  onLobby?: () => void;
}) {
  const w = stats.winner;
  const t = TEAM[w];
  const name = w === 0 ? settings.p1Name : settings.p2Name;
  const loser = w === 0 ? settings.p2Name : settings.p1Name;
  const isForfeit = stats.reason === 'forfeit';
  const conv = (g: number, s: number) => (s > 0 ? `${Math.round((g / s) * 100)}%` : '—');
  const row = (label: string, a: string, b: string) => (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-2 border-b border-[#123a27] last:border-0">
      <div className="font-display text-lg text-right" style={{ color: TEAM[0].color }}>{a}</div>
      <div className="font-body text-[10px] font-bold tracking-[0.25em] text-[#5f8f77] text-center min-w-[110px]">{label}</div>
      <div className="font-display text-lg" style={{ color: TEAM[1].color }}>{b}</div>
    </div>
  );
  return (
    <div className="absolute inset-0 z-40 bg-[rgba(2,12,7,0.82)] backdrop-blur-[2px] flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#06251a] border-4 px-6 sm:px-10 py-7 max-w-lg w-full text-center shadow-[12px_12px_0_rgba(0,0,0,0.55)]" style={{ borderColor: t.color }}>
        <div className="font-body text-[11px] font-bold tracking-[0.4em] text-[#5f8f77] mb-1">FULL TIME</div>
        <div className="font-display text-3xl sm:text-5xl leading-tight mb-1" style={{ color: t.color, textShadow: `0 0 24px ${t.glow}, 3px 3px 0 rgba(0,0,0,0.8)` }}>
          {name} WINS
        </div>
        {isForfeit && (
          <div className="mb-1">
            <span className="inline-block skew-x-[-8deg] border-2 border-[#ff4d1c] bg-[rgba(255,77,28,0.12)] px-4 py-1">
              <span className="inline-block skew-x-[8deg] font-body font-bold tracking-[0.22em] text-[11px] text-[#ff8a6a]">
                BY FORFEIT — {loser} MISSED {MISS_LIMIT} TURNS
              </span>
            </span>
          </div>
        )}
        <div className="font-display text-5xl text-[#eaffdf] my-2 tabular-nums drop-shadow-[3px_3px_0_rgba(0,0,0,0.7)]">
          {stats.s1} <span className="text-[#5f8f77] text-3xl">—</span> {stats.s2}
        </div>
        <div className="bg-[#04150d] border border-[#123a27] px-4 py-1 mb-6">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-1.5 font-body text-[10px] font-bold tracking-[0.2em] text-[#9dc4ae]">
            <div className="text-right">{settings.p1Name}</div>
            <div className="text-[#5f8f77] min-w-[110px] text-center">MATCH STATS</div>
            <div className="text-left">{settings.p2Name}</div>
          </div>
          {row('GOALS', String(stats.goals[0]), String(stats.goals[1]))}
          {row('STRIKES', String(stats.shots[0]), String(stats.shots[1]))}
          {row('CONVERSION', conv(stats.goals[0], stats.shots[0]), conv(stats.goals[1], stats.shots[1]))}
          {row('HARDEST STRIKE', `${stats.hardest[0]} KM/H`, `${stats.hardest[1]} KM/H`)}
        </div>
        <div className="flex flex-col gap-3">
          {net ? (
            <>
              <button className="btn btn-gold px-6 py-3 text-lg" onClick={onLobby}>
                BACK TO LOBBY — REMATCH
              </button>
              <button className="btn btn-line px-4 py-2.5 text-sm" onClick={onTitle}>
                LEAVE DUEL · TITLE SCREEN
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-gold px-6 py-3 text-lg" onClick={onRematch}>REMATCH</button>
              <div className="flex gap-3">
                <button className="btn btn-line flex-1 px-4 py-2.5 text-sm" onClick={onSetup}>CHANGE FORMATIONS</button>
                <button className="btn btn-line flex-1 px-4 py-2.5 text-sm" onClick={onTitle}>TITLE SCREEN</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
