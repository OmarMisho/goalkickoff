# Kickoff Tactics — Online Deployment Guide

Two-player online play over **two separate phones**. Architecture:

- **Frontend** (this repo): a static Vite build. Each player opens it on their own device.
- **Transport**: serverless WebRTC via [Trystero](https://github.com/dmotz/trystero). The two
  phones meet over **public signaling networks** — MQTT brokers, BitTorrent trackers, and Nostr
  relays — rotating on synchronized 7-second windows until they connect. Then all game data
  flows **directly phone-to-phone** over an encrypted WebRTC data channel.
- **Backend: none required.** There is no server to host, maintain, or pay for.
- The host (Player 1) is authoritative — they simulate the match and stream the baked resolve
  reel to the guest, so both screens replay the *identical* clash.

## Step 1 — Build the frontend

```bash
npm install
npm run build
```

Output lands in `dist/`.

## Step 2 — Host the static files (any static host)

**Netlify (fastest):**
1. Go to app.netlify.com → *Add new site* → *Deploy manually*.
2. Drag the `dist/` folder in. Done — you get an HTTPS URL.

**Vercel:**
```bash
npm i -g vercel
vercel            # framework: Vite, build: npm run build, output: dist
```

**GitHub Pages / Cloudflare Pages / S3:** any static host works — serve `dist/` at the root.

> HTTPS is required (WebRTC won't run on plain HTTP). Netlify/Vercel/CF Pages all give you HTTPS free.

## Step 3 — Play!

1. Player 1 opens the site → **ONLINE MATCH** → **HOST A ROOM** → reads out the 4-letter code.
2. Player 2 opens the site on their phone → **ONLINE MATCH** → types the code → **JOIN**.
3. The two phones connect automatically (usually 1–3 seconds; if one signaling network is
   blocked, they rotate to the next public network together within ~7 seconds).
4. Host presses **START MATCH**. Both plan in secret for 10s per segment, then clash.

## Testing tips

- Try once on the same Wi-Fi and once on mobile data (the real internet path).
- Watch the `RTT` chip in the HUD — expect 20–80ms on a LAN, 40–150ms over the internet.
- Behind a very strict corporate firewall, WebRTC may need a TURN relay; that's an advanced
  setup (host your own `coturn` and point Trystero at it via relay config).

## Notes & limits

- The host is authoritative; guest input is validated (`sanitizePlan` in the engine).
- Reconnects aren't automatic — a drop shows **CONNECTION LOST**; re-host and re-join.
- One room = exactly two players.
- If you want fully private infrastructure later, run your own MQTT broker / WebTorrent
  tracker / Nostr relay and configure Trystero's strategies to use it — but for public
  releases the default public networks are the zero-ops path.
