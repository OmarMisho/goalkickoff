import type { HudState, Settings } from '../game/defs';
import { TEAM, TARGET_SCORE, MISS_LIMIT, formationById } from '../game/defs';

const statusText = (h: HudState, s: Settings): { text: string; color: string } => {
  if (h.phase === 'over') return { text: 'FULL TIME', color: '#eaffdf' };
  if (h.phase === 'goal') return { text: 'GOAL!', color: TEAM[h.turn === 0 ? 0 : 1].color };
  if (h.phase === 'kickoff') return { text: 'KICK OFF', color: '#eaffdf' };
  if (h.phase === 'sim') return { text: 'BALL LIVE', color: '#ff8a1c' };
  return {
    text: `${(h.turn === 0 ? s.p1Name : s.p2Name)} TO STRIKE`,
    color: TEAM[h.turn].color,
  };
};

export function Scoreboard({ hud, settings }: { hud: HudState; settings: Settings }) {
  const st = statusText(hud, settings);
  const urgent = hud.phase === 'aim' && hud.clock <= 5;
  const plate = (team: 0 | 1) => {
    const t = TEAM[team];
    const name = team === 0 ? settings.p1Name : settings.p2Name;
    const score = team === 0 ? hud.s1 : hud.s2;
    const fm = formationById(team === 0 ? settings.f1 : settings.f2);
    const active = hud.turn === team && (hud.phase === 'aim' || hud.phase === 'kickoff');
    return (
      <div
        className={`flex items-center gap-3 px-4 py-1.5 bg-[#06251a] border-2 transition-all duration-200 ${
          team === 0 ? 'skew-x-[-8deg] border-l-[6px]' : 'skew-x-[8deg] border-r-[6px]'
        }`}
        style={{
          borderColor: active ? t.color : '#1c5c40',
          borderLeftColor: team === 0 ? t.color : undefined,
          borderRightColor: team === 1 ? t.color : undefined,
          boxShadow: active ? `0 0 22px ${t.glow}` : '4px 4px 0 rgba(0,0,0,0.5)',
        }}
      >
        <div className="skew-x-[8deg] flex flex-col items-start min-w-[92px]" style={team === 1 ? { transform: 'skewX(-8deg)' } : undefined}>
          <div className="font-body font-bold text-[11px] tracking-[0.18em] leading-tight max-w-[120px] truncate" style={{ color: t.light }}>
            {name}
          </div>
          <div className="font-body text-[10px] font-semibold tracking-widest text-[#5f8f77]">{fm.name} • {fm.tag}</div>
          {(team === 0 ? hud.m1 : hud.m2) > 0 && (
            <div className="flex items-center gap-1 mt-0.5">
              {Array.from({ length: MISS_LIMIT }).map((_, i) => {
                const hit = (team === 0 ? hud.m1 : hud.m2) > i;
                return (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 rounded-full"
                    style={{
                      background: hit ? '#ff4d1c' : 'rgba(255,255,255,0.14)',
                      boxShadow: hit ? '0 0 6px rgba(255,77,28,0.9)' : 'none',
                    }}
                  />
                );
              })}
              <span className="font-body text-[8px] font-bold tracking-widest text-[#ff8a6a]">
                MISS {team === 0 ? hud.m1 : hud.m2}/{MISS_LIMIT}
              </span>
            </div>
          )}
        </div>
        <div
          className="font-display text-4xl leading-none tabular-nums"
          style={{ color: active ? t.color : '#eaffdf', textShadow: active ? `0 0 14px ${t.glow}` : '2px 2px 0 rgba(0,0,0,0.6)' }}
        >
          {score}
        </div>
      </div>
    );
  };
  return (
    <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 flex items-stretch gap-2 z-20">
      {plate(0)}
      <div className="skew-x-[-8deg] flex flex-col items-center justify-center px-4 bg-[#04150d] border-2 border-[#1c5c40] shadow-[4px_4px_0_rgba(0,0,0,0.5)]">
        <div className="font-body text-[9px] font-bold tracking-[0.3em] text-[#5f8f77]">FIRST TO {TARGET_SCORE}</div>
        <div
          className={`font-display text-2xl leading-none tabular-nums ${urgent ? 'animate-pulse' : ''}`}
          style={{ color: urgent ? '#ff4d1c' : '#eaffdf' }}
        >
          {hud.phase === 'aim' ? hud.clock : '—'}
        </div>
        <div className="font-body text-[10px] font-bold tracking-[0.14em] whitespace-nowrap" style={{ color: st.color }}>
          {st.text}
        </div>
      </div>
      {plate(1)}
    </div>
  );
}

export function BannerView({ banner }: { banner: { id: number; text: string; sub?: string; color: string } | null }) {
  if (!banner) return null;
  return (
    <div key={banner.id} className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
      <div className="banner-anim text-center">
        <div
          className="font-display text-4xl sm:text-6xl md:text-7xl px-6 py-3 bg-[rgba(3,17,10,0.82)] border-y-4 -skew-x-6"
          style={{
            color: banner.color,
            borderColor: banner.color,
            textShadow: '0 0 26px currentColor, 3px 3px 0 rgba(0,0,0,0.8)',
          }}
        >
          {banner.text}
        </div>
        {banner.sub && (
          <div className="mt-2 font-body font-bold tracking-[0.3em] text-[12px] text-[#cfe9d8] uppercase">{banner.sub}</div>
        )}
      </div>
    </div>
  );
}

export function LatencyPill({ ms }: { ms: number | null }) {
  if (ms === null) return null;
  const col = ms < 100 ? '#7dffa8' : ms < 220 ? '#ffc400' : '#ff4d1c';
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 z-20">
      <span className="font-body text-[10px] font-bold tracking-[0.25em] px-3 py-1 border bg-[rgba(4,21,13,0.8)]" style={{ color: col, borderColor: col }}>
        LINK {ms}ms
      </span>
    </div>
  );
}

export function TopButtons({
  muted,
  onMute,
  onPause,
  showPause = true,
}: {
  muted: boolean;
  onMute: () => void;
  onPause: () => void;
  showPause?: boolean;
}) {
  const cls =
    'pointer-events-auto w-10 h-10 grid place-items-center bg-[#06251a] border-2 border-[#1c5c40] text-[#cfe9d8] hover:border-[#ffc400] hover:text-[#ffc400] active:translate-y-[2px] transition-colors shadow-[3px_3px_0_rgba(0,0,0,0.5)]';
  return (
    <div className="absolute top-3 right-3 flex gap-2 z-20">
      <button className={cls} onClick={onMute} aria-label="Toggle sound">
        {muted ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" stroke="none" />
            <line x1="16" y1="9" x2="22" y2="15" />
            <line x1="22" y1="9" x2="16" y2="15" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" stroke="none" />
            <path d="M15.5 8.5a5 5 0 0 1 0 7" />
            <path d="M18.5 5.5a9.5 9.5 0 0 1 0 13" />
          </svg>
        )}
      </button>
      <button className={cls} onClick={onPause} aria-label="Pause">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <rect x="5" y="4" width="5" height="16" />
          <rect x="14" y="4" width="5" height="16" />
        </svg>
      </button>
    </div>
  );
}

export function ControlsHint({ turn }: { turn: 0 | 1 }) {
  const t = TEAM[turn];
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-20 hidden sm:block">
      <div className="bg-[rgba(4,21,13,0.85)] border-2 border-[#1c5c40] px-4 py-3 skew-x-[-6deg] shadow-[4px_4px_0_rgba(0,0,0,0.5)]">
        <div className="skew-x-[6deg] space-y-1.5">
          <div className="font-display text-[11px] tracking-wide" style={{ color: t.color }}>
            YOUR STICKS GLOW — ONE STRIKE PER TURN
          </div>
          <div className="font-body text-[11px] font-semibold text-[#9dc4ae] leading-snug">
            <span className="text-[#eaffdf]">DRAG</span> your stick back like a slingshot → aim the arrow → release
            <br />
            <span className="text-[#eaffdf]">1–5</span> pick stick &nbsp;•&nbsp; <span className="text-[#eaffdf]">ESC</span> cancel &nbsp;•&nbsp;
            <span className="text-[#eaffdf]">P</span> pause
          </div>
        </div>
      </div>
    </div>
  );
}

export function SideTag({ turn, name }: { turn: 0 | 1; name: string }) {
  const t = TEAM[turn];
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-20">
      <div
        className="px-4 py-2 skew-x-[-8deg] border-2 font-display text-sm tracking-wide"
        style={{ color: '#04150d', background: t.color, borderColor: '#04150d', boxShadow: `4px 4px 0 rgba(0,0,0,0.55), 0 0 18px ${t.glow}` }}
      >
        <span className="inline-block skew-x-[8deg]">{name} STRIKES</span>
      </div>
    </div>
  );
}
