// Procedural world: terrain fields, cached ground chunks with persistent decals
// (track marks, scorch marks, rubble), static props and a navigation flow field.

import { makeNoise, makeRng, clamp, lerp, smoothstep, makeCanvas, TAU, shade } from './util.js';
import { Body } from './physics.js';
import { drawSprite, roofSprite, S } from './sprites.js';

export const WORLD_W = 6400;
export const WORLD_H = 6400;
export const TILE = 32;
const CHUNK = 512;
const MAX_CHUNKS = 72;

export const T = {
  DEEP: 0,
  SHALLOW: 1,
  SAND: 2,
  GRASS: 3,
  FOREST: 4,
  DIRT: 5,
  ROAD: 6,
  ROCKY: 7,
  CONCRETE: 8,
  BRIDGE: 9,
  DRY: 10,
};

// Per-terrain handling: grip multiplies lateral friction, drag slows tracks.
export const TERRAIN_PROPS = {
  [T.DEEP]: { grip: 0.3, drag: 3, dust: null },
  [T.SHALLOW]: { grip: 0.55, drag: 1.9, dust: 'water' },
  [T.SAND]: { grip: 0.62, drag: 1.25, dust: '#cdb27c' },
  [T.GRASS]: { grip: 0.85, drag: 1.0, dust: '#7a6a45' },
  [T.FOREST]: { grip: 0.8, drag: 1.1, dust: '#5a4a30' },
  [T.DIRT]: { grip: 0.75, drag: 1.05, dust: '#9a7a52' },
  [T.ROAD]: { grip: 1.0, drag: 0.8, dust: null },
  [T.ROCKY]: { grip: 0.9, drag: 1.1, dust: '#8f8a80' },
  [T.CONCRETE]: { grip: 1.0, drag: 0.85, dust: null },
  [T.BRIDGE]: { grip: 1.0, drag: 0.8, dust: null },
  [T.DRY]: { grip: 0.75, drag: 1.05, dust: '#b8a670' },
};

const COLORS = {
  deep: [24, 66, 96],
  deeper: [14, 46, 72],
  shallow: [58, 128, 138],
  sand: [214, 190, 138],
  wetSand: [170, 150, 105],
  grass: [96, 138, 58],
  grassLight: [122, 160, 70],
  forest: [58, 98, 44],
  dry: [168, 158, 90],
  rocky: [128, 122, 108],
  dirt: [134, 106, 72],
  concrete: [150, 148, 140],
};

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export class World {
  constructor(seed, sprites, physics) {
    this.seed = seed;
    this.sprites = sprites;
    this.physics = physics;
    this.cols = WORLD_W / TILE;
    this.rows = WORLD_H / TILE;
    this.tiles = new Uint8Array(this.cols * this.rows);
    this.elev = makeNoise(seed);
    this.moist = makeNoise(seed + 101);
    this.riverN = makeNoise(seed + 202);
    this.detailN = makeNoise(seed + 303);
    this.warpN = makeNoise(seed + 404);
    this.rng = makeRng(seed);
    this.chunks = new Map();
    this.decals = new Map(); // chunk key -> list of decal ops (replayed on regen)
    this.props = [];
    this.roads = [];
    this.bases = [];
    this.spawn = { x: WORLD_W / 2, y: WORLD_H / 2 };
    this.time = 0;
    this._makeDetailTexture();
  }

  // --- Terrain fields --------------------------------------------------------------

  field(x, y) {
    // Domain warp gives more organic coastlines.
    const wx = x + (this.warpN.fbm(x * 0.0012, y * 0.0012, 3) - 0.5) * 380;
    const wy = y + (this.warpN.fbm(x * 0.0012 + 50, y * 0.0012 + 50, 3) - 0.5) * 380;
    let e = this.elev.fbm(wx * 0.00042, wy * 0.00042, 5);
    e = (e - 0.5) * 1.6 + 0.55;
    // Sea around the world edges.
    const ex = Math.min(x, WORLD_W - x), ey = Math.min(y, WORLD_H - y);
    const edge = Math.min(ex, ey);
    e -= (1 - smoothstep(120, 700, edge)) * 0.5;
    // Keep the spawn area dry and open.
    const dc = Math.hypot(x - this.spawn.x, y - this.spawn.y);
    e = lerp(e, clamp(e, 0.47, 0.62), 1 - smoothstep(300, 1100, dc));
    const m = this.moist.fbm(wx * 0.0006 + 9, wy * 0.0006 + 9, 4);
    // River: thin band where ridged noise crosses 0.5.
    const rn = Math.abs(this.riverN.fbm(wx * 0.00055, wy * 0.00055, 4) - 0.5);
    const riverStrength = (1 - smoothstep(0.012, 0.03, rn)) * smoothstep(0.42, 0.5, e) * (1 - smoothstep(0.75, 0.85, e));
    const riverCore = 1 - smoothstep(0.0, 0.016, rn);
    return { e, m, river: riverStrength, riverCore: riverCore * smoothstep(0.42, 0.5, e) * (1 - smoothstep(0.78, 0.86, e)), dc };
  }

  classify(f) {
    if (f.e < 0.34) return T.DEEP;
    if (f.river > 0.5 && f.riverCore > 0.35 && f.dc > 500) return T.DEEP;
    if (f.e < 0.37 || (f.river > 0.4 && f.dc > 500)) return T.SHALLOW;
    if (f.e < 0.405) return T.SAND;
    if (f.e > 0.74) return T.ROCKY;
    if (f.m < 0.4) return f.m < 0.33 ? T.SAND : T.DRY;
    if (f.m > 0.57) return T.FOREST;
    return T.GRASS;
  }

  colorFor(f) {
    const { e, m } = f;
    let c;
    if (e < 0.37) {
      const d = smoothstep(0.37, 0.25, e);
      c = d > 0.15 ? mix(COLORS.deep, COLORS.deeper, clamp((d - 0.15) * 1.3, 0, 1)) : mix(COLORS.shallow, COLORS.deep, d / 0.15);
    } else {
      // Land colour from moisture, with beach and rock transitions.
      let land;
      if (m < 0.4) land = mix(COLORS.sand, COLORS.dry, smoothstep(0.3, 0.4, m));
      else if (m < 0.57) land = mix(COLORS.dry, COLORS.grass, smoothstep(0.4, 0.47, m));
      else land = mix(COLORS.grass, COLORS.forest, smoothstep(0.55, 0.63, m));
      land = mix(land, COLORS.grassLight, smoothstep(0.45, 0.55, m) * (1 - smoothstep(0.55, 0.6, m)) * 0.4);
      land = mix(land, COLORS.rocky, smoothstep(0.68, 0.78, e));
      const beach = 1 - smoothstep(0.37, 0.415, e);
      land = mix(land, e < 0.385 ? COLORS.wetSand : COLORS.sand, beach);
      c = land;
    }
    // River overlay
    if (f.river > 0.01 && f.dc > 500) {
      const water = f.riverCore > 0.35 ? COLORS.deep : COLORS.shallow;
      const bank = mix(c, COLORS.wetSand, smoothstep(0.0, 0.25, f.river));
      c = mix(bank, water, smoothstep(0.25, 0.55, f.river));
    }
    return c;
  }

  _makeDetailTexture() {
    const N = 256;
    this.detail = new Float32Array(N * N);
    const r = makeRng(this.seed + 9);
    const n = makeNoise(this.seed + 77);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        // Tileable-ish mix of blotchy noise and grain.
        const v = n.fbm(x / 24, y / 24, 3) * 0.6 + r() * 0.4;
        this.detail[y * N + x] = v - 0.5;
      }
  }

  tileAt(x, y) {
    const c = (x / TILE) | 0, r = (y / TILE) | 0;
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return T.DEEP;
    return this.tiles[r * this.cols + c];
  }

  setTile(c, r, t) {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return;
    this.tiles[r * this.cols + c] = t;
  }

  isWater(x, y) {
    const t = this.tileAt(x, y);
    return t === T.DEEP || t === T.SHALLOW;
  }

  // --- Generation ------------------------------------------------------------------

  generate() {
    const { cols, rows } = this;
    this.fieldCache = new Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const f = this.field(c * TILE + TILE / 2, r * TILE + TILE / 2);
        this.tiles[r * cols + c] = this.classify(f);
      }
    }
    this.occupied = new Uint8Array(cols * rows);
    this._placeBases();
    this._buildRoads();
    this._placeVillages();
    this._placeNature();
    this._buildWaterColliders();
    this.buildFlowGrid();
  }

  _landScore(x, y, r) {
    // Fraction of dry, unoccupied tiles in a square.
    let good = 0, total = 0;
    for (let yy = y - r; yy <= y + r; yy += TILE)
      for (let xx = x - r; xx <= x + r; xx += TILE) {
        total++;
        const t = this.tileAt(xx, yy);
        const c = (xx / TILE) | 0, rr = (yy / TILE) | 0;
        if (t !== T.DEEP && t !== T.SHALLOW && t !== T.BRIDGE && !this.occupied[rr * this.cols + c]) good++;
      }
    return good / total;
  }

  _occupy(x, y, w, h, val = 1) {
    const c0 = Math.floor((x - w / 2) / TILE), c1 = Math.floor((x + w / 2) / TILE);
    const r0 = Math.floor((y - h / 2) / TILE), r1 = Math.floor((y + h / 2) / TILE);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) if (c >= 0 && r >= 0 && c < this.cols && r < this.rows) this.occupied[r * this.cols + c] = val;
  }

  _isFree(x, y, w, h) {
    const c0 = Math.floor((x - w / 2) / TILE), c1 = Math.floor((x + w / 2) / TILE);
    const r0 = Math.floor((y - h / 2) / TILE), r1 = Math.floor((y + h / 2) / TILE);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return false;
        if (this.occupied[r * this.cols + c]) return false;
        const t = this.tiles[r * this.cols + c];
        if (t === T.DEEP || t === T.SHALLOW || t === T.BRIDGE) return false;
      }
    return true;
  }

  _placeBases() {
    const rng = this.rng;
    const sx = this.spawn.x, sy = this.spawn.y;
    // Keep the spawn clear.
    this._occupy(sx, sy, 360, 360, 2);
    const want = 7;
    let tries = 0;
    while (this.bases.length < want && tries++ < 4000) {
      const x = rng.range(700, WORLD_W - 700), y = rng.range(700, WORLD_H - 700);
      if (Math.hypot(x - sx, y - sy) < 1300) continue;
      if (this.bases.some((b) => Math.hypot(b.x - x, b.y - y) < 1500)) continue;
      if (this._landScore(x, y, 300) < 0.97) continue;
      this._makeBase(x, y);
    }
  }

  _makeBase(x, y) {
    const rng = this.rng;
    const w = rng.range(460, 600), h = rng.range(380, 500);
    const base = { x, y, w, h, turrets: [], buildings: [], destroyed: false, id: this.bases.length };
    this.bases.push(base);
    // Concrete pad
    for (let yy = y - h / 2; yy <= y + h / 2; yy += TILE)
      for (let xx = x - w / 2; xx <= x + w / 2; xx += TILE) this.setTile((xx / TILE) | 0, (yy / TILE) | 0, T.CONCRETE);
    this._occupy(x, y, w + 60, h + 60);
    // Sandbag perimeter with gaps for entrances.
    const segs = [];
    const perim = (x0, y0, x1, y1) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.floor(len / 56);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        if (Math.abs(t - 0.5) < 0.12) continue; // gate
        segs.push([lerp(x0, x1, t), lerp(y0, y1, t), Math.atan2(y1 - y0, x1 - x0)]);
      }
    };
    const m = 10;
    perim(x - w / 2 - m, y - h / 2 - m, x + w / 2 + m, y - h / 2 - m);
    perim(x + w / 2 + m, y - h / 2 - m, x + w / 2 + m, y + h / 2 + m);
    perim(x + w / 2 + m, y + h / 2 + m, x - w / 2 - m, y + h / 2 + m);
    perim(x - w / 2 - m, y + h / 2 + m, x - w / 2 - m, y - h / 2 - m);
    for (const [px, py, a] of segs) this.addProp('sandbag', px, py, { angle: a });

    // Buildings (2-4) in the inner area.
    const nb = rng.int(2, 4);
    for (let i = 0, tries = 0; i < nb && tries < 50; tries++) {
      const bw = rng.range(80, 150), bh = rng.range(70, 130);
      const bx = x + rng.range(-w / 2 + bw / 2 + 30, w / 2 - bw / 2 - 30);
      const by = y + rng.range(-h / 2 + bh / 2 + 30, h / 2 - bh / 2 - 30);
      if (base.buildings.some((b) => Math.abs(b.x - bx) < (b.w + bw) / 2 + 40 && Math.abs(b.y - by) < (b.h + bh) / 2 + 40)) continue;
      const p = this.addProp('building', bx, by, { w: bw, h: bh, height: rng.range(40, 80), palette: rng.pick(['#8a8478', '#7d8288', '#9a8c74']) });
      p.base = base;
      base.buildings.push(p);
      i++;
    }
    // Turret spots near corners and middle.
    const spots = [
      [x - w / 2 + 50, y - h / 2 + 50],
      [x + w / 2 - 50, y - h / 2 + 50],
      [x - w / 2 + 50, y + h / 2 - 50],
      [x + w / 2 - 50, y + h / 2 - 50],
    ];
    const nt = rng.int(2, 4);
    for (let i = 0; i < nt; i++) {
      const [tx, ty] = spots.splice(rng.int(0, spots.length - 1), 1)[0];
      base.turrets.push({ x: tx, y: ty });
    }
    // Explosive barrels and supply crates.
    for (let i = 0; i < rng.int(6, 12); i++) {
      const cx = x + rng.range(-w / 2 + 30, w / 2 - 30), cy = y + rng.range(-h / 2 + 30, h / 2 - 30);
      if (base.buildings.some((b) => Math.abs(b.x - cx) < b.w / 2 + 20 && Math.abs(b.y - cy) < b.h / 2 + 20)) continue;
      const cluster = rng.int(2, 5);
      for (let k = 0; k < cluster; k++) {
        this.addProp(rng.chance(0.55) ? 'barrel' : 'crate', cx + rng.range(-25, 25), cy + rng.range(-25, 25), { angle: rng.range(0, TAU) });
      }
    }
  }

  // Roads as Catmull-Rom splines from spawn to each base, bridging water.
  _buildRoads() {
    const rng = this.rng;
    // Ring road through every base (ordered by angle around spawn), plus
    // spur roads from the spawn to the two nearest bases.
    const sx = this.spawn.x, sy = this.spawn.y;
    const targets = this.bases.map((b) => [b.x, b.y]).sort((a, b) => Math.atan2(a[1] - sy, a[0] - sx) - Math.atan2(b[1] - sy, b[0] - sx));
    const links = [];
    for (let i = 0; i < targets.length; i++) links.push([targets[i], targets[(i + 1) % targets.length]]);
    const byDist = [...targets].sort((a, b) => Math.hypot(a[0] - sx, a[1] - sy) - Math.hypot(b[0] - sx, b[1] - sy));
    for (const t of byDist.slice(0, 2)) links.push([[sx, sy], t]);
    for (const [a, b] of links) {
      const pts = [a];
      const n = 3;
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const px = lerp(a[0], b[0], t), py = lerp(a[1], b[1], t);
        const nx = -(b[1] - a[1]), ny = b[0] - a[0];
        const nl = Math.hypot(nx, ny);
        const off = rng.range(-0.18, 0.18) * Math.hypot(b[0] - a[0], b[1] - a[1]);
        pts.push([px + (nx / nl) * off, py + (ny / nl) * off]);
      }
      pts.push(b);
      const spline = [];
      const P = (i) => pts[clamp(i, 0, pts.length - 1)];
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
        const seg = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
        const steps = Math.ceil(seg / 16);
        for (let s = 0; s < steps; s++) {
          const t = s / steps, t2 = t * t, t3 = t2 * t;
          const cr = (k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
          spline.push([cr(0), cr(1)]);
        }
      }
      spline.push(b);
      const road = { pts: spline, width: 44, bridges: [] };
      // Rasterise road into tiles; water becomes bridge.
      let inWater = false, bStart = null;
      for (let i = 0; i < spline.length; i++) {
        const [x, y] = spline[i];
        const t0 = this.tileAt(x, y);
        const water = t0 === T.DEEP || t0 === T.SHALLOW || t0 === T.BRIDGE;
        if (water && !inWater) bStart = i;
        if (!water && inWater) road.bridges.push([Math.max(0, bStart - 2), Math.min(spline.length - 1, i + 2)]);
        inWater = water;
        const rr = road.width / 2;
        for (let yy = y - rr; yy <= y + rr; yy += TILE / 2)
          for (let xx = x - rr; xx <= x + rr; xx += TILE / 2) {
            if (Math.hypot(xx - x, yy - y) > rr) continue;
            const c = (xx / TILE) | 0, r = (yy / TILE) | 0;
            const t = this.tileAt(xx, yy);
            if (t === T.CONCRETE) continue;
            this.setTile(c, r, water || t === T.DEEP || t === T.SHALLOW || t === T.BRIDGE ? T.BRIDGE : T.ROAD);
          }
        this._occupy(x, y, 40, 40, 3);
      }
      this.roads.push(road);
    }
  }

  _placeVillages() {
    const rng = this.rng;
    // Ruined houses scattered along roads.
    for (const road of this.roads) {
      for (let i = 20; i < road.pts.length - 20; i += rng.int(18, 40)) {
        if (!rng.chance(0.35)) continue;
        const [x, y] = road.pts[i];
        const [x2, y2] = road.pts[i + 1];
        const a = Math.atan2(y2 - y, x2 - x);
        const side = rng.chance(0.5) ? 1 : -1;
        const off = rng.range(80, 120);
        const hx = x + Math.cos(a + (side * Math.PI) / 2) * off;
        const hy = y + Math.sin(a + (side * Math.PI) / 2) * off;
        const bw = rng.range(50, 80), bh = rng.range(45, 70);
        if (!this._isFree(hx, hy, bw + 20, bh + 20)) continue;
        if (Math.hypot(hx - this.spawn.x, hy - this.spawn.y) < 400) continue;
        this.addProp('building', hx, hy, { w: bw, h: bh, height: rng.range(25, 45), palette: rng.pick(['#a8765a', '#9a6a4a', '#b0886a', '#8a7a6a']) });
        this._occupy(hx, hy, bw + 30, bh + 30);
        // Crates and a barrel nearby.
        for (let k = 0; k < rng.int(0, 3); k++) this.addProp(rng.chance(0.7) ? 'crate' : 'barrel', hx + rng.range(-50, 50), hy + rng.range(-50, 50), { angle: rng.range(0, TAU) });
      }
    }
  }

  _placeNature() {
    const rng = this.rng;
    const S2 = 40;
    for (let y = S2; y < WORLD_H - S2; y += S2) {
      for (let x = S2; x < WORLD_W - S2; x += S2) {
        const px = x + rng.range(-16, 16), py = y + rng.range(-16, 16);
        const c = (px / TILE) | 0, r = (py / TILE) | 0;
        if (this.occupied[r * this.cols + c]) continue;
        const t = this.tiles[r * this.cols + c];
        const clump = this.detailN.fbm(px * 0.004, py * 0.004, 2);
        let p = 0, kind = null;
        if (t === T.FOREST) { p = 0.32 + clump * 0.3; kind = rng.chance(0.25) ? 'pine' : 'tree'; }
        else if (t === T.GRASS) { p = clump > 0.6 ? 0.18 : 0.02; kind = 'tree'; }
        else if (t === T.DRY) { p = 0.012; kind = 'tree'; }
        if (kind && rng.chance(p)) {
          this.addProp(kind, px, py, {});
          this._occupy(px, py, 20, 20);
          continue;
        }
        // Bushes
        const bp = t === T.FOREST ? 0.12 : t === T.GRASS ? 0.06 : t === T.DRY ? 0.05 : t === T.SAND ? 0.008 : 0;
        if (rng.chance(bp)) {
          this.addProp('bush', px, py, {});
          continue;
        }
        // Rocks
        const rp = t === T.ROCKY ? 0.045 : t === T.SAND || t === T.DRY ? 0.012 : 0.004;
        if (rng.chance(rp)) {
          this.addProp('rock', px, py, {});
          this._occupy(px, py, 40, 40);
        }
      }
    }
    // Scattered crates/barrels in the open for pickups and chain reactions.
    for (let i = 0; i < 70; i++) {
      const x = rng.range(300, WORLD_W - 300), y = rng.range(300, WORLD_H - 300);
      if (!this._isFree(x, y, 60, 60)) continue;
      const n = rng.int(1, 4);
      const type = rng.chance(0.5) ? 'barrel' : 'crate';
      for (let k = 0; k < n; k++) this.addProp(type, x + rng.range(-22, 22), y + rng.range(-22, 22), { angle: rng.range(0, TAU) });
    }
  }

  _buildWaterColliders() {
    // Static boxes on deep water tiles that touch land so tanks stay ashore.
    const { cols, rows } = this;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (this.tiles[r * cols + c] !== T.DEEP) continue;
        let edge = false;
        for (let dy = -1; dy <= 1 && !edge; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const t = this.tileAt((c + dx) * TILE + 1, (r + dy) * TILE + 1);
            if (t !== T.DEEP) { edge = true; break; }
          }
        if (!edge) continue;
        const b = new Body({ shape: 'box', x: c * TILE + TILE / 2, y: r * TILE + TILE / 2, hw: TILE / 2, hh: TILE / 2, isStatic: true, friction: 0.2, restitution: 0.1 });
        b.kind = 'water';
        this.physics.add(b);
      }
    }
  }

  // --- Props ---------------------------------------------------------------------------

  addProp(type, x, y, o) {
    const rng = this.rng;
    const sp = this.sprites;
    const p = { type, x, y, angle: o.angle ?? 0, alive: true, hp: 1, body: null, height: 0 };
    let body = null;
    switch (type) {
      case 'tree': {
        p.spr = rng.pick(sp.trees);
        p.radius = p.spr.w / 2 - 4;
        p.height = 30 + p.radius;
        p.hp = 40;
        body = new Body({ shape: 'circle', x, y, r: 9, isStatic: true, friction: 0.4 });
        break;
      }
      case 'pine': {
        p.spr = rng.pick(sp.pines);
        p.radius = p.spr.w / 2 - 3;
        p.height = 40 + p.radius;
        p.hp = 40;
        p.angle = rng.range(0, TAU);
        body = new Body({ shape: 'circle', x, y, r: 8, isStatic: true, friction: 0.4 });
        break;
      }
      case 'bush': {
        p.spr = rng.pick(sp.bushes);
        p.angle = rng.range(0, TAU);
        p.hp = 5;
        body = new Body({ shape: 'circle', x, y, r: 10, isStatic: true });
        p.crushable = true;
        break;
      }
      case 'rock': {
        p.spr = rng.pick(sp.rocks);
        p.angle = rng.range(0, TAU);
        p.hp = Infinity;
        body = new Body({ shape: 'circle', x, y, r: p.spr.w / 2 - 7, isStatic: true, friction: 0.3, restitution: 0.3 });
        break;
      }
      case 'crate': {
        p.spr = sp.crate;
        p.hp = 15;
        body = new Body({ shape: 'box', x, y, angle: p.angle, hw: 11, hh: 11, mass: 4, linearDrag: 1.5, angularDrag: 3, groundFriction: 260, restitution: 0.25, friction: 0.5 });
        break;
      }
      case 'barrel': {
        p.spr = sp.barrel;
        p.hp = 10;
        p.explosive = true;
        body = new Body({ shape: 'circle', x, y, r: 9, mass: 3, linearDrag: 1.2, angularDrag: 2, groundFriction: 220, restitution: 0.35, friction: 0.4 });
        break;
      }
      case 'sandbag': {
        p.spr = sp.sandbag;
        p.hp = 60;
        body = new Body({ shape: 'box', x, y, angle: p.angle, hw: 28, hh: 6, isStatic: true, friction: 0.6 });
        break;
      }
      case 'building': {
        p.w = o.w;
        p.h = o.h;
        p.height = o.height;
        p.palette = o.palette;
        p.hp = 160 + o.w * o.h * 0.02;
        p.maxHp = p.hp;
        p.roof = roofSprite(Math.round(o.w), Math.round(o.h), Math.floor(rng() * 1e6), o.palette);
        body = new Body({ shape: 'box', x, y, hw: o.w / 2, hh: o.h / 2, isStatic: true, friction: 0.3, restitution: 0.1 });
        break;
      }
    }
    if (body) {
      body.kind = 'prop';
      body.owner = p;
      p.body = body;
      this.physics.add(body);
    }
    p.maxHp = p.maxHp ?? p.hp;
    this.props.push(p);
    return p;
  }

  // --- Navigation flow field ----------------------------------------------------------

  buildFlowGrid() {
    const C = 64;
    this.flowC = C;
    this.flowCols = WORLD_W / C;
    this.flowRows = WORLD_H / C;
    this.blocked = new Uint8Array(this.flowCols * this.flowRows);
    for (let r = 0; r < this.flowRows; r++)
      for (let c = 0; c < this.flowCols; c++) {
        let water = 0;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) if (this.tileAt(c * C + dx * 32 + 16, r * C + dy * 32 + 16) === T.DEEP) water++;
        if (water >= 2) this.blocked[r * this.flowCols + c] = 1;
      }
    for (const p of this.props) this._markBlocked(p, 1);
    this.flow = new Int32Array(this.flowCols * this.flowRows);
  }

  _markBlocked(p, v) {
    if (p.type !== 'building' && p.type !== 'rock') return;
    const C = this.flowC;
    const hw = p.type === 'building' ? p.w / 2 : p.body.r;
    const hh = p.type === 'building' ? p.h / 2 : p.body.r;
    for (let y = p.y - hh; y <= p.y + hh; y += C / 2)
      for (let x = p.x - hw; x <= p.x + hw; x += C / 2) {
        const c = (x / C) | 0, r = (y / C) | 0;
        if (c >= 0 && r >= 0 && c < this.flowCols && r < this.flowRows) this.blocked[r * this.flowCols + c] = v;
      }
  }

  // BFS distance field from target; enemies follow decreasing distance.
  updateFlow(tx, ty) {
    const { flowCols: W, flowRows: H, blocked, flow } = this;
    flow.fill(-1);
    const C = this.flowC;
    const sc = clamp((tx / C) | 0, 0, W - 1), sr = clamp((ty / C) | 0, 0, H - 1);
    const q = this._queue || (this._queue = new Int32Array(W * H));
    let head = 0, tail = 0;
    const start = sr * W + sc;
    flow[start] = 0;
    q[tail++] = start;
    while (head < tail) {
      const i = q[head++];
      const c = i % W, r = (i / W) | 0;
      const d = flow[i] + 1;
      if (c > 0 && flow[i - 1] < 0 && !blocked[i - 1]) { flow[i - 1] = d; q[tail++] = i - 1; }
      if (c < W - 1 && flow[i + 1] < 0 && !blocked[i + 1]) { flow[i + 1] = d; q[tail++] = i + 1; }
      if (r > 0 && flow[i - W] < 0 && !blocked[i - W]) { flow[i - W] = d; q[tail++] = i - W; }
      if (r < H - 1 && flow[i + W] < 0 && !blocked[i + W]) { flow[i + W] = d; q[tail++] = i + W; }
    }
  }

  // Direction to move from (x,y) following the flow field, or null.
  flowDir(x, y) {
    const { flowCols: W, flowRows: H, flow } = this;
    const C = this.flowC;
    const c = clamp((x / C) | 0, 0, W - 1), r = clamp((y / C) | 0, 0, H - 1);
    const here = flow[r * W + c];
    let best = here < 0 ? Infinity : here, bx = 0, by = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const cc = c + dx, rr = r + dy;
        if (cc < 0 || rr < 0 || cc >= W || rr >= H) continue;
        const v = flow[rr * W + cc];
        if (v < 0) continue;
        // Avoid cutting blocked corners on diagonals.
        if (dx && dy && (flow[r * W + cc] < 0 || flow[rr * W + c] < 0)) continue;
        const score = v + (dx && dy ? 0.4 : 0);
        if (score < best) { best = score; bx = dx; by = dy; }
      }
    if (!bx && !by) return null;
    const l = Math.hypot(bx, by);
    return [bx / l, by / l];
  }

  findOpenSpot(x, y, minR, maxR, rng = Math.random) {
    for (let i = 0; i < 60; i++) {
      const a = rng() * TAU, d = minR + rng() * (maxR - minR);
      const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
      if (px < 200 || py < 200 || px > WORLD_W - 200 || py > WORLD_H - 200) continue;
      const t = this.tileAt(px, py);
      if (t === T.DEEP || t === T.SHALLOW) continue;
      const near = this.physics.query(px, py, 50);
      if (near.some((b) => b.isStatic && b.kind !== 'prop' ? true : b.owner && (b.owner.type === 'building' || b.owner.type === 'rock'))) continue;
      const C = this.flowC;
      if (this.flow[((py / C) | 0) * this.flowCols + ((px / C) | 0)] < 0) continue;
      return [px, py];
    }
    return null;
  }

  // --- Ground chunks & decals ------------------------------------------------------------

  _chunkKey(cx, cy) {
    return cy * 1000 + cx;
  }

  _renderChunk(cx, cy) {
    const canvas = makeCanvas(CHUNK, CHUNK);
    const g = canvas.getContext('2d');
    const img = g.createImageData(CHUNK, CHUNK);
    const d = img.data;
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    // Coarse colour grid (every 8px) interpolated per pixel plus detail texture.
    const STEP = 8, GN = CHUNK / STEP + 1;
    const grid = new Float32Array(GN * GN * 3);
    const waterGrid = new Float32Array(GN * GN);
    for (let gy = 0; gy < GN; gy++)
      for (let gx = 0; gx < GN; gx++) {
        const f = this.field(x0 + gx * STEP, y0 + gy * STEP);
        const col = this.colorFor(f);
        const i = (gy * GN + gx) * 3;
        grid[i] = col[0];
        grid[i + 1] = col[1];
        grid[i + 2] = col[2];
        waterGrid[gy * GN + gx] = f.e < 0.37 || (f.river > 0.4 && f.dc > 500) ? 1 : 0;
      }
    const det = this.detail;
    for (let py = 0; py < CHUNK; py++) {
      const gy = py / STEP, iy = gy | 0, fy = gy - iy;
      for (let px = 0; px < CHUNK; px++) {
        const gx = px / STEP, ix = gx | 0, fx = gx - ix;
        const i00 = (iy * GN + ix) * 3, i10 = i00 + 3, i01 = i00 + GN * 3, i11 = i01 + 3;
        const wx = x0 + px, wy = y0 + py;
        const w = waterGrid[iy * GN + ix];
        const dA = det[((wy & 255) << 8) | (wx & 255)];
        const dB = det[(((wy >> 2) & 255) << 8) | ((wx >> 2) & 255)];
        const k = (w ? 10 : 34) * dA + (w ? 12 : 22) * dB;
        const o = (py * CHUNK + px) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const a = grid[i00 + ch] + (grid[i10 + ch] - grid[i00 + ch]) * fx;
          const b = grid[i01 + ch] + (grid[i11 + ch] - grid[i01 + ch]) * fx;
          d[o + ch] = a + (b - a) * fy + k * (ch === 2 && !w ? 0.6 : 1);
        }
        d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    g.save();
    g.translate(-x0, -y0);
    this._paintGroundDetails(g, x0, y0);
    this._paintRoads(g, x0, y0);
    this._paintBasePads(g, x0, y0);
    // Replay persistent decals for this chunk.
    const list = this.decals.get(this._chunkKey(cx, cy));
    if (list) for (const op of list) this._drawDecal(g, op);
    g.restore();
    return canvas;
  }

  _paintGroundDetails(g, x0, y0) {
    // Grass tufts, pebbles and sand ripples seeded per chunk.
    const r = makeRng((x0 * 7 + y0 * 13) ^ this.seed);
    for (let i = 0; i < 260; i++) {
      const x = x0 + r() * CHUNK, y = y0 + r() * CHUNK;
      const t = this.tileAt(x, y);
      if (t === T.GRASS || t === T.FOREST) {
        g.strokeStyle = r() < 0.5 ? 'rgba(40,70,20,0.45)' : 'rgba(150,190,90,0.35)';
        g.lineWidth = 1;
        g.beginPath();
        for (let k = 0; k < 4; k++) {
          const a = -Math.PI / 2 + (r() - 0.5) * 1.4;
          g.moveTo(x + k * 1.5, y);
          g.lineTo(x + k * 1.5 + Math.cos(a) * 4, y + Math.sin(a) * 4);
        }
        g.stroke();
      } else if (t === T.SAND || t === T.DRY) {
        if (r() < 0.4) {
          g.strokeStyle = 'rgba(120,95,50,0.18)';
          g.lineWidth = 1.5;
          g.beginPath();
          g.arc(x, y + 20, 22, -Math.PI * 0.75, -Math.PI * 0.25);
          g.stroke();
        } else {
          g.fillStyle = 'rgba(90,75,50,0.4)';
          g.fillRect(x, y, 1.5, 1.5);
        }
      } else if (t === T.ROCKY) {
        g.fillStyle = r() < 0.5 ? 'rgba(70,65,55,0.5)' : 'rgba(200,195,180,0.35)';
        g.beginPath();
        g.arc(x, y, 1 + r() * 2.5, 0, TAU);
        g.fill();
      } else if (t === T.DEEP || t === T.SHALLOW) {
        if (r() < 0.25) {
          g.strokeStyle = 'rgba(200,240,255,0.10)';
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(x, y);
          g.quadraticCurveTo(x + 8, y - 3, x + 16, y);
          g.stroke();
        }
      }
    }
  }

  _paintRoads(g, x0, y0) {
    const pad = 80;
    for (const road of this.roads) {
      // Only roads touching this chunk.
      const pts = road.pts;
      let any = false;
      for (const [x, y] of pts) if (x > x0 - pad && x < x0 + CHUNK + pad && y > y0 - pad && y < y0 + CHUNK + pad) { any = true; break; }
      if (!any) continue;
      const path = () => {
        g.beginPath();
        g.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      };
      g.lineCap = 'round';
      g.lineJoin = 'round';
      // Gravel verge
      path();
      g.strokeStyle = 'rgba(120,105,80,0.55)';
      g.lineWidth = road.width + 12;
      g.stroke();
      // Asphalt
      path();
      g.strokeStyle = '#4a4844';
      g.lineWidth = road.width;
      g.stroke();
      path();
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.lineWidth = road.width - 14;
      g.stroke();
      // Edge lines
      path();
      g.strokeStyle = 'rgba(230,225,210,0.5)';
      g.lineWidth = road.width - 6;
      g.setLineDash([]);
      g.stroke();
      path();
      g.strokeStyle = '#4b4945';
      g.lineWidth = road.width - 9;
      g.stroke();
      // Centre dashes
      path();
      g.strokeStyle = 'rgba(240,200,60,0.75)';
      g.lineWidth = 2;
      g.setLineDash([18, 16]);
      g.stroke();
      g.setLineDash([]);
      // Bridges
      for (const [a, b] of road.bridges) {
        const seg = pts.slice(a, b + 1);
        if (seg.length < 2) continue;
        const bpath = () => {
          g.beginPath();
          g.moveTo(seg[0][0], seg[0][1]);
          for (let i = 1; i < seg.length; i++) g.lineTo(seg[i][0], seg[i][1]);
        };
        g.lineCap = 'butt';
        bpath();
        g.strokeStyle = 'rgba(0,0,0,0.35)';
        g.lineWidth = road.width + 22;
        g.stroke();
        bpath();
        g.strokeStyle = '#6b5a45';
        g.lineWidth = road.width + 14;
        g.stroke();
        bpath();
        g.strokeStyle = '#8a7356';
        g.lineWidth = road.width + 4;
        g.stroke();
        // Planks
        bpath();
        g.strokeStyle = 'rgba(50,35,20,0.5)';
        g.lineWidth = road.width + 4;
        g.setLineDash([2, 6]);
        g.stroke();
        g.setLineDash([]);
        // Rails
        for (const side of [-1, 1]) {
          g.beginPath();
          for (let i = 0; i < seg.length; i++) {
            const p = seg[i], q = seg[Math.min(i + 1, seg.length - 1)], pp = seg[Math.max(i - 1, 0)];
            const ang = Math.atan2(q[1] - pp[1], q[0] - pp[0]);
            const ox = Math.cos(ang + Math.PI / 2) * (road.width / 2 + 7) * side;
            const oy = Math.sin(ang + Math.PI / 2) * (road.width / 2 + 7) * side;
            if (i === 0) g.moveTo(p[0] + ox, p[1] + oy);
            else g.lineTo(p[0] + ox, p[1] + oy);
          }
          g.strokeStyle = '#3d3225';
          g.lineWidth = 3;
          g.stroke();
        }
        g.lineCap = 'round';
      }
    }
  }

  _paintBasePads(g, x0, y0) {
    for (const b of this.bases) {
      if (b.x + b.w / 2 + 40 < x0 || b.x - b.w / 2 - 40 > x0 + CHUNK || b.y + b.h / 2 + 40 < y0 || b.y - b.h / 2 - 40 > y0 + CHUNK) continue;
      const x = b.x - b.w / 2, y = b.y - b.h / 2;
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x - 4, y - 4, b.w + 8, b.h + 8);
      g.fillStyle = '#8e8c84';
      g.fillRect(x, y, b.w, b.h);
      // Slabs
      g.strokeStyle = 'rgba(0,0,0,0.18)';
      g.lineWidth = 1;
      for (let xx = x; xx <= x + b.w; xx += 40) {
        g.beginPath();
        g.moveTo(xx, y);
        g.lineTo(xx, y + b.h);
        g.stroke();
      }
      for (let yy = y; yy <= y + b.h; yy += 40) {
        g.beginPath();
        g.moveTo(x, yy);
        g.lineTo(x + b.w, yy);
        g.stroke();
      }
      const r = makeRng(b.id + 99);
      for (let i = 0; i < 30; i++) {
        const sx = x + r() * b.w, sy = y + r() * b.h, sr = 5 + r() * 25;
        const sg = g.createRadialGradient(sx, sy, 0, sx, sy, sr);
        sg.addColorStop(0, `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},0.08)`);
        sg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = sg;
        g.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
      }
      // Helipad marking
      g.strokeStyle = 'rgba(240,200,60,0.6)';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(b.x, b.y, 46, 0, TAU);
      g.stroke();
      g.fillStyle = 'rgba(240,200,60,0.6)';
      g.font = 'bold 50px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('H', b.x, b.y + 2);
    }
  }

  _drawDecal(g, op) {
    if (op.t === 0) {
      // Sprite stamp
      g.globalAlpha = op.al;
      g.save();
      g.translate(op.x, op.y);
      g.rotate(op.a);
      g.drawImage(op.spr.img, (-op.spr.w / 2) * op.sc, (-op.spr.h / 2) * op.sc, op.spr.w * op.sc, op.spr.h * op.sc);
      g.restore();
      g.globalAlpha = 1;
    } else if (op.t === 1) {
      // Track mark segment: tread bars perpendicular to travel.
      const dx = op.x2 - op.x1, dy = op.y2 - op.y1;
      const len = Math.hypot(dx, dy);
      if (len < 0.01) return;
      const nx = -dy / len, ny = dx / len;
      g.fillStyle = op.c;
      g.globalAlpha = op.al;
      const hw = op.w / 2;
      g.beginPath();
      g.moveTo(op.x1 + nx * hw, op.y1 + ny * hw);
      g.lineTo(op.x2 + nx * hw, op.y2 + ny * hw);
      g.lineTo(op.x2 - nx * hw, op.y2 - ny * hw);
      g.lineTo(op.x1 - nx * hw, op.y1 - ny * hw);
      g.fill();
      // Tread bars
      g.globalAlpha = op.al * 0.9;
      g.strokeStyle = op.c;
      g.lineWidth = 1.4;
      g.beginPath();
      const step = 4.5;
      const start = op.o % step;
      for (let s = start; s < len; s += step) {
        const px = op.x1 + (dx / len) * s, py = op.y1 + (dy / len) * s;
        g.moveTo(px + nx * hw, py + ny * hw);
        g.lineTo(px - nx * hw, py - ny * hw);
      }
      g.stroke();
      g.globalAlpha = 1;
    } else if (op.t === 2) {
      // Rubble blob cluster (destroyed building)
      const r = makeRng(op.seed);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(op.x - op.w / 2 - 4, op.y - op.h / 2 - 4, op.w + 8, op.h + 8);
      for (let i = 0; i < (op.w * op.h) / 40; i++) {
        const x = op.x + (r() - 0.5) * op.w * 1.1, y = op.y + (r() - 0.5) * op.h * 1.1;
        const s = 2 + r() * 7;
        const l = 90 + r() * 70;
        g.fillStyle = `rgb(${l},${l - 6},${l - 14})`;
        g.beginPath();
        g.moveTo(x - s, y);
        g.lineTo(x, y - s * 0.8);
        g.lineTo(x + s, y + s * 0.2);
        g.lineTo(x + s * 0.2, y + s);
        g.closePath();
        g.fill();
      }
      g.fillStyle = shade(op.palette, -0.4);
      for (let i = 0; i < 8; i++) {
        const x = op.x + (r() - 0.5) * op.w, y = op.y + (r() - 0.5) * op.h;
        g.save();
        g.translate(x, y);
        g.rotate(r() * TAU);
        g.fillRect(-10, -2, 20, 4);
        g.restore();
      }
    }
  }

  _addDecal(op, x, y, radius) {
    const c0 = Math.max(0, Math.floor((x - radius) / CHUNK)), c1 = Math.floor((x + radius) / CHUNK);
    const r0 = Math.max(0, Math.floor((y - radius) / CHUNK)), r1 = Math.floor((y + radius) / CHUNK);
    for (let cy = r0; cy <= r1; cy++)
      for (let cx = c0; cx <= c1; cx++) {
        const key = this._chunkKey(cx, cy);
        let list = this.decals.get(key);
        if (!list) this.decals.set(key, (list = []));
        list.push(op);
        // Old track marks fade away (bounded memory).
        if (list.length > 2500) list.splice(0, 500);
        const ch = this.chunks.get(key);
        if (ch) {
          const g = ch.ctx;
          g.save();
          g.translate(-cx * CHUNK, -cy * CHUNK);
          this._drawDecal(g, op);
          g.restore();
        }
      }
  }

  stamp(spr, x, y, angle = 0, alpha = 1, scale = 1) {
    this._addDecal({ t: 0, spr, x, y, a: angle, al: alpha, sc: scale }, x, y, Math.max(spr.w, spr.h) * scale * 0.75);
  }

  trackMark(x1, y1, x2, y2, w, alpha, color, offset) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    this._addDecal({ t: 1, x1, y1, x2, y2, w, al: alpha, c: color, o: offset }, mx, my, Math.hypot(x2 - x1, y2 - y1) / 2 + w);
  }

  rubble(p) {
    this._addDecal({ t: 2, x: p.x, y: p.y, w: p.w, h: p.h, seed: (p.x * 31 + p.y) | 0, palette: p.palette }, p.x, p.y, Math.max(p.w, p.h) * 0.75);
  }

  // Generate up to `budgetMs` of missing chunks around the view.
  ensureChunks(view, budgetMs = 6) {
    const start = performance.now();
    const c0 = Math.max(0, Math.floor(view.x0 / CHUNK)), c1 = Math.min(WORLD_W / CHUNK - 1, Math.floor(view.x1 / CHUNK));
    const r0 = Math.max(0, Math.floor(view.y0 / CHUNK)), r1 = Math.min(WORLD_H / CHUNK - 1, Math.floor(view.y1 / CHUNK));
    const now = this.time;
    // Nearest-first generation.
    const missing = [];
    for (let cy = r0 - 1; cy <= r1 + 1; cy++)
      for (let cx = c0 - 1; cx <= c1 + 1; cx++) {
        if (cx < 0 || cy < 0 || cx >= WORLD_W / CHUNK || cy >= WORLD_H / CHUNK) continue;
        const key = this._chunkKey(cx, cy);
        const ch = this.chunks.get(key);
        if (ch) ch.used = now;
        else missing.push([cx, cy, cx >= c0 && cx <= c1 && cy >= r0 && cy <= r1 ? 0 : 1]);
      }
    missing.sort((a, b) => a[2] - b[2]);
    for (const [cx, cy, prio] of missing) {
      if (prio > 0 && performance.now() - start > budgetMs) break;
      const canvas = this._renderChunk(cx, cy);
      this.chunks.set(this._chunkKey(cx, cy), { canvas, ctx: canvas.getContext('2d'), used: now });
    }
    // Evict least recently used.
    if (this.chunks.size > MAX_CHUNKS) {
      const arr = [...this.chunks.entries()].sort((a, b) => a[1].used - b[1].used);
      for (let i = 0; i < arr.length - MAX_CHUNKS; i++) this.chunks.delete(arr[i][0]);
    }
  }

  renderGround(ctx, view) {
    const c0 = Math.max(0, Math.floor(view.x0 / CHUNK)), c1 = Math.min(WORLD_W / CHUNK - 1, Math.floor(view.x1 / CHUNK));
    const r0 = Math.max(0, Math.floor(view.y0 / CHUNK)), r1 = Math.min(WORLD_H / CHUNK - 1, Math.floor(view.y1 / CHUNK));
    ctx.fillStyle = '#18425f';
    ctx.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
    for (let cy = r0; cy <= r1; cy++)
      for (let cx = c0; cx <= c1; cx++) {
        const ch = this.chunks.get(this._chunkKey(cx, cy));
        // +0.5 overlap hides hairline seams between chunks.
        if (ch) ctx.drawImage(ch.canvas, cx * CHUNK, cy * CHUNK, CHUNK + 0.5, CHUNK + 0.5);
      }
    this._renderWaterShimmer(ctx, view);
  }

  _renderWaterShimmer(ctx, view) {
    // Animated glints drifting over water tiles in view.
    const t = this.time;
    const step = 48;
    const x0 = Math.floor(view.x0 / step) * step, y0 = Math.floor(view.y0 / step) * step;
    ctx.strokeStyle = 'rgba(220,245,255,0.22)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let y = y0; y < view.y1; y += step)
      for (let x = x0; x < view.x1; x += step) {
        if (this.tileAt(x, y) !== T.DEEP) continue;
        const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        const fr = h - Math.floor(h);
        const phase = (t * 0.6 + fr * 10) % 3;
        if (phase > 1) continue;
        const a = Math.sin(phase * Math.PI);
        const px = x + fr * 30 + phase * 10, py = y + ((fr * 7) % 1) * 30;
        const len = 6 + a * 8;
        ctx.moveTo(px, py);
        ctx.lineTo(px + len, py);
      }
    ctx.stroke();
    // Shoreline foam
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const s2 = TILE;
    const fx0 = Math.floor(view.x0 / s2) * s2, fy0 = Math.floor(view.y0 / s2) * s2;
    for (let y = fy0; y < view.y1; y += s2)
      for (let x = fx0; x < view.x1; x += s2) {
        if (this.tileAt(x + 16, y + 16) !== T.SHALLOW) continue;
        const h = Math.sin(x * 3.1 + y * 7.7) * 9999;
        const fr = h - Math.floor(h);
        const ph = Math.sin(t * 1.5 + fr * TAU);
        if (ph < 0.3) continue;
        ctx.moveTo(x + fr * 20, y + 16);
        ctx.arc(x + fr * 20, y + 16, 3 + ph * 4, 0, Math.PI, true);
      }
    ctx.stroke();
  }

  // --- Prop rendering ---------------------------------------------------------------------

  inView(p, view, pad) {
    return p.x > view.x0 - pad && p.x < view.x1 + pad && p.y > view.y0 - pad && p.y < view.y1 + pad;
  }

  // Low props: drawn beneath vehicles.
  renderLow(ctx, view) {
    const sp = this.sprites;
    for (const p of this.props) {
      if (!p.alive || p.height > 0 || p.type === 'building') continue;
      if (!this.inView(p, view, 60)) continue;
      const x = p.body ? p.body.x : p.x, y = p.body ? p.body.y : p.y;
      const a = p.body ? p.body.angle : p.angle;
      switch (p.type) {
        case 'crate':
          drawSprite(ctx, sp.crateShadow, x + 4, y + 5, a);
          break;
        case 'barrel':
          drawSprite(ctx, sp.barrelShadow, x + 3, y + 4);
          break;
        case 'rock':
          ctx.globalAlpha = 0.5;
          drawSprite(ctx, sp.treeShadow, x + 6, y + 7, 0, p.spr.w / 56);
          ctx.globalAlpha = 1;
          break;
      }
      drawSprite(ctx, p.spr, x, y, a);
      // Damage flash
      if (p.flash > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = p.flash;
        drawSprite(ctx, p.spr, x, y, a);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }

  // Tall props: tree canopies and perspective buildings drawn above vehicles.
  renderHigh(ctx, view, camX, camY, playerX, playerY) {
    const sp = this.sprites;
    // Perspective factor: how far roofs lean away from the camera.
    const PERSP = 0.0018;
    // Shadows first so they don't overdraw other canopies.
    for (const p of this.props) {
      if (!p.alive || p.height <= 0 || p.type === 'building') continue;
      if (!this.inView(p, view, 80)) continue;
      drawSprite(ctx, sp.treeShadow, p.x + 12, p.y + 14, 0, (p.radius * 2) / 50, 0.5);
    }
    for (const p of this.props) {
      if (!p.alive || p.height <= 0 || p.type === 'building') continue;
      if (!this.inView(p, view, 80)) continue;
      const k = p.height * PERSP;
      const ox = (p.x - camX) * k, oy = (p.y - camY) * k;
      // Fade canopy when the player is under it.
      const d = Math.hypot(playerX - p.x - ox, playerY - p.y - oy);
      const alpha = d < p.radius + 10 ? 0.45 : 1;
      const sway = Math.sin(this.time * 1.3 + p.x * 0.01) * 0.03;
      drawSprite(ctx, p.spr, p.x + ox, p.y + oy, p.angle + sway, 1 + (p.flash || 0) * 0.08, alpha);
    }
    for (const p of this.props) {
      if (!p.alive || p.type !== 'building') continue;
      if (!this.inView(p, view, 200)) continue;
      this._drawBuilding(ctx, p, camX, camY, PERSP);
    }
  }

  _drawBuilding(ctx, p, camX, camY, PERSP) {
    const k = p.height * PERSP;
    const ox = (p.x - camX) * k, oy = (p.y - camY) * k;
    const x0 = p.x - p.w / 2, y0 = p.y - p.h / 2, x1 = p.x + p.w / 2, y1 = p.y + p.h / 2;
    // Ground shadow cast down-right.
    const sh = p.height * 0.5;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.moveTo(x1, y0);
    ctx.lineTo(x1 + sh, y0 + sh);
    ctx.lineTo(x1 + sh, y1 + sh);
    ctx.lineTo(x0 + sh, y1 + sh);
    ctx.lineTo(x0, y1);
    ctx.lineTo(x1, y1);
    ctx.closePath();
    ctx.fill();

    const dmg = 1 - p.hp / p.maxHp;
    const wall = p.palette;
    const walls = [];
    // Visible side walls depend on which side of the camera the building is.
    if (ox > 0) walls.push([[x0, y0], [x0, y1], -0.35]); // left wall
    if (ox < 0) walls.push([[x1, y0], [x1, y1], -0.05]); // right wall
    if (oy > 0) walls.push([[x0, y0], [x1, y0], 0.05]); // top wall
    if (oy < 0) walls.push([[x0, y1], [x1, y1], -0.25]); // bottom wall
    for (const [[ax, ay], [bx, by], light] of walls) {
      ctx.fillStyle = shade(wall, light - dmg * 0.3);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx + ox, by + oy);
      ctx.lineTo(ax + ox, ay + oy);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // Windows: a row of dark quads at mid-height.
      const len = Math.hypot(bx - ax, by - ay);
      const n = Math.max(1, Math.floor(len / 22));
      ctx.fillStyle = 'rgba(25,30,38,0.75)';
      for (let i = 0; i < n; i++) {
        const t0 = (i + 0.3) / n, t1 = (i + 0.7) / n;
        const h0 = 0.35, h1 = 0.7;
        const P = (t, h) => [ax + (bx - ax) * t + ox * h, ay + (by - ay) * t + oy * h];
        const a = P(t0, h0), b = P(t1, h0), c = P(t1, h1), d = P(t0, h1);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.lineTo(c[0], c[1]);
        ctx.lineTo(d[0], d[1]);
        ctx.closePath();
        ctx.fill();
      }
    }
    // Roof
    ctx.drawImage(p.roof.img, x0 + ox, y0 + oy, p.w, p.h);
    if (dmg > 0.01) {
      ctx.fillStyle = `rgba(20,15,10,${dmg * 0.55})`;
      ctx.fillRect(x0 + ox, y0 + oy, p.w, p.h);
    }
    if (p.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${p.flash * 0.4})`;
      ctx.fillRect(x0 + ox, y0 + oy, p.w, p.h);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + ox, y0 + oy, p.w, p.h);
  }

  update(dt) {
    this.time += dt;
    for (const p of this.props) if (p.flash > 0) p.flash = Math.max(0, p.flash - dt * 5);
  }
}

