export interface FlagDef {
  id: string;
  name: string;
  tag: string;
  kind: "country" | "club";
}

export const FLAGS: FlagDef[] = [
  { id: "bra", name: "Brazil", tag: "BRA", kind: "country" },
  { id: "arg", name: "Argentina", tag: "ARG", kind: "country" },
  { id: "fra", name: "France", tag: "FRA", kind: "country" },
  { id: "ger", name: "Germany", tag: "GER", kind: "country" },
  { id: "esp", name: "Spain", tag: "ESP", kind: "country" },
  { id: "por", name: "Portugal", tag: "POR", kind: "country" },
  { id: "eng", name: "England", tag: "ENG", kind: "country" },
  { id: "ita", name: "Italy", tag: "ITA", kind: "country" },
  { id: "ned", name: "Netherlands", tag: "NED", kind: "country" },
  { id: "jpn", name: "Japan", tag: "JPN", kind: "country" },
  { id: "blaugrana", name: "Blaugrana FC", tag: "BLA", kind: "club" },
  { id: "reds", name: "The Reds", tag: "RED", kind: "club" },
  { id: "merengues", name: "Merengues CF", tag: "MER", kind: "club" },
  { id: "gunners", name: "North London", tag: "GUN", kind: "club" },
  { id: "skyblues", name: "Sky Blues", tag: "SKY", kind: "club" },
  { id: "rossoneri", name: "Rossoneri", tag: "ROS", kind: "club" },
  { id: "bavaria", name: "Bavaria 04", tag: "BAV", kind: "club" },
  { id: "turfs", name: "Turf Kings", tag: "TUR", kind: "club" },
];

export const flagById = (id: string): FlagDef =>
  FLAGS.find((f) => f.id === id) ?? FLAGS[0];

function drawFlag(c: CanvasRenderingContext2D, id: string, w: number, h: number) {
  c.save();
  c.beginPath();
  c.rect(0, 0, w, h);
  c.clip();
  const stripe = (x: number, ww: number, color: string) => {
    c.fillStyle = color;
    c.fillRect(x, 0, ww, h);
  };
  const disc = (x: number, y: number, r: number, color: string) => {
    c.fillStyle = color;
    c.beginPath();
    c.arc(x, y, r, 0, 7);
    c.fill();
  };
  switch (id) {
    case "bra":
      stripe(0, w, "#009739");
      c.fillStyle = "#fedd00";
      c.beginPath();
      c.moveTo(w / 2, h * 0.1);
      c.lineTo(w * 0.92, h / 2);
      c.lineTo(w / 2, h * 0.9);
      c.lineTo(w * 0.08, h / 2);
      c.closePath();
      c.fill();
      disc(w / 2, h / 2, h * 0.22, "#012169");
      break;
    case "arg":
      stripe(0, w, "#74acdf");
      stripe(0, w, "#74acdf");
      c.fillStyle = "#fff";
      c.fillRect(0, h / 3, w, h / 3);
      disc(w / 2, h / 2, h * 0.13, "#f6b40e");
      break;
    case "fra":
      stripe(0, w / 3, "#0055a4");
      stripe(w / 3, w / 3, "#fff");
      stripe((2 * w) / 3, w / 3, "#ef4135");
      break;
    case "ger":
      stripe(0, w, "#000");
      c.fillStyle = "#dd0000";
      c.fillRect(0, h / 3, w, h / 3);
      c.fillStyle = "#ffce00";
      c.fillRect(0, (2 * h) / 3, w, h / 3);
      break;
    case "esp":
      stripe(0, w, "#aa151b");
      c.fillStyle = "#f1bf00";
      c.fillRect(0, h * 0.25, w, h * 0.5);
      break;
    case "por":
      stripe(0, w * 0.4, "#046a38");
      stripe(w * 0.4, w * 0.6, "#da291c");
      disc(w * 0.4, h / 2, h * 0.16, "#ffe900");
      break;
    case "eng":
      stripe(0, w, "#fff");
      c.fillStyle = "#ce1124";
      c.fillRect(w / 2 - w * 0.08, 0, w * 0.16, h);
      c.fillRect(0, h / 2 - h * 0.1, w, h * 0.2);
      break;
    case "ita":
      stripe(0, w / 3, "#008c45");
      stripe(w / 3, w / 3, "#fff");
      stripe((2 * w) / 3, w / 3, "#cd212a");
      break;
    case "ned":
      stripe(0, w, "#ae1c28");
      c.fillStyle = "#fff";
      c.fillRect(0, h / 3, w, h / 3);
      c.fillStyle = "#21468b";
      c.fillRect(0, (2 * h) / 3, w, h / 3);
      break;
    case "jpn":
      stripe(0, w, "#fff");
      disc(w / 2, h / 2, h * 0.22, "#bc002d");
      break;
    case "blaugrana":
      for (let i = 0; i < 6; i++) stripe((i * w) / 6, w / 6, i % 2 ? "#ffce00" : "#a50044");
      break;
    case "reds":
      stripe(0, w, "#c8102e");
      c.fillStyle = "#ffe9a8";
      c.beginPath();
      c.moveTo(w / 2, h * 0.2);
      c.lineTo(w * 0.66, h * 0.52);
      c.lineTo(w / 2, h * 0.8);
      c.lineTo(w * 0.34, h * 0.52);
      c.closePath();
      c.fill();
      break;
    case "merengues":
      stripe(0, w, "#f5f0e6");
      c.strokeStyle = "#c8a24a";
      c.lineWidth = Math.max(2, h * 0.06);
      c.strokeRect(w * 0.08, h * 0.08, w * 0.84, h * 0.84);
      disc(w / 2, h / 2, h * 0.16, "#34558b");
      break;
    case "gunners":
      stripe(0, w, "#ef0107");
      c.fillStyle = "#fff";
      c.fillRect(0, h * 0.42, w, h * 0.16);
      c.fillStyle = "#9c824a";
      c.fillRect(w * 0.18, h * 0.46, w * 0.64, h * 0.08);
      break;
    case "skyblues":
      stripe(0, w, "#6cabdd");
      disc(w / 2, h / 2, h * 0.2, "#fff");
      c.fillStyle = "#6cabdd";
      c.beginPath();
      c.arc(w / 2, h / 2, h * 0.09, 0, 7);
      c.fill();
      break;
    case "rossoneri":
      for (let i = 0; i < 6; i++) stripe((i * w) / 6, w / 6, i % 2 ? "#fff" : "#d50032");
      break;
    case "bavaria":
      stripe(0, w, "#dc052d");
      c.fillStyle = "#fff";
      c.beginPath();
      c.moveTo(w * 0.1, h * 0.86);
      c.lineTo(w * 0.5, h * 0.14);
      c.lineTo(w * 0.9, h * 0.86);
      c.closePath();
      c.fill();
      c.fillStyle = "#0066b2";
      disc(w / 2, h * 0.62, h * 0.1, "#0066b2");
      break;
    case "turfs":
      stripe(0, w, "#0b6b3a");
      c.fillStyle = "#fff";
      for (let i = 0; i < 3; i++) {
        const x = w * (0.28 + i * 0.22);
        c.beginPath();
        c.moveTo(x - w * 0.05, h * 0.72);
        c.lineTo(x, h * 0.3);
        c.lineTo(x + w * 0.05, h * 0.72);
        c.closePath();
        c.fill();
      }
      break;
    default:
      stripe(0, w, "#2a7fff");
      disc(w / 2, h / 2, h * 0.2, "#fff");
  }
  c.restore();
}

/* circular crest used on coins + scoreboards */
const emblemCache = new Map<string, HTMLCanvasElement>();

export function makeEmblem(id: string, size: number, ring: string): HTMLCanvasElement {
  const key = `${id}:${size}:${ring}`;
  const hit = emblemCache.get(key);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = size;
  cv.height = size;
  const c = cv.getContext("2d")!;
  const r = size / 2;
  c.save();
  c.beginPath();
  c.arc(r, r, r * 0.92, 0, 7);
  c.clip();
  drawFlag(c, id, size, size);
  c.restore();
  c.lineWidth = Math.max(2, size * 0.07);
  c.strokeStyle = ring;
  c.beginPath();
  c.arc(r, r, r * 0.92 - c.lineWidth / 2, 0, 7);
  c.stroke();
  emblemCache.set(key, cv);
  return cv;
}

/** rectangular flag (title/pick screens) */
const rectCache = new Map<string, HTMLCanvasElement>();

export function makeFlagRect(id: string, w: number, h: number): HTMLCanvasElement {
  const key = `${id}:${w}:${h}`;
  const hit = rectCache.get(key);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const c = cv.getContext("2d")!;
  drawFlag(c, id, w, h);
  c.strokeStyle = "rgba(0,0,0,0.45)";
  c.lineWidth = 1.5;
  c.strokeRect(0.75, 0.75, w - 1.5, h - 1.5);
  rectCache.set(key, cv);
  return cv;
}
