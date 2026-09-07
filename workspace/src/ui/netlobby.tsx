import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../game/defs';
import { FORMATIONS, TEAM, formationById, TARGET_SCORE, MISS_LIMIT } from '../game/defs';
import { SKINS, skinById } from '../game/skins';
import { FormationDots, SkinTile } from './screens';
import { NetBridge, cleanCode, makeRoomCode, type NetMsg } from '../net/netplay';
import { initAudio, sfx } from '../game/audio';

type Stage = 'menu' | 'hosting' | 'joining' | 'lobby';
type PeerInfo = { name: string; f: string; skin: string; ready: boolean } | null;
type MyInfo = { name: string; f: string; skin: string };

const Spinner = ({ color = '#ffc400' }: { color?: string }) => (
  <svg className="spin-slow inline-block" width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ color }}>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
  </svg>
);

export function NetLobby({
  initial,
  existing,
  onStart,
  onExit,
}: {
  initial: Settings;
  existing: { bridge: NetBridge; isHost: boolean } | null;
  onStart: (bridge: NetBridge, settings: Settings, isHost: boolean) => void;
  onExit: () => void;
}) {
  const [stage, setStage] = useState<Stage>(existing ? 'lobby' : 'menu');
  const [isHost, setIsHost] = useState(existing?.isHost ?? true);
  const [code, setCode] = useState(existing?.bridge.code ?? '');
  const [joinInput, setJoinInput] = useState('');
  const [my, setMy] = useState<MyInfo>(() =>
    existing?.isHost
      ? { name: initial.p1Name, f: initial.f1, skin: initial.skin1 }
      : { name: initial.p2Name, f: initial.f2, skin: initial.skin2 }
  );
  const [myReady, setMyReady] = useState(false);
  const [peer, setPeer] = useState<PeerInfo>(null);
  const [rtt, setRtt] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [searching, setSearching] = useState(false);

  const bridgeRef = useRef<NetBridge | null>(existing?.bridge ?? null);
  const myRef = useRef(my);
  const myReadyRef = useRef(false);
  const peerRef = useRef<PeerInfo>(null);
  const isHostRef = useRef(isHost);
  const stageRef = useRef<Stage>(stage);
  const startedRef = useRef(false);
  const wiredRef = useRef(false);
  myRef.current = my;
  isHostRef.current = isHost;
  stageRef.current = stage;

  const updatePeer = (patch: Partial<NonNullable<PeerInfo>>) => {
    const next = { ...(peerRef.current ?? { name: 'RIVAL', f: '221', skin: 'bolt', ready: false }), ...patch };
    peerRef.current = next;
    setPeer(next);
  };

  const tryStart = () => {
    const b = bridgeRef.current;
    if (!b || !isHostRef.current || startedRef.current) return;
    if (!myReadyRef.current || !peerRef.current?.ready) return;
    const m = myRef.current;
    const p = peerRef.current;
    const merged: Settings = {
      p1Name: m.name.trim() || 'PLAYER 1',
      p2Name: p.name.trim() || 'PLAYER 2',
      f1: m.f,
      f2: p.f,
      skin1: m.skin,
      skin2: p.skin,
      chargeSound: initial.chargeSound,
    };
    startedRef.current = true;
    sfx.whistle(1);
    b.send({ k: 'start', s: merged });
    onStart(b, merged, true);
  };

  const sendMySet = (b: NetBridge) => {
    const m = myRef.current;
    b.send({ k: 'set', name: m.name.trim() || 'PLAYER', f: m.f, skin: m.skin });
  };

  const handleMsg = (m: NetMsg) => {
    switch (m.k) {
      case 'hello': // host learns guest identity
        updatePeer({ name: m.name });
        sendMySet(bridgeRef.current!);
        bridgeRef.current!.send({ k: 'ready', ready: myReadyRef.current });
        break;
      case 'welcome': // guest learns host identity
        updatePeer({ name: m.name });
        sendMySet(bridgeRef.current!);
        bridgeRef.current!.send({ k: 'ready', ready: myReadyRef.current });
        break;
      case 'set':
        updatePeer({ name: m.name, f: m.f, skin: m.skin });
        break;
      case 'ready':
        updatePeer({ ready: m.ready });
        window.setTimeout(tryStart, 30);
        break;
      case 'start':
        if (!isHostRef.current && !startedRef.current) {
          startedRef.current = true;
          onStart(bridgeRef.current!, m.s, false);
        }
        break;
      default:
        break;
    }
  };

  const wire = (b: NetBridge) => {
    b.onMsg(handleMsg);
    b.onRtt(setRtt);
    b.onPeerJoin(() => {
      sfx.select();
      setNotice('');
      setSearching(false);
      setStage('lobby');
      if (isHostRef.current) {
        b.send({ k: 'welcome', name: myRef.current.name.trim() || 'PLAYER 1' });
      } else {
        b.send({ k: 'hello', name: myRef.current.name.trim() || 'PLAYER 2' });
      }
      sendMySet(b);
      b.send({ k: 'ready', ready: myReadyRef.current });
    });
    b.onPeerLeave(() => {
      setRtt(null);
      if (startedRef.current) return; // GameView handles the in-match case
      peerRef.current = null;
      setPeer(null);
      if (isHostRef.current) {
        setStage('lobby');
        setNotice('Your rival left — waiting for a new challenger…');
      } else {
        setStage('menu');
        setNotice('Connection lost. The host closed the room.');
      }
    });
  };

  // wire once per bridge
  useEffect(() => {
    const b = bridgeRef.current;
    if (!b || wiredRef.current) return;
    wiredRef.current = true;
    wire(b);
    if (existing && b.connected()) {
      // rematch flow: resync settings + unready both sides
      setMyReady(false);
      myReadyRef.current = false;
      sendMySet(b);
      b.send({ k: 'ready', ready: false });
      b.send(isHost ? { k: 'welcome', name: myRef.current.name } : { k: 'hello', name: myRef.current.name });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // leave the bridge if the lobby is abandoned before a match starts
  useEffect(
    () => () => {
      if (!startedRef.current) bridgeRef.current?.leave();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // broadcast local settings edits while connected
  useEffect(() => {
    const b = bridgeRef.current;
    if (b && stage === 'lobby' && b.connected()) sendMySet(b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [my, stage]);

  const beginHost = () => {
    initAudio();
    sfx.click();
    const c = makeRoomCode();
    const b = NetBridge.host(c);
    bridgeRef.current = b;
    wiredRef.current = false;
    wire(b);
    setIsHost(true);
    setCode(c);
    setStage('hosting');
    setPeer(null);
    peerRef.current = null;
    setMyReady(false);
    myReadyRef.current = false;
    setMy({ name: initial.p1Name, f: initial.f1, skin: initial.skin1 });
    setNotice('');
  };

  const beginJoin = () => {
    const c = cleanCode(joinInput);
    if (c.length !== 4) {
      setNotice('Enter the 4-letter code from your friend\u2019s screen.');
      return;
    }
    if (bridgeRef.current) {
      bridgeRef.current.leave();
      bridgeRef.current = null;
    }
    initAudio();
    sfx.click();
    const b = NetBridge.join(c);
    bridgeRef.current = b;
    wiredRef.current = false;
    wire(b);
    setIsHost(false);
    setCode(c);
    setStage('joining');
    setSearching(true);
    setPeer(null);
    peerRef.current = null;
    setMyReady(false);
    myReadyRef.current = false;
    setMy({ name: initial.p2Name, f: initial.f2, skin: initial.skin2 });
    setNotice('');
  };

  const abort = () => {
    bridgeRef.current?.leave();
    bridgeRef.current = null;
    wiredRef.current = false;
    startedRef.current = false;
    setSearching(false);
    setStage('menu');
    setPeer(null);
    peerRef.current = null;
    setRtt(null);
  };

  const toggleReady = () => {
    const b = bridgeRef.current;
    if (!b) return;
    const v = !myReadyRef.current;
    myReadyRef.current = v;
    setMyReady(v);
    sfx.select();
    b.send({ k: 'ready', ready: v });
    if (v) window.setTimeout(tryStart, 30);
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  const myTeam: 0 | 1 = isHost ? 0 : 1;
  const t = TEAM[myTeam];
  const peerTeam: 0 | 1 = isHost ? 1 : 0;
  const pt = TEAM[peerTeam];
  const peerFm = peer ? formationById(peer.f) : null;

  const rttPill =
    rtt !== null ? (
      <span
        className="font-body text-[10px] font-bold tracking-[0.2em] px-2.5 py-1 border"
        style={{
          color: rtt < 100 ? '#7dffa8' : rtt < 220 ? '#ffc400' : '#ff4d1c',
          borderColor: 'currentColor',
        }}
      >
        PING {rtt}ms
      </span>
    ) : null;

  return (
    <div className="relative h-full overflow-y-auto bg-[#04150d]">
      <div className="title-stripes absolute inset-0 opacity-[0.2] pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_30%,rgba(0,0,0,0.5)_100%)] pointer-events-none" />

      <div className="relative z-10 max-w-5xl mx-auto px-4 py-6 sm:py-8 pb-16">
        {/* header */}
        <div className="flex items-center justify-between gap-3 mb-6">
          <button className="btn btn-line px-5 py-2 text-sm" onClick={() => (stage === 'menu' ? onExit() : abort())}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="mr-2 inline-block -mt-0.5">
              <path d="M18 4L4 12l14 8z" />
            </svg>
            {stage === 'menu' ? 'TITLE' : 'BACK'}
          </button>
          <div className="text-center">
            <h2 className="font-display text-2xl sm:text-4xl text-[#eaffdf] drop-shadow-[3px_3px_0_rgba(0,224,255,0.35)] leading-none">NET DUEL</h2>
            <div className="font-body text-[10px] font-bold tracking-[0.3em] text-[#5f8f77] mt-1">TWO PHONES · ONE PITCH · FIRST TO {TARGET_SCORE}</div>
          </div>
          <div className="w-[86px] flex justify-end">{rttPill}</div>
        </div>

        {notice && stage === 'menu' && (
          <div className="mb-4 font-body text-[12px] font-bold tracking-wide text-[#ff8a6a] border-2 border-[#7a2c14] bg-[#2a0f06] px-4 py-2">
            {notice}
          </div>
        )}

        {/* ── MENU ─────────────────────────────────────────── */}
        {stage === 'menu' && (
          <div className="grid sm:grid-cols-2 gap-5">
            <button
              onClick={beginHost}
              className="text-left bg-[#06251a] border-2 border-[#ffc400] p-6 shadow-[8px_8px_0_rgba(0,0,0,0.5)] hover:-translate-y-1 hover:shadow-[10px_12px_0_rgba(0,0,0,0.5)] transition-all"
            >
              <div className="font-display text-3xl text-[#ffc400] mb-2">HOST A DUEL</div>
              <div className="font-body text-[13px] font-semibold text-[#9dc4ae] leading-relaxed">
                Create a room and share the <span className="text-[#eaffdf]">4-letter code</span> with your friend. You command{' '}
                <span style={{ color: TEAM[0].color }}>GOLD — bottom side</span>, attacking upward.
              </div>
              <div className="mt-4 inline-block btn btn-gold px-6 py-2.5 text-sm pointer-events-none">CREATE ROOM</div>
            </button>
            <button
              onClick={() => {
                initAudio();
                sfx.click();
                setStage('joining');
                setNotice('');
              }}
              className="text-left bg-[#03222a] border-2 border-[#00e0ff] p-6 shadow-[8px_8px_0_rgba(0,0,0,0.5)] hover:-translate-y-1 hover:shadow-[10px_12px_0_rgba(0,0,0,0.5)] transition-all"
            >
              <div className="font-display text-3xl text-[#00e0ff] mb-2">JOIN A DUEL</div>
              <div className="font-body text-[13px] font-semibold text-[#9dc4ae] leading-relaxed">
                Enter the code from your friend&rsquo;s screen. You command <span style={{ color: TEAM[1].color }}>CYAN — top side</span>, attacking
                downward.
              </div>
              <div className="mt-4 inline-block btn btn-net px-6 py-2.5 text-sm pointer-events-none">ENTER CODE</div>
            </button>
            <div className="sm:col-span-2 font-body text-[11px] font-semibold tracking-wide text-[#5f8f77] leading-relaxed border-2 border-[#123a27] bg-[rgba(4,21,13,0.8)] px-4 py-3">
              Both phones need internet for a moment to find each other — after that the match runs{' '}
              <span className="text-[#eaffdf]">peer-to-peer</span>. Keep the page open on both devices. Miss {MISS_LIMIT} turns in a row and you
              forfeit, same as hotseat.
            </div>
          </div>
        )}

        {/* ── HOSTING ──────────────────────────────────────── */}
        {stage === 'hosting' && (
          <div className="max-w-md mx-auto bg-[#06251a] border-2 border-[#ffc400] p-7 text-center shadow-[10px_10px_0_rgba(0,0,0,0.5)]">
            <div className="font-body text-[10px] font-bold tracking-[0.35em] text-[#5f8f77] mb-4">YOUR ROOM CODE</div>
            <div className="flex justify-center gap-3 mb-6">
              {code.split('').map((ch, i) => (
                <div
                  key={i}
                  className="code-pop w-16 h-20 grid place-items-center font-display text-5xl text-[#ffc400] bg-[#04150d] border-2 border-[#8a6200] shadow-[0_0_18px_rgba(255,196,0,0.25)]"
                  style={{ animationDelay: `${i * 90}ms` }}
                >
                  {ch}
                </div>
              ))}
            </div>
            <button className="btn btn-line px-6 py-2 text-sm mb-6" onClick={copyCode}>
              {copied ? 'COPIED!' : 'COPY CODE'}
            </button>
            <div className="font-body text-[13px] font-semibold text-[#9dc4ae]">
              <Spinner /> <span className="ml-2">Waiting for a challenger to join…</span>
            </div>
            <div className="mt-3 font-body text-[11px] font-semibold text-[#5f8f77]">
              Your friend opens the game → NET DUEL → JOIN → types this code.
            </div>
            {notice && <div className="mt-4 font-body text-[12px] font-bold text-[#ff8a6a]">{notice}</div>}
          </div>
        )}

        {/* ── JOINING ──────────────────────────────────────── */}
        {stage === 'joining' && (
          <div className="max-w-md mx-auto bg-[#03222a] border-2 border-[#00e0ff] p-7 text-center shadow-[10px_10px_0_rgba(0,0,0,0.5)]">
            <div className="font-body text-[10px] font-bold tracking-[0.35em] text-[#5f8f77] mb-4">ENTER ROOM CODE</div>
            <input
              value={joinInput}
              onChange={(e) => setJoinInput(cleanCode(e.target.value))}
              onKeyDown={(e) => e.key === 'Enter' && beginJoin()}
              maxLength={4}
              autoFocus
              placeholder="····"
              className="w-56 mx-auto block text-center font-display text-5xl tracking-[0.4em] text-[#00e0ff] bg-[#04150d] border-2 border-[#00616e] px-4 py-3 outline-none focus:border-[#00e0ff] placeholder:text-[#0a4a55] uppercase"
            />
            <div className="mt-6 flex justify-center gap-3">
              <button className="btn btn-net px-8 py-2.5" onClick={beginJoin}>
                CONNECT
              </button>
              <button className="btn btn-line px-6 py-2.5 text-sm" onClick={() => (searching ? abort() : setStage('menu'))}>
                BACK
              </button>
            </div>
            {searching && (
              <div className="mt-4 font-body text-[12px] font-semibold text-[#9dc4ae]">
                <Spinner color="#00e0ff" /> <span className="ml-2">Searching for the host — make sure their room is open…</span>
              </div>
            )}
            {notice && <div className="mt-4 font-body text-[12px] font-bold text-[#ff8a6a]">{notice}</div>}
          </div>
        )}

        {/* ── LOBBY ────────────────────────────────────────── */}
        {stage === 'lobby' && (
          <div>
            <div className="grid lg:grid-cols-[1fr_auto_1fr] gap-5 items-start">
              {/* my card */}
              <div className="bg-[#06251a] border-2 p-5 shadow-[6px_6px_0_rgba(0,0,0,0.5)]" style={{ borderColor: t.color }}>
                <div className="flex items-center justify-between mb-4">
                  <div className="skew-x-[-8deg] px-3 py-1 font-display text-sm" style={{ background: t.color, color: '#04150d' }}>
                    <span className="inline-block skew-x-[8deg]">YOU · {isHost ? 'GOLD · BOTTOM' : 'CYAN · TOP'}</span>
                  </div>
                  <div className="w-3.5 h-3.5 rounded-full pulse-dot" style={{ background: t.color, color: t.color }} />
                </div>
                <label className="block font-body text-[10px] font-bold tracking-[0.25em] text-[#5f8f77] mb-1">COACH NAME</label>
                <input
                  value={my.name}
                  maxLength={12}
                  onChange={(e) => setMy((s) => ({ ...s, name: e.target.value.toUpperCase() }))}
                  className="w-full mb-4 bg-[#04150d] border-2 border-[#1c5c40] px-3 py-2 font-display text-sm tracking-wider text-[#eaffdf] outline-none focus:border-[#ff8a1c]"
                />
                <label className="block font-body text-[10px] font-bold tracking-[0.25em] text-[#5f8f77] mb-2">FORMATION — 5 STICKS</label>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {FORMATIONS.map((f) => {
                    const sel = f.id === my.f;
                    return (
                      <button
                        key={f.id}
                        onClick={() => {
                          sfx.click();
                          setMy((s) => ({ ...s, f: f.id }));
                        }}
                        className={`border-2 p-1.5 text-left transition-all duration-150 ${
                          sel ? 'bg-[#0a3524] -translate-y-0.5' : 'border-[#1c5c40] bg-[#04150d] opacity-80 hover:opacity-100'
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
                <div className="grid grid-cols-6 gap-1.5">
                  {SKINS.map((s) => (
                    <SkinTile key={s.id} id={s.id} team={myTeam} selected={s.id === my.skin} onClick={() => { sfx.click(); setMy((st) => ({ ...st, skin: s.id })); }} />
                  ))}
                </div>
              </div>

              {/* VS divider */}
              <div className="hidden lg:flex flex-col items-center justify-center pt-24">
                <div className="font-display text-5xl text-[#ff8a1c] drop-shadow-[3px_3px_0_rgba(0,0,0,0.8)] -rotate-6">VS</div>
              </div>

              {/* peer card */}
              <div
                className="border-2 p-5 shadow-[6px_6px_0_rgba(0,0,0,0.5)]"
                style={{ borderColor: peer ? pt.color : '#1c5c40', background: peer ? '#06251a' : 'rgba(6,37,26,0.5)' }}
              >
                <div className="flex items-center justify-between mb-4">
                  <div
                    className="skew-x-[-8deg] px-3 py-1 font-display text-sm"
                    style={{ background: peer ? pt.color : '#1c5c40', color: '#04150d' }}
                  >
                    <span className="inline-block skew-x-[8deg]">RIVAL · {isHost ? 'CYAN · TOP' : 'GOLD · BOTTOM'}</span>
                  </div>
                  {peer ? (
                    <div
                      className={`h-3.5 w-3.5 rounded-full ${peer.ready ? 'pulse-dot' : ''}`}
                      style={{ background: peer.ready ? '#7dffa8' : '#5f8f77', color: '#7dffa8' }}
                    />
                  ) : (
                    <Spinner color="#5f8f77" />
                  )}
                </div>
                {peer ? (
                  <>
                    <div className="font-display text-2xl mb-3 truncate" style={{ color: pt.color }}>
                      {peer.name || 'RIVAL'}
                    </div>
                    <div className="font-body text-[10px] font-bold tracking-[0.25em] text-[#5f8f77] mb-1">FORMATION</div>
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-20">{peerFm && <FormationDots rows={peerFm.rows} color={pt.color} dark={pt.dark} />}</div>
                      <div>
                        <div className="font-display text-lg leading-none" style={{ color: pt.color }}>
                          {peerFm?.name}
                        </div>
                        <div className="font-body text-[9px] font-bold tracking-[0.14em] text-[#5f8f77]">{peerFm?.tag}</div>
                      </div>
                    </div>
                    <div className="font-body text-[10px] font-bold tracking-[0.25em] text-[#5f8f77] mb-1">EMBLEM</div>
                    <div className="flex items-center gap-2">
                      <SkinTile id={peer.skin} team={peerTeam} selected onClick={() => undefined} />
                      <span className="font-body text-[12px] font-semibold text-[#9dc4ae]">{skinById(peer.skin).name}</span>
                    </div>
                    <div
                      className="mt-4 font-display text-sm px-3 py-1.5 inline-block"
                      style={{
                        color: peer.ready ? '#04150d' : '#9dc4ae',
                        background: peer.ready ? '#7dffa8' : 'transparent',
                        border: peer.ready ? 'none' : '2px dashed #1c5c40',
                      }}
                    >
                      {peer.ready ? 'READY!' : 'SETTING UP…'}
                    </div>
                  </>
                ) : (
                  <div className="font-body text-[13px] font-semibold text-[#5f8f77] py-10 text-center">
                    <Spinner color="#5f8f77" />
                    <div className="mt-3">{notice || 'Syncing with your rival…'}</div>
                  </div>
                )}
              </div>
            </div>

            {/* ready bar */}
            <div className="mt-7 flex flex-col items-center gap-3">
              <button
                className={`btn px-14 py-4 text-xl ${myReady ? 'btn-ready' : 'btn-gold'}`}
                onClick={toggleReady}
                style={myReady ? { background: '#7dffa8', color: '#04150d', borderColor: '#04150d' } : undefined}
              >
                {myReady ? 'READY — WAITING FOR RIVAL' : 'I\u2019M READY'}
              </button>
              <div className="font-body text-[11px] font-semibold tracking-[0.2em] text-[#5f8f77] uppercase text-center">
                {myReady && peer?.ready
                  ? 'Both coaches ready — kicking off…'
                  : myReady
                    ? `Waiting for ${peer?.name || 'your rival'} to ready up…`
                    : 'Pick your name, formation and emblem — then ready up'}
              </div>
              {notice && stage === 'lobby' && peer && (
                <div className="font-body text-[12px] font-bold text-[#ff8a6a]">{notice}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
