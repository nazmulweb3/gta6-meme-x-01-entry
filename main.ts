// GTA 6 launch-week meme, drawn by this program itself.
//
// "WAITED 13 YEARS FOR GTA 6 / CALLED IN SICK. SEE YOU IN LEONIDA."
// A synthwave Vice City sunset: the make.fun ghost rides shotgun in a hot
// pink convertible, holding up its magenta star coin, past a MAKE.FUN
// billboard. The joke is the thirteen-year wait since GTA V and the
// launch-day sick day every fan is taking.
//
// What this program does (Node 22, standard library only, no network):
//   1. copies POST.json from the repository to /output/POST.json, which is
//      what the gate reads (the post's address on X);
//   2. renders the meme picture deterministically to /output/entry.png
//      (1024 x 1024). Run it twice from anywhere and the sha256 matches:
//      every pixel is a pure function of the constants below.
//
//   mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const BOT_DIR = process.env.MAKEFUN_BOT_DIR ?? "/bot";
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

const W = 1024;
const H = 1024;
const TOP_BAR = 168;
const BOT_BAR = 168;
const SCENE_TOP = TOP_BAR;
const SCENE_BOT = H - BOT_BAR;

// ---------------------------------------------------------------------------
// Pixel buffer: plain RGB rows, written out as a PNG with filter 0.
// ---------------------------------------------------------------------------

const px = new Uint8Array(W * H * 3);

function setPixel(x, y, r, g, b) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = r;
  px[i + 1] = g;
  px[i + 2] = b;
}

function fillRect(x0, y0, x1, y1, c) {
  for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
      setPixel(x, y, c[0], c[1], c[2]);
    }
  }
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function mix(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// Scanline polygon fill: pts is a flat [x0, y0, x1, y1, ...] list.
function fillPolygon(pts, c) {
  const n = pts.length / 2;
  let minY = H;
  let maxY = 0;
  for (let i = 0; i < n; i++) {
    minY = Math.min(minY, pts[i * 2 + 1]);
    maxY = Math.max(maxY, pts[i * 2 + 1]);
  }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(H - 1, Math.ceil(maxY)); y++) {
    const xs = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x1 = pts[i * 2];
      const y1 = pts[i * 2 + 1];
      const x2 = pts[j * 2];
      const y2 = pts[j * 2 + 1];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(W - 1, Math.floor(xs[k + 1])); x++) {
        setPixel(x, y, c[0], c[1], c[2]);
      }
    }
  }
}

function fillCircle(cx, cy, r, c) {
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++) {
    const dy = y - cy;
    const dx = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
    for (let x = Math.max(0, cx - dx); x <= Math.min(W - 1, cx + dx); x++) {
      setPixel(x, y, c[0], c[1], c[2]);
    }
  }
}

function fillEllipse(cx, cy, rx, ry, c) {
  for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(H - 1, Math.ceil(cy + ry)); y++) {
    const dy = (y - cy) / ry;
    const dx = Math.floor(rx * Math.sqrt(Math.max(0, 1 - dy * dy)));
    for (let x = Math.max(0, cx - dx); x <= Math.min(W - 1, cx + dx); x++) {
      setPixel(x, y, c[0], c[1], c[2]);
    }
  }
}

// Five-point star, point up, centred at (cx, cy).
function fillStar(cx, cy, rOuter, c) {
  const pts = [];
  const rInner = rOuter * 0.45;
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  fillPolygon(pts, c);
}

// A tapered quad from (x0, y0) to (x1, y1): wide at the base, pointed tip.
function taperedQuad(x0, y0, x1, y1, w0, w1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  return [
    x0 + (nx * w0) / 2, y0 + (ny * w0) / 2,
    x0 - (nx * w0) / 2, y0 - (ny * w0) / 2,
    x1 - (nx * w1) / 2, y1 - (ny * w1) / 2,
    x1 + (nx * w1) / 2, y1 + (ny * w1) / 2,
  ];
}

// ---------------------------------------------------------------------------
// 5x7 bitmap font. Bit 4 of each row is the leftmost cell.
// ---------------------------------------------------------------------------

const GLYPHS = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
  "3": [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x0e, 0x10, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  "7": [0x1f, 0x01, 0x02, 0x04, 0x04, 0x04, 0x04],
  "8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  "9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x01, 0x0e],
  ".": [0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x0c],
  "!": [0x04, 0x04, 0x04, 0x04, 0x04, 0x00, 0x04],
  " ": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
};

function textWidth(text, scale) {
  return text.length * 6 * scale - scale;
}

function drawText(text, cx, y, scale, c) {
  const w = textWidth(text, scale);
  let x = Math.round(cx - w / 2);
  for (const ch of text) {
    const glyph = GLYPHS[ch] ?? GLYPHS[" "];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row] & (1 << (4 - col))) {
          fillRect(x + col * scale, y + row * scale, x + (col + 1) * scale, y + (row + 1) * scale, c);
        }
      }
    }
    x += 6 * scale;
  }
}

// ---------------------------------------------------------------------------
// PNG encoding: colour type 2 (RGB), filter 0, zlib level 9. Deterministic.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePNG() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    raw.set(px.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// The scene.
// ---------------------------------------------------------------------------

const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];
const SKY_TOP = [42, 10, 74];
const SKY_MID = [184, 50, 128];
const SKY_LOW = [255, 126, 61];
const SUN = [255, 210, 63];
const SILHOUETTE = [22, 10, 40];
const ROAD = [30, 16, 48];
const PINK = [255, 46, 136];
const MAGENTA = [194, 24, 91];
const CREAM = [255, 246, 232];

function skyColour(y) {
  const horizon = 740;
  if (y <= SCENE_TOP) return SKY_TOP;
  if (y >= horizon) return SKY_LOW;
  const t = (y - SCENE_TOP) / (horizon - SCENE_TOP);
  return t < 0.55 ? mix(SKY_TOP, SKY_MID, t / 0.55) : mix(SKY_MID, SKY_LOW, (t - 0.55) / 0.45);
}

function drawSky() {
  for (let y = SCENE_TOP; y < SCENE_BOT; y++) {
    const c = skyColour(y);
    for (let x = 0; x < W; x++) setPixel(x, y, c[0], c[1], c[2]);
  }
}

function drawSun() {
  const cx = 512;
  const cy = 648;
  const r = 118;
  fillCircle(cx, cy, r, SUN);
  // Synthwave slats: cut horizontal gaps across the sun's upper half,
  // growing thicker toward the horizon, in the sky colour at that height.
  // (The skyline hides the sun's lower half, so the slats sit high.)
  const slats = [
    [600, 4],
    [616, 6],
    [634, 8],
    [654, 10],
  ];
  for (const [y, h] of slats) {
    const dy = y - cy;
    const dx = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
    const c = skyColour(y);
    fillRect(cx - dx, y, cx + dx, y + h, c);
  }
}

function drawSkyline() {
  // Fixed building silhouettes along the horizon, with lit windows.
  const buildings = [
    [0, 90, 96], [92, 70, 130], [164, 110, 84], [276, 64, 142],
    [342, 96, 104], [440, 74, 150], [516, 100, 92], [618, 66, 138],
    [686, 104, 100], [792, 72, 146], [866, 96, 90], [964, 60, 128],
  ];
  for (const [x, w, h] of buildings) {
    fillRect(x, 760 - h, x + w, 760, SILHOUETTE);
  }
  // Lit windows: a fixed, sparse pattern so the skyline reads at 480 px.
  const windows = [
    [20, 690], [120, 660], [200, 700], [300, 650], [360, 690],
    [470, 640], [540, 700], [640, 660], [720, 700], [820, 650],
    [900, 690], [980, 670], [60, 720], [420, 720], [760, 720],
  ];
  for (const [x, y] of windows) fillRect(x, y, x + 7, y + 10, SUN);
}

function drawPalm(bx, by, lean, mirror) {
  const s = mirror ? -1 : 1;
  const topX = bx + lean;
  const topY = by - 190;
  // Trunk: a tapered quad leaning toward the top.
  fillPolygon(taperedQuad(bx, by, topX, topY, 16, 10), SILHOUETTE);
  // Five fronds drooping from the crown.
  const fronds = [
    [-150, -30], [-110, -80], [-40, -105], [50, -95], [130, -45],
  ];
  for (const [fx, fy] of fronds) {
    const tipX = topX + fx * s;
    const tipY = topY + fy + 85;
    fillPolygon(taperedQuad(topX, topY, tipX, tipY, 14, 2), SILHOUETTE);
  }
  // Coconuts.
  fillCircle(topX - 8 * s, topY + 12, 7, SILHOUETTE);
  fillCircle(topX + 8 * s, topY + 14, 7, SILHOUETTE);
}

function drawRoad() {
  fillRect(0, 760, W, SCENE_BOT, ROAD);
  // Pink centre dashes.
  for (let x = 20; x < W; x += 90) {
    fillRect(x, 806, x + 52, 814, PINK);
  }
}

function drawCar() {
  // Hot pink convertible, nose to the right, on the road.
  fillPolygon(
    [300, 812, 312, 786, 372, 772, 430, 770, 470, 786, 690, 786, 716, 812],
    PINK
  );
  // Windshield.
  fillPolygon([392, 776, 428, 774, 462, 788, 396, 788], [135, 206, 235]);
  // Wheels.
  fillCircle(382, 814, 26, BLACK);
  fillCircle(382, 814, 10, [120, 120, 130]);
  fillCircle(640, 814, 26, BLACK);
  fillCircle(640, 814, 10, [120, 120, 130]);
  // Headlight.
  fillCircle(706, 800, 8, SUN);
}

function drawGhost() {
  const cx = 600;
  const top = 668;
  const bottom = 786;
  // Body: dome plus straight sides.
  fillCircle(cx, top + 40, 42, WHITE);
  fillRect(cx - 42, top + 40, cx + 42, bottom - 12, WHITE);
  // Wavy hem: three background-coloured scoops along the bottom edge.
  fillCircle(cx - 28, bottom - 4, 14, PINK);
  fillCircle(cx, bottom - 4, 14, PINK);
  fillCircle(cx + 28, bottom - 4, 14, PINK);
  // The hem scoops cut into the car body behind the ghost, so repaint the
  // car's top edge where the ghost sits: the ghost floats just above it.
  // Sparkle eyes: black ovals with a white glint.
  fillEllipse(cx - 17, top + 38, 8, 11, BLACK);
  fillEllipse(cx + 17, top + 38, 8, 11, BLACK);
  fillCircle(cx - 19, top + 33, 3, WHITE);
  fillCircle(cx + 15, top + 33, 3, WHITE);
  // Little arm reaching up to the star coin.
  fillPolygon(taperedQuad(cx + 34, top + 66, cx + 66, top + 30, 12, 8), WHITE);
  // Magenta star coin, held high, with a white rim so it reads on the sky.
  fillStar(cx + 76, top + 22, 30, WHITE);
  fillStar(cx + 76, top + 22, 26, MAGENTA);
  fillStar(cx + 76, top + 22, 12, PINK);
}

function drawBillboard() {
  // Pole and panel on the right of the road.
  fillRect(852, 560, 864, 760, SILHOUETTE);
  fillRect(780, 512, 1000, 640, CREAM);
  fillRect(780, 512, 1000, 520, SILHOUETTE);
  fillRect(780, 632, 1000, 640, SILHOUETTE);
  fillRect(780, 512, 788, 640, SILHOUETTE);
  fillRect(992, 512, 1000, 640, SILHOUETTE);
  drawText("MAKE.FUN", 890, 556, 4, MAGENTA);
}

function drawMeme() {
  fillRect(0, 0, W, TOP_BAR, BLACK);
  fillRect(0, SCENE_BOT, W, H, BLACK);
  drawSky();
  drawSun();
  drawSkyline();
  drawPalm(96, 762, 26, false);
  drawBillboard();
  drawRoad();
  drawCar();
  drawGhost();
  // Captions, large enough to read when the picture is shrunk to 480 px.
  drawText("WAITED 13 YEARS", 512, 26, 8, WHITE);
  drawText("FOR GTA 6", 512, 98, 8, WHITE);
  drawText("CALLED IN SICK.", 512, 872, 7, WHITE);
  drawText("SEE YOU IN LEONIDA.", 512, 938, 7, WHITE);
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  // The gate reads POST.json from /output: copy it from the repository.
  const postPath = join(BOT_DIR, "POST.json");
  const postText = readFileSync(postPath, "utf8");
  const post = JSON.parse(postText);
  if (typeof post !== "object" || post === null || typeof post.url !== "string") {
    console.error("POST.json must be a JSON object with a url string");
    process.exit(1);
  }
  writeFileSync(join(OUTPUT_DIR, "POST.json"), postText);
  // Render the meme picture deterministically.
  drawMeme();
  writeFileSync(join(OUTPUT_DIR, "entry.png"), encodePNG());
  console.log("wrote POST.json and entry.png (1024x1024) to " + OUTPUT_DIR);
}

main();
