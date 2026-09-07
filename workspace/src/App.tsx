import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameStats, HudState, Settings } from './game/defs';
import { CHARGE_SOUND_KEY } from './game/defs';
import { Engine } from './game/engine';
import type { EngineMode } from './game/engine';
import { initAudio, setMuted as setAudioMuted, setChargeSound, isChargeId, sfx } from './game/audio';
import type { NetBridge, NetMsg } from './net/netplay';
import { Scoreboard, BannerView, TopButtons, ControlsHint, SideTag, LatencyPill } from './ui/hud';
import { TitleScreen, SetupScreen, PauseOverlay, GameOverScreen } from './ui/screens';
import { NetLobby } from './ui/netlobby';

type ScreenId = 'title' | 'setup' | 'net' | 'game';

function GameView({
  settings,
  onSetup,
  onTitle,
  onRematch,
  onNetLobby,
  mode = 'hotseat',
  bridge,
}: {
  settings: Settings;
  onSetup: () => void;
  onTitle: () => void;
  onRematch: () => void;
  onNetLobby?: () => void;
  mode?: EngineMode;
  bridge?: NetBridge;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engRef = useRef<Engine | null>(null);
  const bannerId = useRef(1);
  const skipByeRef = useRef(false);
  const [hud, setHud] = useState<HudState>({ s1: 0, s2: 0, turn: 0, phase: 'kickoff', clock: 20, m1: 0, m2: 0 });
  const [banner, setBanner] = useState<{ id: number; text: string; sub?: string; color: string } | null>(null);
  const [over, setOver] = useState<GameStats | null>(null);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [peerGone, setPeerGone] = useState(false);
  const [rtt, setRtt] = useState<number | null>(null);
  const netMode = mode !== 'hotseat';

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const eng = new Engine(
      cv,
      settings,
      {
        onHud: (h) => setHud(h),
        onBanner: (text, color, sub) => {
          setBanner({ id: bannerId.current++, text, color, sub });
          if (mode === 'host') bridge?.send({ k: 'banner', text, color, sub: sub ?? null });
        },
        onGameOver: (s) => {
          setOver(s);
          if (mode === 'host') bridge?.send({ k: 'over', stats: s });
        },
      },
      {
        mode,
        onGuestStrike:
          mode === 'guest'
            ? (st) => bridge?.send({ k: 'strike', slot: st.slot, dx: st.dx, dy: st.dy, p: st.p })
            : undefined,
      }
    );
    engRef.current = eng;
    eng.start();

    // host streams authoritative snapshots at 20Hz
    let snapTimer: number | null = null;
    if (mode === 'host' && bridge) {
      snapTimer = window.setInterval(() => bridge.send({ k: 'snap', s: eng.getSnapshot() }), 50);
    }

    if (bridge) {
      bridge.onMsg((m: NetMsg) => {
        switch (m.k) {
          case 'strike':
            if (mode === 'host') eng.remoteStrike(m.slot, m.dx, m.dy, m.p);
            break;
          case 'snap':
            if (mode === 'guest') eng.applySnapshot(m.s);
            break;
          case 'banner':
            if (mode === 'guest') setBanner({ id: bannerId.current++, text: m.text, color: m.color, sub: m.sub ?? undefined });
            break;
          case 'over':
            if (mode === 'guest') setOver(m.stats);
            break;
          case 'lobby':
            skipByeRef.current = true;
            onNetLobby?.();
            break;
          case 'bye':
            setPeerGone(true);
            break;
          default:
            break;
        }
      });
      bridge.onPeerLeave(() => setPeerGone(true));
      bridge.onRtt(setRtt);
    }

    return () => {
      if (snapTimer !== null) window.clearInterval(snapTimer);
      if (bridge && !skipByeRef.current) bridge.send({ k: 'bye' });
      eng.destroy();
      engRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const togglePause = useCallback(() => {
    const eng = engRef.current;
    if (!eng || over || netMode) return;
    if (eng.getPaused()) {
      eng.resume();
      setPaused(false);
    } else {
      eng.pause();
      setPaused(true);
      sfx.click();
    }
  }, [over, netMode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'p' || e.key === 'P') togglePause();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePause]);

  const handleMute = () => {
    const next = !muted;
    setMuted(next);
    setAudioMuted(next);
    if (!next) sfx.click();
  };

  const turnName = hud.turn === 0 ? settings.p1Name : settings.p2Name;
  const ownTeam: 0 | 1 = mode === 'guest' ? 1 : 0;

  const goLobby = () => {
    bridge?.send({ k: 'lobby' });
    skipByeRef.current = true;
    sfx.click();
    onNetLobby?.();
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#04150d]">
      <div className="absolute inset-0">
        <canvas ref={canvasRef} className="block h-full w-full cursor-crosshair" />
      </div>
      <Scoreboard hud={hud} settings={settings} />
      <TopButtons muted={muted} onMute={handleMute} onPause={togglePause} showPause={!netMode} />
      {!over && !paused && <ControlsHint turn={netMode ? ownTeam : hud.turn} />}
      {!over && !paused && hud.phase === 'aim' && <SideTag turn={hud.turn} name={turnName} />}
      {netMode && <LatencyPill ms={rtt} />}
      <BannerView banner={banner} />
      {paused && !over && <PauseOverlay onResume={togglePause} onSetup={onSetup} onTitle={onTitle} />}
      {over && (
        <GameOverScreen
          stats={over}
          settings={settings}
          onRematch={onRematch}
          onSetup={onSetup}
          onTitle={onTitle}
          net={netMode}
          onLobby={goLobby}
        />
      )}
      {peerGone && !over && (
        <div className="absolute inset-0 z-40 bg-[rgba(2,12,7,0.88)] flex items-center justify-center p-4">
          <div className="bg-[#06251a] border-2 border-[#ff4d1c] px-8 py-7 text-center max-w-sm w-full shadow-[10px_10px_0_rgba(0,0,0,0.55)]">
            <div className="font-display text-3xl text-[#ff4d1c] mb-2">RIVAL DISCONNECTED</div>
            <div className="font-body text-[13px] font-semibold text-[#9dc4ae] mb-5">
              The other phone left the duel — the floodlights go dark.
            </div>
            <button className="btn btn-gold px-6 py-2.5" onClick={onTitle}>
              BACK TO TITLE
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState<ScreenId>('title');
  const [settings, setSettings] = useState<Settings>(() => {
    let saved = 'rubber';
    try {
      const v = localStorage.getItem(CHARGE_SOUND_KEY);
      if (v && isChargeId(v)) saved = v;
    } catch {
      /* storage unavailable */
    }
    return {
      p1Name: 'PLAYER 1',
      p2Name: 'PLAYER 2',
      f1: '221',
      f2: '122',
      skin1: 'crown',
      skin2: 'bolt',
      chargeSound: saved,
    };
  });
  const [netCtx, setNetCtx] = useState<{ bridge: NetBridge; isHost: boolean } | null>(null);
  const [matchKey, setMatchKey] = useState(0);

  useEffect(() => {
    setChargeSound(settings.chargeSound);
  }, [settings.chargeSound]);

  const leaveNet = () => {
    netCtx?.bridge.leave();
    setNetCtx(null);
  };

  return (
    <div className="h-dvh w-full overflow-hidden font-body text-[#eaffdf] antialiased">
      {screen === 'title' && (
        <TitleScreen
          chargeId={settings.chargeSound}
          onCharge={(id) => {
            setSettings((s) => ({ ...s, chargeSound: id }));
            try {
              localStorage.setItem(CHARGE_SOUND_KEY, id);
            } catch {
              /* storage unavailable */
            }
          }}
          onStart={() => {
            initAudio();
            sfx.click();
            setScreen('setup');
          }}
          onNet={() => {
            initAudio();
            sfx.click();
            setScreen('net');
          }}
        />
      )}
      {screen === 'setup' && (
        <SetupScreen
          settings={settings}
          onChange={setSettings}
          onBack={() => setScreen('title')}
          onLaunch={() => {
            initAudio();
            sfx.whistle(1);
            setSettings((s) => ({
              ...s,
              p1Name: s.p1Name.trim() || 'PLAYER 1',
              p2Name: s.p2Name.trim() || 'PLAYER 2',
            }));
            setMatchKey((k) => k + 1);
            setScreen('game');
          }}
        />
      )}
      {screen === 'net' && (
        <NetLobby
          initial={settings}
          existing={netCtx}
          onStart={(bridge, merged, isHost) => {
            setNetCtx({ bridge, isHost });
            // each phone keeps its own stretch sound
            setSettings((prev) => ({ ...merged, chargeSound: prev.chargeSound }));
            setMatchKey((k) => k + 1);
            setScreen('game');
          }}
          onExit={() => {
            leaveNet();
            setScreen('title');
          }}
        />
      )}
      {screen === 'game' && (
        <GameView
          key={matchKey}
          settings={settings}
          mode={netCtx ? (netCtx.isHost ? 'host' : 'guest') : 'hotseat'}
          bridge={netCtx?.bridge}
          onNetLobby={() => setScreen('net')}
          onSetup={() => setScreen('setup')}
          onTitle={() => {
            if (netCtx) leaveNet();
            setScreen('title');
          }}
          onRematch={() => {
            sfx.whistle(1);
            setMatchKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}
