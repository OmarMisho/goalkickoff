// ── Stick emblems (club crests + nation flags) & the match football ────
// Everything is drawn procedurally — no image assets.

export interface SkinDef {
  id: string;
  name: string;
  kind: 'club' | 'flag';
  draw: (ctx: CanvasRenderingContext2D, r: number) => void;
}

function pentagon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, rot: number) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = rot + (i * Math.PI * 2) / 5;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function star5(ctx: CanvasRenderingContext2D, cx: number, cy: number, ro: number, ri: number, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? ro : ri;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

const vStripes = (colors: string[]) => (ctx: CanvasRenderingContext2D, r: number) => {
  const w = (r * 2) / colors.length;
  colors.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(-r + i * w, -r, w + 0.5, r * 2);
  });
};

const hStripes = (colors: string[]) => (ctx: CanvasRenderingContext2D, r: number) => {
  const h = (r * 2) / colors.length;
  colors.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(-r, -r + i * h, r * 2, h + 0.5);
  });
};

export const SKINS: SkinDef[] = [
  // ── club crests ──
  {
    id: 'crown',
    name: 'ROYAL FC',
    kind: 'club',
    draw: (ctx, r) => {
      ctx.fillStyle = '#14306e';
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.fillStyle = '#ffc400';
      const w = r * 0.92;
      const y0 = r * 0.34;
      const h = r * 0.58;
      ctx.beginPath();
      ctx.moveTo(-w / 2, y0);
      ctx.lineTo(-w / 2, y0 - h * 0.52);
      ctx.lineTo(-w * 0.25, y0 - h * 0.2);
      ctx.lineTo(0, y0 - h);
      ctx.lineTo(w * 0.25, y0 - h * 0.2);
      ctx.lineTo(w / 2, y0 - h * 0.52);
      ctx.lineTo(w / 2, y0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#d99e00';
      ctx.fillRect(-w / 2, y0, w, h * 0.2);
      ctx.fillStyle = '#c8102e';
      for (const fx of [-w * 0.28, 0, w * 0.28]) {
        ctx.beginPath();
        ctx.arc(fx, y0 + h * 0.1, r * 0.055, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },
  {
    id: 'bolt',
    name: 'VOLT 09',
    kind: 'club',
    draw: (ctx, r) => {
      ctx.fillStyle = '#23282e';
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.fillStyle = '#ffc400';
      ctx.strokeStyle = '#04150d';
      ctx.lineWidth = r * 0.06;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(r * 0.1, -r * 0.66);
      ctx.lineTo(-r * 0.32, r * 0.1);
      ctx.lineTo(-r * 0.02, r * 0.1);
      ctx.lineTo(-r * 0.1, r * 0.66);
      ctx.lineTo(r * 0.32, -r * 0.14);
      ctx.lineTo(r * 0.02, -r * 0.14);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    },
  },
  {
    id: 'star',
    name: 'STAR FC',
    kind: 'club',
    draw: (ctx, r) => {
      ctx.fillStyle = '#c8102e';
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.fillStyle = '#ffffff';
      star5(ctx, 0, 0, r * 0.55, r * 0.22);
      ctx.fill();
      ctx.fillStyle = '#c8102e';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.1, 0, Math.PI * 2);
      ctx.fill();
    },
  },
  {
    id: 'stripes',
    name: 'DUAL STRIPES',
    kind: 'club',
    draw: vStripes(['#004d98', '#a50044', '#004d98', '#a50044', '#004d98', '#a50044', '#004d98']),
  },
  {
    id: 'laurel',
    name: 'LAUREL AC',
    kind: 'club',
    draw: (ctx, r) => {
      ctx.fillStyle = '#0b4f31';
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.strokeStyle = '#ffc400';
      ctx.lineWidth = r * 0.15;
      ctx.setLineDash([r * 0.2, r * 0.13]);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.56, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffc400';
      star5(ctx, 0, 0, r * 0.24, r * 0.1);
      ctx.fill();
    },
  },
  {
    id: 'checker',
    name: 'MAGPIES',
    kind: 'club',
    draw: (ctx, r) => {
      const s = r / 2;
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          ctx.fillStyle = (i + j) % 2 === 0 ? '#16181a' : '#f2f2f2';
          ctx.fillRect(-r + i * s, -r + j * s, s + 0.5, s + 0.5);
        }
      }
    },
  },
  // ── nation flags ──
  {
    id: 'brazil',
    name: 'BRAZIL',
    kind: 'flag',
    draw: (ctx, r) => {
      ctx.fillStyle = '#009c3b';
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.fillStyle = '#ffdf00';
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.72);
      ctx.lineTo(r * 0.92, 0);
      ctx.lineTo(0, r * 0.72);
      ctx.lineTo(-r * 0.92, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#002776';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = r * 0.07;
      ctx.beginPath();
      ctx.arc(0, r * 0.5, r * 0.52, -Math.PI * 0.78, -Math.PI * 0.34);
      ctx.stroke();
    },
  },
  { id: 'france', name: 'FRANCE', kind: 'flag', draw: vStripes(['#0055a4', '#ffffff', '#ef4135']) },
  { id: 'germany', name: 'GERMANY', kind: 'flag', draw: hStripes(['#151515', '#dd0000', '#ffce00']) },
  {
    id: 'england',
    name: 'ENGLAND',
    kind: 'flag',
    draw: (ctx, r) => {
      ctx.fillStyle = '#f5f5f5';
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.fillStyle = '#c8102e';
      ctx.fillRect(-r, -r * 0.2, r * 2, r * 0.4);
      ctx.fillRect(-r * 0.2, -r, r * 0.4, r * 2);
    },
  },
  {
    id: 'japan',
    name: 'JAPAN',
    kind: 'flag',
    draw: (ctx, r) => {
      ctx.fillStyle = '#f7f7f7';
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.fillStyle = '#bc002d';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
      ctx.fill();
    },
  },
  {
    id: 'argentina',
    name: 'ARGENTINA',
    kind: 'flag',
    draw: (ctx, r) => {
      hStripes(['#74acdf', '#ffffff', '#74acdf', '#ffffff', '#74acdf'])(ctx, r);
      ctx.fillStyle = '#f6b40e';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.17, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#85340a';
      ctx.lineWidth = r * 0.035;
      ctx.stroke();
    },
  },
];

export function skinById(id: string): SkinDef {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

// Paints a complete mallet face: emblem + sheen + team identity ring.
export function paintStick(
  ctx: CanvasRenderingContext2D,
  skinId: string,
  team: { color: string; dark: string; light: string },
  r: number
) {
  const skin = skinById(skinId);
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();
  skin.draw(ctx, r);
  // sheen
  const g = ctx.createLinearGradient(0, -r, 0, r * 0.7);
  g.addColorStop(0, 'rgba(255,255,255,0.42)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.06)');
  g.addColorStop(1, 'rgba(0,0,0,0.16)');
  ctx.fillStyle = g;
  ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.restore();
  // team identity ring (keeps sides readable at a glance)
  ctx.lineWidth = r * 0.16;
  ctx.strokeStyle = team.color;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.92, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = r * 0.045;
  ctx.strokeStyle = 'rgba(3,15,9,0.6)';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.835, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = r * 0.05;
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.995, 0, Math.PI * 2);
  ctx.stroke();
}

// A proper football: white panels, black pentagons, seams. Rotated by caller.
export function drawFootball(ctx: CanvasRenderingContext2D, r: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();
  const base = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r * 1.15);
  base.addColorStop(0, '#ffffff');
  base.addColorStop(0.55, '#eef1ec');
  base.addColorStop(1, '#aeb8ae');
  ctx.fillStyle = base;
  ctx.fillRect(-r, -r, r * 2, r * 2);
  // seams radiating from the centre pentagon
  ctx.strokeStyle = 'rgba(40,50,44,0.55)';
  ctx.lineWidth = Math.max(1, r * 0.07);
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (k * Math.PI * 2) / 5;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4);
    ctx.lineTo(Math.cos(a) * r * 1.05, Math.sin(a) * r * 1.05);
    ctx.stroke();
  }
  ctx.fillStyle = '#1d241f';
  // centre pentagon
  pentagon(ctx, 0, 0, r * 0.42, -Math.PI / 2);
  ctx.fill();
  // edge pentagons (mostly clipped → classic crescents)
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + Math.PI / 5 + (k * Math.PI * 2) / 5;
    ctx.save();
    ctx.rotate(a);
    pentagon(ctx, 0, -r * 0.98, r * 0.42, Math.PI / 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#22302a';
  ctx.lineWidth = Math.max(1.2, r * 0.09);
  ctx.stroke();
}
