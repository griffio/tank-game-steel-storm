// HUD, minimap, menus and screen-space overlays.

import { makeCanvas, clamp, TAU, lerp } from './util.js';
import { WORLD_W, WORLD_H, TILE, T } from './world.js';
import { Helicopter } from './enemies.js';
import { PICKUPS } from './game.js';

const FONT = '"Russo One", "Arial Black", Impact, sans-serif';
const MONO = '"Share Tech Mono", ui-monospace, Menlo, monospace';

export function makeVignette(w, h) {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  return c;
}

const TILE_COLORS = {
  [T.DEEP]: '#1d4f6e',
  [T.SHALLOW]: '#3a7f8f',
  [T.SAND]: '#cdb27c',
  [T.GRASS]: '#5f8a3a',
  [T.FOREST]: '#3a6a2a',
  [T.DIRT]: '#8a6e4a',
  [T.ROAD]: '#4a4844',
  [T.ROCKY]: '#8a8578',
  [T.CONCRETE]: '#9a988f',
  [T.BRIDGE]: '#8a7356',
  [T.DRY]: '#a89e5a',
};

export function makeMinimap(world) {
  const c = makeCanvas(world.cols, world.rows);
  const g = c.getContext('2d');
  const img = g.createImageData(world.cols, world.rows);
  const hex = {};
  for (const [k, v] of Object.entries(TILE_COLORS)) {
    const n = parseInt(v.slice(1), 16);
    hex[k] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  for (let i = 0; i < world.tiles.length; i++) {
    const col = hex[world.tiles[i]] || [0, 0, 0];
    img.data[i * 4] = col[0];
    img.data[i * 4 + 1] = col[1];
    img.data[i * 4 + 2] = col[2];
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // Darken forests where trees are dense.
  g.fillStyle = 'rgba(20,50,20,0.5)';
  for (const p of world.props) if (p.type === 'tree' || p.type === 'pine') g.fillRect(p.x / TILE - 0.5, p.y / TILE - 0.5, 1, 1);
  g.fillStyle = '#c9c2b0';
  for (const p of world.props) if (p.type === 'building') g.fillRect((p.x - p.w / 2) / TILE, (p.y - p.h / 2) / TILE, p.w / TILE, p.h / TILE);
  return c;
}

// --- Overlays ---------------------------------------------------------------------------

export function drawOverlays(game, ctx) {
  const { w, h } = game;
  ctx.drawImage(game.vignette, 0, 0, w, h);
  const p = game.player;
  if (!p || game.state === 'title') return;
  // Speed lines while boosting.
  if (p.boosting && p.alive) {
    const t = game.time;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * TAU + Math.sin(i * 91.7) * 0.2;
      const r0 = Math.max(w, h) * (0.42 + ((t * 2.5 + i * 0.37) % 1) * 0.3);
      const r1 = r0 + 60 + (i % 3) * 30;
      ctx.moveTo(w / 2 + Math.cos(a) * r0, h / 2 + Math.sin(a) * r0);
      ctx.lineTo(w / 2 + Math.cos(a) * r1, h / 2 + Math.sin(a) * r1);
    }
    ctx.stroke();
  }
  // Damage flash and low-health pulse.
  const low = p.alive ? clamp(1 - p.hp / p.maxHp / 0.3, 0, 1) : 0;
  const pulse = low * (0.35 + 0.25 * Math.sin(game.time * 7));
  const a = Math.max(game.hurt * 0.6, pulse);
  if (a > 0.01) {
    const grd = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
    grd.addColorStop(0, 'rgba(200,0,0,0)');
    grd.addColorStop(1, `rgba(200,0,0,${a})`);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);
  }
  if (game.overdrive > 0) {
    ctx.strokeStyle = `rgba(190,110,255,${0.25 + Math.sin(game.time * 10) * 0.1})`;
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, w - 8, h - 8);
  }
}

// --- HUD ----------------------------------------------------------------------------------

function panel(ctx, x, y, w, h, alpha = 0.55) {
  ctx.fillStyle = `rgba(10,14,12,${alpha})`;
  ctx.beginPath();
  ctx.moveTo(x + 8, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - 8);
  ctx.lineTo(x + w - 8, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + 8);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(232,211,106,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function bar(ctx, x, y, w, h, frac, color, back = 'rgba(255,255,255,0.08)', segments = 0) {
  ctx.fillStyle = back;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(x, y, w * clamp(frac, 0, 1), h * 0.35);
  if (segments) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    for (let i = 1; i < segments; i++) ctx.fillRect(x + (w * i) / segments - 1, y, 2, h);
  }
}

function text(ctx, s, x, y, size, color, align = 'left', font = FONT, stroke = true) {
  ctx.font = `${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (stroke) {
    ctx.lineWidth = Math.max(2, size / 7);
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(s, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

export function drawHUD(game, ctx) {
  const p = game.player;
  if (!p) return;
  const { w, h } = game;
  const s = clamp(Math.min(w / 1400, h / 850), 0.7, 1.25);

  // --- Status panel (top-left) ---
  const px = 16, py = 16, pw = 270 * s, ph = 112 * s;
  panel(ctx, px, py, pw, ph);
  const hpf = p.hp / p.maxHp;
  const hpCol = hpf > 0.5 ? '#7dd35a' : hpf > 0.25 ? '#f1c40f' : '#ff4a3a';
  text(ctx, 'ARMOUR', px + 12 * s, py + 16 * s, 12 * s, '#e8d36a');
  text(ctx, `${Math.ceil(p.hp)}/${p.maxHp}`, px + pw - 12 * s, py + 16 * s, 12 * s, '#fff', 'right', MONO);
  bar(ctx, px + 12 * s, py + 26 * s, pw - 24 * s, 14 * s, hpf, hpCol, 'rgba(255,255,255,0.08)', Math.min(30, Math.round(p.maxHp / 25)));
  text(ctx, 'BOOST', px + 12 * s, py + 52 * s, 11 * s, '#9fe8ff');
  bar(ctx, px + 60 * s, py + 47 * s, pw - 72 * s, 9 * s, p.boostEnergy, p.boosting ? '#ffffff' : '#4fc3f7');
  text(ctx, 'COAX', px + 12 * s, py + 68 * s, 11 * s, p.overheated ? '#ff4a3a' : '#ffb347');
  bar(ctx, px + 60 * s, py + 63 * s, pw - 72 * s, 9 * s, p.mgHeat, p.overheated ? (Math.sin(game.time * 20) > 0 ? '#ff4a3a' : '#7a1a10') : '#ff8a3a');
  // Missiles
  text(ctx, 'MSL', px + 12 * s, py + 88 * s, 11 * s, '#e67e22');
  const mcount = Math.min(game.missiles, 16);
  for (let i = 0; i < mcount; i++) {
    const mx = px + 60 * s + i * 11 * s;
    ctx.fillStyle = '#e67e22';
    ctx.fillRect(mx, py + 82 * s, 6 * s, 12 * s);
    ctx.fillStyle = '#fff';
    ctx.fillRect(mx, py + 82 * s, 6 * s, 3 * s);
  }
  if (game.missiles > 16) text(ctx, `+${game.missiles - 16}`, px + 60 * s + 16 * 11 * s, py + 88 * s, 11 * s, '#e67e22');
  if (game.missiles === 0) text(ctx, 'EMPTY', px + 60 * s, py + 88 * s, 11 * s, 'rgba(255,255,255,0.35)');
  // Timed effects
  let ey = py + ph + 10 * s;
  const effect = (label, t, max, col) => {
    panel(ctx, px, ey, pw * 0.75, 22 * s, 0.45);
    text(ctx, label, px + 10 * s, ey + 11 * s, 11 * s, col);
    bar(ctx, px + 100 * s, ey + 7 * s, pw * 0.75 - 110 * s, 8 * s, t / max, col);
    ey += 28 * s;
  };
  if (game.overdrive > 0) effect('OVERDRIVE', game.overdrive, 10, '#c77dff');
  if (p.shield > 0) effect('SHIELD', p.shield, 8, '#7ad7ff');

  // --- Score (top-right) ---
  const sx = w - 16;
  text(ctx, game.score.toLocaleString(), sx, 34 * s, 34 * s, '#ffffff', 'right');
  text(ctx, `BEST ${Math.max(game.best, game.score).toLocaleString()}`, sx, 62 * s, 12 * s, 'rgba(255,255,255,0.6)', 'right', MONO);
  const mult = game.mult();
  if (game.combo > 0) {
    const pop = 1 + Math.max(0, game.comboTimer - 2.7) * 1.5;
    text(ctx, `x${mult}`, sx, 92 * s, 28 * s * pop, mult >= 4 ? '#ff7a3a' : '#ffd34d', 'right');
    text(ctx, `${game.combo} COMBO`, sx - 60 * s, 92 * s, 12 * s, 'rgba(255,255,255,0.75)', 'right');
    bar(ctx, sx - 140 * s, 108 * s, 140 * s, 4 * s, game.comboTimer / 3, '#ffd34d');
  }

  // --- Wave (top-centre) ---
  if (game.wave > 0) {
    const remaining = game.enemyTanks.length + game.air.filter((a) => a.alive).length + game.spawnQueue.length;
    text(ctx, `WAVE ${game.wave}`, w / 2, 24 * s, 20 * s, '#e8d36a', 'center');
    if (game.waveState === 'active') text(ctx, `${remaining} HOSTILES`, w / 2, 46 * s, 11 * s, 'rgba(255,255,255,0.7)', 'center', MONO);
  }
  // Boss bar
  if (game.boss && game.boss.alive) {
    const bw = Math.min(600, w * 0.5), bx = w / 2 - bw / 2, by = 64 * s;
    panel(ctx, bx - 10, by - 6, bw + 20, 34 * s, 0.6);
    text(ctx, 'BEHEMOTH', w / 2, by + 6 * s, 12 * s, '#ff4a3a', 'center');
    bar(ctx, bx, by + 14 * s, bw, 10 * s, game.boss.hp / game.boss.maxHp, '#ff3b30', 'rgba(255,255,255,0.08)', 10);
  }

  drawOffscreenArrows(game, ctx);
  drawMinimap(game, ctx, s);
  drawAnnouncements(game, ctx, s);
  if (game.state === 'playing') drawCrosshair(game, ctx);

  // Control hints for the first seconds.
  if (game.time < 12 && game.state === 'playing') {
    const a = clamp((12 - game.time) / 2, 0, 1);
    ctx.globalAlpha = a;
    const lines = game.input.usingGamepad
      ? ['L-STICK drive · R-STICK aim', 'RT cannon · LT/RB machine gun', 'A boost · B missiles']
      : [game.controlMode === 'arcade' ? 'WASD drive (arcade)' : 'W/S throttle · A/D steer (tank)', 'MOUSE aim · LMB cannon · RMB machine gun', 'SHIFT boost · SPACE missiles · ESC pause'];
    lines.forEach((l, i) => text(ctx, l, 20, h - 70 + i * 20, 13, 'rgba(255,255,255,0.85)', 'left', MONO));
    ctx.globalAlpha = 1;
  }
}

function drawCrosshair(game, ctx) {
  const p = game.player;
  if (!p || !p.alive) return;
  let [x, y] = game.input.usingGamepad ? game.worldToScreen(game.aimX, game.aimY) : [game.input.mouseX, game.input.mouseY];
  const reload = clamp(1 - p.cooldown / (p.spec.reload * p.mods.reload * (p.overdrive ? 0.45 : 1)), 0, 1);
  const ready = reload >= 1;
  ctx.lineWidth = 2;
  ctx.strokeStyle = ready ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.4)';
  const r = 14;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    ctx.moveTo(x + Math.cos(a) * (r - 6), y + Math.sin(a) * (r - 6));
    ctx.lineTo(x + Math.cos(a) * (r + 4), y + Math.sin(a) * (r + 4));
  }
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.fillRect(x - 1, y - 1, 2, 2);
  // Reload arc
  ctx.strokeStyle = ready ? '#e8d36a' : '#ff8a3a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, r + 8, -Math.PI / 2, -Math.PI / 2 + TAU * reload);
  ctx.stroke();
  // Line from turret direction: where the gun actually points.
  const [mx, my] = game.worldToScreen(...p.muzzle());
  const ta = p.turretAngle;
  const dist = Math.hypot(x - mx, y - my);
  ctx.strokeStyle = 'rgba(255,230,150,0.25)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.moveTo(mx, my);
  ctx.lineTo(mx + Math.cos(ta) * dist, my + Math.sin(ta) * dist);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawOffscreenArrows(game, ctx) {
  const { w, h } = game;
  const margin = 28;
  const targets = [];
  for (const ai of game.enemyTanks) targets.push([ai.tank.x, ai.tank.y, ai.tank.kind === 'boss' ? '#ff2a1a' : '#ff5a3a', ai.tank.kind === 'boss' ? 1.6 : 1]);
  for (const a of game.air) if (a.alive && a instanceof Helicopter) targets.push([a.x, a.y, '#ff9a3a', 1.1]);
  for (const t of targets) {
    const [sx, sy] = game.worldToScreen(t[0], t[1]);
    if (sx > 0 && sx < w && sy > 0 && sy < h) continue;
    const dx = sx - w / 2, dy = sy - h / 2;
    const k = Math.min((w / 2 - margin) / Math.abs(dx || 1e-6), (h / 2 - margin) / Math.abs(dy || 1e-6));
    const ax = w / 2 + dx * k, ay = h / 2 + dy * k;
    const ang = Math.atan2(dy, dx);
    const d = Math.hypot(t[0] - game.player.x, t[1] - game.player.y);
    const sc = clamp(1.4 - d / 2000, 0.6, 1.3) * t[3];
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(ang);
    ctx.fillStyle = t[2];
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(12 * sc, 0);
    ctx.lineTo(-8 * sc, -8 * sc);
    ctx.lineTo(-4 * sc, 0);
    ctx.lineTo(-8 * sc, 8 * sc);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

function drawMinimap(game, ctx, s) {
  const size = Math.round(170 * s);
  const x = game.w - size - 16, y = game.h - size - 16;
  ctx.save();
  panel(ctx, x - 6, y - 6, size + 12, size + 12, 0.6);
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();
  ctx.globalAlpha = 0.9;
  ctx.drawImage(game.minimap, x, y, size, size);
  ctx.globalAlpha = 1;
  const k = size / WORLD_W;
  // Bases
  for (const b of game.world.bases) {
    ctx.strokeStyle = b.destroyed ? 'rgba(120,120,120,0.8)' : '#ff4a3a';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + (b.x - b.w / 2) * k, y + (b.y - b.h / 2) * k, b.w * k, b.h * k);
  }
  ctx.fillStyle = '#ff6a5a';
  for (const t of game.turrets) if (t.alive) ctx.fillRect(x + t.x * k - 1.5, y + t.y * k - 1.5, 3, 3);
  // Enemies
  const blink = Math.sin(game.time * 8) > 0;
  for (const ai of game.enemyTanks) {
    ctx.fillStyle = ai.tank.kind === 'boss' ? (blink ? '#fff' : '#ff2a1a') : '#ff3b30';
    const r = ai.tank.kind === 'boss' ? 4 : 2.2;
    ctx.beginPath();
    ctx.arc(x + ai.tank.x * k, y + ai.tank.y * k, r, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = '#ffb347';
  for (const a of game.air) if (a.alive) ctx.fillRect(x + a.x * k - 1.5, y + a.y * k - 1.5, 3, 3);
  for (const pk of game.pickups) {
    ctx.fillStyle = PICKUPS[pk.kind].color;
    ctx.fillRect(x + pk.x * k - 1.5, y + pk.y * k - 1.5, 3, 3);
  }
  // View rectangle
  const v = game.view();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + v.x0 * k, y + v.y0 * k, (v.x1 - v.x0) * k, (v.y1 - v.y0) * k);
  // Player
  const p = game.player;
  if (p) {
    ctx.save();
    ctx.translate(x + p.x * k, y + p.y * k);
    ctx.rotate(p.angle);
    ctx.fillStyle = '#e8d36a';
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(-4, -4);
    ctx.lineTo(-4, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawAnnouncements(game, ctx, s) {
  const { w, h } = game;
  let y = h * 0.28;
  for (const a of game.announce) {
    const t = 1 - a.life / a.max;
    const inT = clamp(t / 0.12, 0, 1);
    const outA = clamp(a.life / 0.4, 0, 1);
    const scale = a.small ? 1 : lerp(1.8, 1, 1 - (1 - inT) ** 3);
    ctx.globalAlpha = outA * inT;
    const size = (a.small ? 30 : 54) * s * scale;
    // Slanted backing strip
    if (!a.small) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      const bw = w * 0.6 * inT;
      ctx.moveTo(w / 2 - bw / 2 - 20, y - size * 0.7);
      ctx.lineTo(w / 2 + bw / 2 + 20, y - size * 0.7);
      ctx.lineTo(w / 2 + bw / 2, y + size * (a.sub ? 1.2 : 0.7));
      ctx.lineTo(w / 2 - bw / 2 - 40, y + size * (a.sub ? 1.2 : 0.7));
      ctx.closePath();
      ctx.fill();
    }
    text(ctx, a.text, w / 2, y, size, a.color, 'center');
    if (a.sub) text(ctx, a.sub, w / 2, y + size * 0.75, 16 * s, 'rgba(255,255,255,0.9)', 'center', MONO);
    y += size * (a.sub ? 1.9 : 1.3);
  }
  ctx.globalAlpha = 1;
}

// --- Screens --------------------------------------------------------------------------------

function titleText(ctx, s, x, y, size) {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = size / 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeText(s, x, y + size * 0.06);
  const grd = ctx.createLinearGradient(0, y - size / 2, 0, y + size / 2);
  grd.addColorStop(0, '#fff6d0');
  grd.addColorStop(0.45, '#e8d36a');
  grd.addColorStop(0.55, '#b8862a');
  grd.addColorStop(1, '#ffdd88');
  ctx.fillStyle = grd;
  ctx.fillText(s, x, y);
}

export function drawTitle(game, ctx) {
  const { w, h } = game;
  const s = clamp(Math.min(w / 1300, h / 800), 0.55, 1.4);
  ctx.fillStyle = 'rgba(5,8,6,0.35)';
  ctx.fillRect(0, 0, w, h);
  const t = game.titleT;
  const bob = Math.sin(t * 1.5) * 4;
  titleText(ctx, 'STEEL STORM', w / 2, h * 0.3 + bob, 110 * s);
  text(ctx, 'TRACKED ARMOUR  ·  RIGID-BODY PHYSICS  ·  TOTAL MAYHEM', w / 2, h * 0.3 + 78 * s, 15 * s, 'rgba(255,255,255,0.8)', 'center', MONO);

  const blink = Math.sin(t * 4) > -0.3;
  if (blink) text(ctx, 'CLICK OR PRESS ENTER TO DEPLOY', w / 2, h * 0.52, 26 * s, '#ffffff', 'center');

  // Controls card
  const cw = 560 * s, ch = 190 * s, cx = w / 2 - cw / 2, cy = h * 0.6;
  panel(ctx, cx, cy, cw, ch, 0.6);
  const rows = [
    ['DRIVE', game.controlMode === 'arcade' ? 'WASD — tank turns toward the direction you press' : 'W/S throttle · A/D steer (classic tank controls)'],
    ['AIM / FIRE', 'Mouse aim · Left click cannon · Right click (or F) machine gun'],
    ['BOOST', 'Shift — nitro; drift and flatten trees at speed'],
    ['MISSILES', 'Space — homing salvo'],
    ['OPTIONS', `C controls: ${game.controlMode.toUpperCase()}  ·  M music  ·  ESC pause  ·  Gamepad supported`],
  ];
  rows.forEach(([k, v], i) => {
    const ry = cy + 26 * s + i * 33 * s;
    text(ctx, k, cx + 20 * s, ry, 13 * s, '#e8d36a', 'left', FONT);
    text(ctx, v, cx + 140 * s, ry, 13 * s, 'rgba(255,255,255,0.88)', 'left', MONO, false);
  });
  if (game.best > 0) text(ctx, `BEST SCORE  ${game.best.toLocaleString()}`, w / 2, cy + ch + 28 * s, 15 * s, '#ffd34d', 'center', MONO);
}

export function drawPause(game, ctx) {
  const { w, h } = game;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, w, h);
  titleText(ctx, 'PAUSED', w / 2, h * 0.4, 80);
  text(ctx, 'ESC / click to resume  ·  C toggle controls (' + game.controlMode.toUpperCase() + ')  ·  Q quit to title', w / 2, h * 0.4 + 70, 15, '#fff', 'center', MONO);
}

const CARD_W = 250, CARD_H = 300, CARD_GAP = 30;

function cardRects(game) {
  const n = game.upgradeChoices.length;
  const s = clamp(Math.min(game.w / 1100, game.h / 750), 0.6, 1.3);
  const cw = CARD_W * s, ch = CARD_H * s, gap = CARD_GAP * s;
  const total = n * cw + (n - 1) * gap;
  const x0 = game.w / 2 - total / 2, y0 = game.h / 2 - ch / 2 + 30 * s;
  return { s, rects: game.upgradeChoices.map((_, i) => [x0 + i * (cw + gap), y0, cw, ch]) };
}

export function upgradeHover(game, mx, my) {
  if (!game.upgradeChoices) return -1;
  const { rects } = cardRects(game);
  return rects.findIndex(([x, y, w, h]) => mx >= x && mx <= x + w && my >= y && my <= y + h);
}

export function drawUpgrade(game, ctx) {
  const { w, h } = game;
  const t = game.upgradeT;
  const fade = clamp(t / 0.3, 0, 1);
  ctx.fillStyle = `rgba(4,8,6,${0.65 * fade})`;
  ctx.fillRect(0, 0, w, h);
  const { s, rects } = cardRects(game);
  ctx.globalAlpha = fade;
  titleText(ctx, 'FIELD UPGRADE', w / 2, rects[0][1] - 70 * s, 52 * s);
  text(ctx, 'Choose one  ·  1 / 2 / 3 or click', w / 2, rects[0][1] - 28 * s, 14 * s, 'rgba(255,255,255,0.75)', 'center', MONO);
  game.upgradeChoices.forEach((u, i) => {
    const [x, y0, cw, ch] = rects[i];
    const appear = clamp((t - i * 0.08) / 0.25, 0, 1);
    const y = y0 + (1 - appear) * 60;
    const sel = i === game.upgradeSel;
    ctx.globalAlpha = fade * appear;
    ctx.save();
    if (sel) {
      ctx.shadowColor = 'rgba(232,211,106,0.7)';
      ctx.shadowBlur = 24;
    }
    const grd = ctx.createLinearGradient(0, y, 0, y + ch);
    grd.addColorStop(0, sel ? '#3a3a24' : '#22261f');
    grd.addColorStop(1, '#121510');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(x + 14, y);
    ctx.lineTo(x + cw, y);
    ctx.lineTo(x + cw, y + ch - 14);
    ctx.lineTo(x + cw - 14, y + ch);
    ctx.lineTo(x, y + ch);
    ctx.lineTo(x, y + 14);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = sel ? '#e8d36a' : 'rgba(232,211,106,0.3)';
    ctx.lineWidth = sel ? 3 : 1.5;
    ctx.stroke();
    // Icon medallion
    const cx = x + cw / 2, cy = y + 90 * s;
    ctx.fillStyle = sel ? 'rgba(232,211,106,0.18)' : 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    ctx.arc(cx, cy, 50 * s, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,211,106,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    text(ctx, u.icon, cx, cy + 2 * s, 50 * s, '#e8d36a', 'center', 'system-ui, sans-serif', false);
    text(ctx, u.name.toUpperCase(), cx, y + 172 * s, 19 * s, '#ffffff', 'center');
    // Wrap description
    ctx.font = `${13 * s}px ${MONO}`;
    const words = u.desc.split(' ');
    const lines = [];
    let line = '';
    for (const wd of words) {
      const test = line ? line + ' ' + wd : wd;
      if (ctx.measureText(test).width > cw - 36 * s) {
        lines.push(line);
        line = wd;
      } else line = test;
    }
    lines.push(line);
    lines.forEach((l, li) => text(ctx, l, cx, y + 205 * s + li * 18 * s, 13 * s, 'rgba(255,255,255,0.8)', 'center', MONO, false));
    const count = game.upgradeCounts[u.id] || 0;
    if (count) text(ctx, `OWNED ×${count}`, cx, y + ch - 42 * s, 11 * s, '#9fe8ff', 'center', MONO, false);
    text(ctx, `[${i + 1}]`, cx, y + ch - 20 * s, 14 * s, sel ? '#e8d36a' : 'rgba(255,255,255,0.4)', 'center', MONO, false);
  });
  ctx.globalAlpha = 1;
}

export function drawGameOver(game, ctx) {
  const { w, h } = game;
  const t = game.deathTimer;
  const fade = clamp((t - 0.8) / 1.0, 0, 1);
  if (fade <= 0) return;
  ctx.fillStyle = `rgba(20,0,0,${0.6 * fade})`;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = fade;
  const s = clamp(Math.min(w / 1200, h / 800), 0.6, 1.3);
  titleText(ctx, 'TANK DESTROYED', w / 2, h * 0.25, 76 * s);
  const st = game.stats;
  const acc = st.shots ? Math.round((st.hits / st.shots) * 100) : 0;
  const mins = Math.floor(st.time / 60), secs = Math.floor(st.time % 60).toString().padStart(2, '0');
  const rows = [
    ['SCORE', game.score.toLocaleString()],
    ['WAVE REACHED', String(game.wave)],
    ['KILLS', String(st.kills)],
    ['BASES DESTROYED', String(st.bases)],
    ['TIME SURVIVED', `${mins}:${secs}`],
  ];
  const pw = 440 * s, ph = rows.length * 36 * s + 30 * s;
  const px = w / 2 - pw / 2, py = h * 0.36;
  panel(ctx, px, py, pw, ph, 0.7);
  rows.forEach(([k, v], i) => {
    const y = py + 30 * s + i * 36 * s;
    text(ctx, k, px + 24 * s, y, 15 * s, '#e8d36a');
    text(ctx, v, px + pw - 24 * s, y, 18 * s, '#fff', 'right', MONO);
  });
  if (game.newBest) text(ctx, '★ NEW BEST SCORE ★', w / 2, py + ph + 34 * s, 24 * s, '#ffd34d', 'center');
  if (t > 2.5 && Math.sin(t * 4) > -0.3) text(ctx, 'CLICK / ENTER TO REDEPLOY  ·  ESC FOR TITLE', w / 2, py + ph + 74 * s, 18 * s, '#fff', 'center');
  ctx.globalAlpha = 1;
}
