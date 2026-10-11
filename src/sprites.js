// Procedural sprite generation. Every piece of art is painted once at start-up
// into an offscreen canvas at 2x resolution, then blitted each frame.

import { makeCanvas, shade, rgba, makeRng, TAU } from './util.js';

export const S = 2; // sprite supersampling

export function sprite(w, h, draw) {
  const c = makeCanvas(w * S, h * S);
  const g = c.getContext('2d');
  g.scale(S, S);
  g.translate(w / 2, h / 2);
  draw(g, w, h);
  return { img: c, w, h };
}

export function drawSprite(ctx, spr, x, y, angle = 0, scale = 1, alpha = 1) {
  if (alpha !== 1) ctx.globalAlpha = alpha;
  if (angle === 0 && scale === 1) {
    ctx.drawImage(spr.img, x - spr.w / 2, y - spr.h / 2, spr.w, spr.h);
  } else {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.drawImage(spr.img, (-spr.w / 2) * scale, (-spr.h / 2) * scale, spr.w * scale, spr.h * scale);
    ctx.restore();
  }
  if (alpha !== 1) ctx.globalAlpha = 1;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

function poly(g, pts) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}

// Subtle speckle to break up flat fills.
function grit(g, x, y, w, h, n, alpha, seed = 1) {
  const r = makeRng(seed);
  for (let i = 0; i < n; i++) {
    g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha * 0.7})`;
    g.fillRect(x + r() * w, y + r() * h, 0.6 + r(), 0.6 + r());
  }
}

// Bevel: light along top/left edges, dark along bottom/right edges.
function bevel(g, pts, light = 0.35, dark = 0.35, width = 1.2) {
  g.lineWidth = width;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const nx = b[1] - a[1], ny = -(b[0] - a[0]); // outward normal (clockwise pts)
    const facing = (-nx - ny) / Math.hypot(nx, ny); // light from top-left
    g.strokeStyle = facing > 0 ? `rgba(255,255,240,${light * facing})` : `rgba(0,0,0,${dark * -facing})`;
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.stroke();
  }
}

// Shadow sprite of a rounded rect / circle, softly blurred.
export function shadowSprite(w, h, radius, blur = 6, circle = false) {
  const pad = blur * 2;
  return sprite(w + pad * 2, h + pad * 2, (g) => {
    g.shadowColor = 'rgba(0,0,0,0.55)';
    g.shadowBlur = blur * S;
    g.shadowOffsetX = 1000 * S;
    g.fillStyle = '#000';
    g.translate(-1000, 0);
    if (circle) {
      g.beginPath();
      g.ellipse(0, 0, w / 2, h / 2, 0, 0, TAU);
      g.fill();
    } else {
      roundRect(g, -w / 2, -h / 2, w, h, radius);
      g.fill();
    }
  });
}

// --- Tanks ---------------------------------------------------------------------

export const TANK_STYLES = {
  player: { color: '#5d7a3a', accent: '#e8d36a', emblem: 'star', L: 66, W: 46 },
  scout: { color: '#b49a6a', accent: '#c0392b', emblem: 'chevron', L: 52, W: 36 },
  battle: { color: '#8b7d6b', accent: '#c0392b', emblem: 'chevron', L: 64, W: 44 },
  heavy: { color: '#5e5552', accent: '#e74c3c', emblem: 'skull', L: 80, W: 56 },
  boss: { color: '#3b3634', accent: '#ff3b30', emblem: 'skull', L: 150, W: 104 },
};

function trackStrip(L, tw, seed) {
  const period = 6;
  const len = L + period * 2;
  return {
    period,
    ...sprite(len, tw, (g) => {
      g.translate(-len / 2, -tw / 2);
      g.fillStyle = '#1d1d1d';
      g.fillRect(0, 0, len, tw);
      for (let x = 0; x < len; x += period) {
        // Tread plate with highlight edge
        const grd = g.createLinearGradient(x, 0, x + period, 0);
        grd.addColorStop(0, '#5a5a56');
        grd.addColorStop(0.35, '#3c3c39');
        grd.addColorStop(1, '#262624');
        g.fillStyle = grd;
        g.fillRect(x + 0.6, 0.6, period - 1.4, tw - 1.2);
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.fillRect(x + 0.6, 0.6, 0.8, tw - 1.2);
        // Grousers
        g.fillStyle = '#4a4a46';
        g.fillRect(x + period / 2 - 0.5, 0, 1.1, tw);
      }
      // Centre guide horns
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(0, tw / 2 - 0.8, len, 1.6);
      grit(g, 0, 0, len, tw, len * 2, 0.15, seed);
    }),
  };
}

function emblem(g, kind, color, x, y, s) {
  g.save();
  g.translate(x, y);
  g.fillStyle = color;
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 0.6;
  if (kind === 'star') {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU - Math.PI / 2;
      const r = i % 2 === 0 ? s : s * 0.42;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    g.stroke();
  } else if (kind === 'chevron') {
    g.rotate(Math.PI / 2);
    poly(g, [[-s, s * 0.2], [0, -s * 0.6], [s, s * 0.2], [s, s * 0.7], [0, -s * 0.1], [-s, s * 0.7]]);
    g.fill();
    g.stroke();
  } else if (kind === 'skull') {
    g.beginPath();
    g.arc(0, -s * 0.15, s * 0.7, 0, TAU);
    g.fill();
    g.fillRect(-s * 0.4, s * 0.3, s * 0.8, s * 0.45);
    g.fillStyle = 'rgba(0,0,0,0.75)';
    g.beginPath();
    g.arc(-s * 0.28, -s * 0.15, s * 0.2, 0, TAU);
    g.arc(s * 0.28, -s * 0.15, s * 0.2, 0, TAU);
    g.fill();
  }
  g.restore();
}

function hullSprite(style, seed) {
  const { L, W, color, accent, emblem: em } = style;
  const tw = W * 0.24;
  return sprite(L + 4, W + 4, (g) => {
    const hl = L / 2 - 1, hw = W / 2 - tw * 0.55;
    const ch = L * 0.12; // front chamfer
    const outer = [
      [hl, -hw + ch * 0.5],
      [hl, hw - ch * 0.5],
      [hl - ch * 0.6, hw],
      [-hl + 2, hw],
      [-hl, hw - 2],
      [-hl, -hw + 2],
      [-hl + 2, -hw],
      [hl - ch * 0.6, -hw],
    ];
    // Fender strips over the tracks
    g.fillStyle = shade(color, -0.35);
    roundRect(g, -L / 2 + 3, -W / 2 + 0.5, L - 5, tw * 0.42, 1.5);
    g.fill();
    roundRect(g, -L / 2 + 3, W / 2 - 0.5 - tw * 0.42, L - 5, tw * 0.42, 1.5);
    g.fill();

    // Main hull
    const grd = g.createLinearGradient(-hl, -hw, hl, hw);
    grd.addColorStop(0, shade(color, 0.18));
    grd.addColorStop(0.5, color);
    grd.addColorStop(1, shade(color, -0.3));
    g.fillStyle = grd;
    poly(g, outer);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 1;
    g.stroke();
    bevel(g, outer, 0.45, 0.5, 1.4);

    // Glacis plate (front slope) - lighter as it faces the light
    const gl = hl - L * 0.2;
    g.fillStyle = rgba('#ffffff', 0.08);
    poly(g, [[hl - 1, -hw + ch * 0.5 + 1], [hl - 1, hw - ch * 0.5 - 1], [gl, hw - 3], [gl, -hw + 3]]);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    g.moveTo(gl, -hw + 3);
    g.lineTo(gl, hw - 3);
    g.stroke();

    // Engine deck grille at rear
    const ex = -hl + 3, ew = L * 0.24, eh = hw * 1.3;
    g.fillStyle = shade(color, -0.4);
    roundRect(g, ex, -eh / 2, ew, eh, 1.5);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 0.8;
    for (let x = ex + 2; x < ex + ew - 1; x += 2.2) {
      g.beginPath();
      g.moveTo(x, -eh / 2 + 1.5);
      g.lineTo(x, eh / 2 - 1.5);
      g.stroke();
    }
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    for (let x = ex + 2.8; x < ex + ew - 1; x += 2.2) {
      g.beginPath();
      g.moveTo(x, -eh / 2 + 1.5);
      g.lineTo(x, eh / 2 - 1.5);
      g.stroke();
    }

    // Exhausts
    g.fillStyle = '#222';
    g.beginPath();
    g.arc(-hl + 1.5, -hw * 0.55, 1.6, 0, TAU);
    g.arc(-hl + 1.5, hw * 0.55, 1.6, 0, TAU);
    g.fill();

    // Side stowage boxes
    g.fillStyle = shade(color, -0.15);
    for (const sy of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        const bx = -L * 0.05 + i * L * 0.17;
        roundRect(g, bx, sy * (hw - 4) - 2, L * 0.13, 4, 0.8);
        g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.35)';
        g.lineWidth = 0.5;
        g.stroke();
      }
    }

    // Headlights
    for (const sy of [-1, 1]) {
      g.fillStyle = '#333';
      g.beginPath();
      g.arc(hl - 2.5, sy * (hw - 3), 2, 0, TAU);
      g.fill();
      const lg = g.createRadialGradient(hl - 2.2, sy * (hw - 3), 0, hl - 2.2, sy * (hw - 3), 1.7);
      lg.addColorStop(0, '#fffbe0');
      lg.addColorStop(1, '#c9b46a');
      g.fillStyle = lg;
      g.beginPath();
      g.arc(hl - 2.2, sy * (hw - 3), 1.5, 0, TAU);
      g.fill();
    }

    // Rivets
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let x = -hl + 4; x < hl - 6; x += 5) {
      g.fillRect(x, -hw + 1.2, 0.9, 0.9);
      g.fillRect(x, hw - 2.1, 0.9, 0.9);
    }
    // Emblem on the rear deck side
    emblem(g, em, accent, -L * 0.12, hw * 0.55, Math.min(5, W * 0.1));
    // Accent stripe for enemies
    if (em !== 'star') {
      g.fillStyle = rgba(accent, 0.8);
      g.fillRect(hl - L * 0.28, -hw + 1, 2.5, hw * 2 - 2);
    }
    grit(g, -hl, -hw, L, hw * 2, L * 6, 0.07, seed);
    // Dirt weathering near tracks
    const dg = g.createLinearGradient(0, -hw, 0, hw);
    dg.addColorStop(0, 'rgba(70,55,30,0.25)');
    dg.addColorStop(0.2, 'rgba(70,55,30,0)');
    dg.addColorStop(0.8, 'rgba(70,55,30,0)');
    dg.addColorStop(1, 'rgba(70,55,30,0.25)');
    g.fillStyle = dg;
    poly(g, outer);
    g.fill();
  });
}

function turretSprite(style, seed) {
  const { L, W, color, accent } = style;
  const tl = L * 0.5, tw = W * 0.62;
  return sprite(tl + 6, tw + 6, (g) => {
    // Turret shape: rounded hex, pointing +x
    const f = tl / 2, b = -tl / 2, h = tw / 2;
    const pts = [
      [f, -h * 0.55],
      [f, h * 0.55],
      [f - tl * 0.25, h],
      [b + 4, h],
      [b, h - 4],
      [b, -h + 4],
      [b + 4, -h],
      [f - tl * 0.25, -h],
    ];
    const grd = g.createRadialGradient(-tl * 0.15, -h * 0.4, 1, 0, 0, tl * 0.7);
    grd.addColorStop(0, shade(color, 0.3));
    grd.addColorStop(0.6, color);
    grd.addColorStop(1, shade(color, -0.35));
    g.fillStyle = grd;
    poly(g, pts);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.65)';
    g.lineWidth = 1;
    g.stroke();
    bevel(g, pts, 0.5, 0.5, 1.3);

    // Mantlet at front
    g.fillStyle = shade(color, -0.25);
    roundRect(g, f - 4, -h * 0.4, 6, h * 0.8, 1.5);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.stroke();

    // Commander cupola
    const cx = -tl * 0.12, cy = h * 0.35;
    const cr = Math.max(3.5, tw * 0.17);
    g.fillStyle = shade(color, -0.3);
    g.beginPath();
    g.arc(cx, cy, cr + 1, 0, TAU);
    g.fill();
    const cg = g.createRadialGradient(cx - 1, cy - 1, 0.5, cx, cy, cr);
    cg.addColorStop(0, shade(color, 0.35));
    cg.addColorStop(1, shade(color, -0.2));
    g.fillStyle = cg;
    g.beginPath();
    g.arc(cx, cy, cr, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 0.6;
    g.beginPath();
    g.arc(cx, cy, cr * 0.6, 0, TAU);
    g.stroke();
    // Hatch hinge
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.fillRect(cx - cr * 0.6, cy - 0.4, cr * 1.2, 0.8);

    // Loader hatch + periscopes
    g.fillStyle = shade(color, -0.15);
    g.beginPath();
    g.arc(-tl * 0.1, -h * 0.4, cr * 0.7, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.4)';
    g.stroke();
    g.fillStyle = '#1a2a33';
    g.fillRect(f - tl * 0.3, -h * 0.75, 2.5, 1.6);
    g.fillRect(f - tl * 0.3, h * 0.6, 2.5, 1.6);
    g.fillStyle = 'rgba(160,220,255,0.5)';
    g.fillRect(f - tl * 0.3 + 1.6, -h * 0.75, 0.8, 1.6);

    // Rear bustle rack
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 0.8;
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.moveTo(b + 1.5 + i * 2, -h + 4);
      g.lineTo(b + 1.5 + i * 2, h - 4);
      g.stroke();
    }
    // Antenna base
    g.fillStyle = '#222';
    g.beginPath();
    g.arc(b + 3, -h + 3, 1, 0, TAU);
    g.fill();
    // Accent ring
    g.strokeStyle = rgba(accent, 0.55);
    g.lineWidth = 1;
    g.beginPath();
    g.arc(cx, cy, cr + 1.6, 0, TAU);
    g.stroke();
    grit(g, -tl / 2, -h, tl, tw, tl * 5, 0.07, seed + 7);
  });
}

function barrelSprite(style, len, thick, twin = false) {
  const { color } = style;
  return sprite(len + 6, thick * (twin ? 3.2 : 1) + 6, (g) => {
    g.translate(-len / 2, 0);
    const draw = (oy) => {
      const grd = g.createLinearGradient(0, oy - thick / 2, 0, oy + thick / 2);
      grd.addColorStop(0, shade(color, -0.5));
      grd.addColorStop(0.3, shade(color, 0.35));
      grd.addColorStop(0.55, shade(color, -0.05));
      grd.addColorStop(1, shade(color, -0.6));
      g.fillStyle = grd;
      g.fillRect(0, oy - thick / 2, len - 4, thick);
      g.strokeStyle = 'rgba(0,0,0,0.5)';
      g.lineWidth = 0.6;
      g.strokeRect(0, oy - thick / 2, len - 4, thick);
      // Bore evacuator bulge
      const bx = len * 0.45;
      g.fillStyle = grd;
      roundRect(g, bx, oy - thick * 0.75, len * 0.16, thick * 1.5, thick * 0.5);
      g.fill();
      g.stroke();
      // Muzzle brake
      g.fillStyle = shade(color, -0.4);
      roundRect(g, len - 7, oy - thick * 0.85, 7, thick * 1.7, 1);
      g.fill();
      g.stroke();
      g.fillStyle = 'rgba(0,0,0,0.7)';
      g.fillRect(len - 5, oy - thick * 0.85, 1, thick * 1.7);
      g.fillRect(len - 2.5, oy - thick * 0.85, 1, thick * 1.7);
    };
    if (twin) {
      draw(-thick * 0.9);
      draw(thick * 0.9);
    } else draw(0);
  });
}

function wreckify(spr) {
  const c = makeCanvas(spr.img.width, spr.img.height);
  const g = c.getContext('2d');
  g.drawImage(spr.img, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(20,16,14,0.78)';
  g.fillRect(0, 0, c.width, c.height);
  const r = makeRng(spr.img.width);
  for (let i = 0; i < 8; i++) {
    const x = r() * c.width, y = r() * c.height, rad = (4 + r() * 10) * S;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, 'rgba(0,0,0,0.6)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // Rust-orange embers
  for (let i = 0; i < 4; i++) {
    const x = r() * c.width, y = r() * c.height, rad = (2 + r() * 4) * S;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, 'rgba(140,60,20,0.5)');
    grd.addColorStop(1, 'rgba(140,60,20,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return { img: c, w: spr.w, h: spr.h };
}

function makeTankSet(name, style, seed) {
  const { L, W } = style;
  const tw = W * 0.24;
  const hull = hullSprite(style, seed);
  const turret = turretSprite(style, seed);
  const thick = name === 'boss' ? 9 : name === 'heavy' ? 5.5 : name === 'scout' ? 3 : 4.2;
  const blen = name === 'boss' ? L * 0.62 : name === 'scout' ? L * 0.5 : L * 0.62;
  const barrel = barrelSprite(style, blen, thick, name === 'heavy' || name === 'boss');
  return {
    style,
    hull,
    turret,
    barrel,
    barrelLen: blen,
    track: trackStrip(L, tw, seed),
    trackW: tw,
    shadow: shadowSprite(L + 2, W + 2, 6, 5),
    wreckHull: wreckify(hull),
    wreckTurret: wreckify(turret),
    wreckBarrel: wreckify(barrel),
  };
}

// --- Nature ------------------------------------------------------------------------

function treeSprite(r, seed, palette) {
  const rng = makeRng(seed);
  return sprite(r * 2 + 8, r * 2 + 8, (g) => {
    // Clustered canopy puffs, darkest first, lit from top-left.
    const puffs = [];
    const n = 7 + Math.floor(rng() * 5);
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, d = rng() * r * 0.55;
      puffs.push([Math.cos(a) * d, Math.sin(a) * d, r * (0.38 + rng() * 0.3)]);
    }
    puffs.push([0, 0, r * 0.6]);
    // Dark under-layer
    for (const [x, y, pr] of puffs) {
      g.fillStyle = palette[0];
      g.beginPath();
      g.arc(x + 1.5, y + 1.5, pr, 0, TAU);
      g.fill();
    }
    for (const [x, y, pr] of puffs) {
      const grd = g.createRadialGradient(x - pr * 0.4, y - pr * 0.45, pr * 0.05, x, y, pr);
      grd.addColorStop(0, palette[3]);
      grd.addColorStop(0.45, palette[2]);
      grd.addColorStop(1, palette[1]);
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, pr, 0, TAU);
      g.fill();
    }
    // Leaf speckle
    for (let i = 0; i < r * 6; i++) {
      const a = rng() * TAU, d = rng() * r * 0.9;
      const x = Math.cos(a) * d, y = Math.sin(a) * d;
      const lit = x + y < 0;
      g.fillStyle = lit ? 'rgba(220,255,160,0.18)' : 'rgba(0,30,0,0.2)';
      g.beginPath();
      g.arc(x, y, 0.8 + rng() * 1.4, 0, TAU);
      g.fill();
    }
  });
}

function pineSprite(r, seed) {
  const rng = makeRng(seed);
  return sprite(r * 2 + 6, r * 2 + 6, (g) => {
    const spikes = 11 + Math.floor(rng() * 4);
    for (let layer = 0; layer < 4; layer++) {
      const lr = r * (1 - layer * 0.22);
      const rot = rng() * TAU;
      const c = ['#1d3b22', '#28502c', '#356638', '#4a7d45'][layer];
      g.fillStyle = c;
      g.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const a = rot + (i / (spikes * 2)) * TAU;
        const rr = i % 2 === 0 ? lr : lr * 0.68;
        g.lineTo(Math.cos(a) * rr - layer * 0.6, Math.sin(a) * rr - layer * 0.6);
      }
      g.closePath();
      g.fill();
    }
    g.fillStyle = '#5b4632';
    g.beginPath();
    g.arc(-2, -2, 1.6, 0, TAU);
    g.fill();
  });
}

function bushSprite(r, seed) {
  return treeSprite(r, seed, ['#22381c', '#36552a', '#4f7638', '#7aa055']);
}

function rockSprite(r, seed) {
  const rng = makeRng(seed);
  return sprite(r * 2 + 8, r * 2 + 8, (g) => {
    const n = 7 + Math.floor(rng() * 4);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rng() * 0.3;
      const rr = r * (0.75 + rng() * 0.25);
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    // Facets: triangle fan from an off-centre peak lit from top-left.
    const peak = [-r * 0.15, -r * 0.18];
    g.fillStyle = '#5e5a55';
    poly(g, pts);
    g.fill();
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const facing = (-mx - my) / (Math.hypot(mx, my) || 1);
      const l = Math.round(115 + facing * 55 + rng() * 14);
      g.fillStyle = `rgb(${l},${l - 4},${l - 10})`;
      poly(g, [peak, a, b]);
      g.fill();
    }
    g.strokeStyle = 'rgba(30,25,20,0.6)';
    g.lineWidth = 1;
    poly(g, pts);
    g.stroke();
    // Cracks and lichen
    g.strokeStyle = 'rgba(30,25,20,0.35)';
    g.lineWidth = 0.6;
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.moveTo(peak[0], peak[1]);
      const a = rng() * TAU;
      g.lineTo(peak[0] + Math.cos(a) * r * 0.6, peak[1] + Math.sin(a) * r * 0.6);
      g.stroke();
    }
    for (let i = 0; i < 5; i++) {
      g.fillStyle = 'rgba(140,160,70,0.35)';
      g.beginPath();
      g.arc((rng() - 0.5) * r, (rng() - 0.5) * r, 1 + rng() * 2, 0, TAU);
      g.fill();
    }
  });
}

// --- Props -----------------------------------------------------------------------

function crateSprite(s) {
  return sprite(s + 4, s + 4, (g) => {
    const h = s / 2;
    const grd = g.createLinearGradient(-h, -h, h, h);
    grd.addColorStop(0, '#c99a5b');
    grd.addColorStop(1, '#8a6233');
    g.fillStyle = grd;
    g.fillRect(-h, -h, s, s);
    g.strokeStyle = 'rgba(60,35,10,0.6)';
    g.lineWidth = 0.7;
    for (let y = -h + s / 4; y < h; y += s / 4) {
      g.beginPath();
      g.moveTo(-h, y);
      g.lineTo(h, y);
      g.stroke();
    }
    g.strokeStyle = '#6b4520';
    g.lineWidth = 2.2;
    g.strokeRect(-h + 1.1, -h + 1.1, s - 2.2, s - 2.2);
    g.beginPath();
    g.moveTo(-h + 1, -h + 1);
    g.lineTo(h - 1, h - 1);
    g.stroke();
    g.strokeStyle = 'rgba(255,220,160,0.3)';
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(-h, -h + 0.5);
    g.lineTo(h, -h + 0.5);
    g.moveTo(-h + 0.5, -h);
    g.lineTo(-h + 0.5, h);
    g.stroke();
    g.fillStyle = '#3a2a1a';
    for (const [x, y] of [[-h + 2, -h + 2], [h - 2, -h + 2], [-h + 2, h - 2], [h - 2, h - 2]]) g.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
  });
}

function barrelPropSprite(r, color) {
  return sprite(r * 2 + 4, r * 2 + 4, (g) => {
    const grd = g.createRadialGradient(-r * 0.35, -r * 0.35, 0.5, 0, 0, r);
    grd.addColorStop(0, shade(color, 0.4));
    grd.addColorStop(0.7, color);
    grd.addColorStop(1, shade(color, -0.45));
    g.fillStyle = grd;
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 1;
    g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.arc(0, 0, r * 0.72, 0, TAU);
    g.stroke();
    // Hazard mark
    g.fillStyle = '#f1c40f';
    g.beginPath();
    g.moveTo(0, -r * 0.45);
    g.lineTo(r * 0.4, r * 0.3);
    g.lineTo(-r * 0.4, r * 0.3);
    g.closePath();
    g.fill();
    g.fillStyle = '#111';
    g.fillRect(-0.5, -r * 0.18, 1, r * 0.28);
    g.fillRect(-0.5, r * 0.15, 1, 1);
    // Bung
    g.fillStyle = '#333';
    g.beginPath();
    g.arc(r * 0.45, -r * 0.35, 1.3, 0, TAU);
    g.fill();
  });
}

function sandbagSprite(len, seed) {
  const rng = makeRng(seed);
  return sprite(len + 4, 14, (g) => {
    for (let row = 0; row < 2; row++) {
      for (let x = -len / 2 + 3 + row * 3; x < len / 2 - 2; x += 7) {
        const y = row === 0 ? -2.5 : 2.5;
        const grd = g.createRadialGradient(x - 1, y - 1.5, 0.5, x, y, 5);
        const c = 170 + Math.floor(rng() * 20);
        grd.addColorStop(0, `rgb(${c + 30},${c + 18},${c - 20})`);
        grd.addColorStop(1, `rgb(${c - 50},${c - 62},${c - 95})`);
        g.fillStyle = grd;
        g.beginPath();
        g.ellipse(x, y, 4.2, 3, 0, 0, TAU);
        g.fill();
        g.strokeStyle = 'rgba(50,40,20,0.5)';
        g.lineWidth = 0.5;
        g.stroke();
      }
    }
  });
}

// Concrete gun emplacement base (octagon).
function emplacementSprite(r) {
  return sprite(r * 2 + 6, r * 2 + 6, (g) => {
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.PI / 8;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    const grd = g.createLinearGradient(-r, -r, r, r);
    grd.addColorStop(0, '#a5a29a');
    grd.addColorStop(1, '#5d5b56');
    g.fillStyle = grd;
    poly(g, pts);
    g.fill();
    bevel(g, pts, 0.5, 0.6, 2);
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 1;
    poly(g, pts);
    g.stroke();
    g.fillStyle = '#4d4b47';
    g.beginPath();
    g.arc(0, 0, r * 0.68, 0, TAU);
    g.fill();
    g.fillStyle = '#2e2d2a';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      g.beginPath();
      g.arc(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82, 1.2, 0, TAU);
      g.fill();
    }
    // Hazard stripes ring
    g.save();
    g.beginPath();
    g.arc(0, 0, r * 0.68, 0, TAU);
    g.arc(0, 0, r * 0.58, 0, TAU, true);
    g.clip();
    for (let i = 0; i < 16; i++) {
      g.fillStyle = i % 2 ? '#1a1a1a' : '#d4a017';
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, r, (i / 16) * TAU, ((i + 1) / 16) * TAU);
      g.fill();
    }
    g.restore();
  });
}

// Helicopter (faces +x).
function heliSprite() {
  return sprite(84, 40, (g) => {
    const body = '#4a5a4a';
    // Tail boom
    const tg = g.createLinearGradient(0, -3, 0, 3);
    tg.addColorStop(0, shade(body, 0.2));
    tg.addColorStop(1, shade(body, -0.4));
    g.fillStyle = tg;
    poly(g, [[-6, -3.5], [-38, -1.5], [-38, 1.5], [-6, 3.5]]);
    g.fill();
    // Tail fin & tail rotor
    g.fillStyle = shade(body, -0.2);
    poly(g, [[-34, -1.5], [-40, -8], [-41, -8], [-39, 1.5]]);
    g.fill();
    g.fillStyle = 'rgba(30,30,30,0.6)';
    g.fillRect(-41, 1, 6, 1.2);
    // Stub wings with rocket pods
    g.fillStyle = shade(body, -0.25);
    g.fillRect(-4, -15, 7, 30);
    for (const sy of [-1, 1]) {
      g.fillStyle = '#2a2a2a';
      roundRect(g, -6, sy * 13 - 2.5, 13, 5, 2.5);
      g.fill();
      g.fillStyle = '#8a2a1a';
      g.fillRect(6, sy * 13 - 1.8, 1.3, 3.6);
    }
    // Fuselage
    const fg = g.createRadialGradient(4, -4, 1, 2, 0, 20);
    fg.addColorStop(0, shade(body, 0.35));
    fg.addColorStop(0.6, body);
    fg.addColorStop(1, shade(body, -0.45));
    g.fillStyle = fg;
    g.beginPath();
    g.ellipse(2, 0, 19, 8, 0, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 0.8;
    g.stroke();
    // Canopy (tandem)
    const cg = g.createLinearGradient(8, -5, 18, 5);
    cg.addColorStop(0, '#9fd3f0');
    cg.addColorStop(0.5, '#2a5a78');
    cg.addColorStop(1, '#13283a');
    g.fillStyle = cg;
    g.beginPath();
    g.ellipse(12, 0, 8, 4.5, 0, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.beginPath();
    g.moveTo(11, -4.4);
    g.lineTo(11, 4.4);
    g.stroke();
    // Chin gun
    g.fillStyle = '#1e1e1e';
    g.fillRect(19, -1, 8, 2);
    // Red star / marking
    emblem(g, 'chevron', '#c0392b', -14, 0, 3);
    // Rotor hub
    g.fillStyle = '#222';
    g.beginPath();
    g.arc(0, 0, 3, 0, TAU);
    g.fill();
  });
}

function rotorSprite(r) {
  return sprite(r * 2 + 2, r * 2 + 2, (g) => {
    // Motion-blurred disc plus 4 blades
    const grd = g.createRadialGradient(0, 0, 2, 0, 0, r);
    grd.addColorStop(0, 'rgba(20,20,20,0.12)');
    grd.addColorStop(0.9, 'rgba(20,20,20,0.18)');
    grd.addColorStop(1, 'rgba(20,20,20,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.fill();
    for (let i = 0; i < 4; i++) {
      g.save();
      g.rotate((i / 4) * TAU);
      const bg = g.createLinearGradient(0, -2, 0, 2);
      bg.addColorStop(0, 'rgba(25,25,25,0.75)');
      bg.addColorStop(1, 'rgba(25,25,25,0.2)');
      g.fillStyle = bg;
      g.fillRect(0, -1.6, r - 1, 3.2);
      g.restore();
    }
  });
}

// Small kamikaze drone (faces +x).
function droneSprite() {
  return sprite(28, 28, (g) => {
    g.strokeStyle = '#2a2a2a';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-8, -8);
    g.lineTo(8, 8);
    g.moveTo(-8, 8);
    g.lineTo(8, -8);
    g.stroke();
    for (const [x, y] of [[-8, -8], [8, 8], [-8, 8], [8, -8]]) {
      g.fillStyle = 'rgba(40,40,40,0.35)';
      g.beginPath();
      g.arc(x, y, 5, 0, TAU);
      g.fill();
      g.fillStyle = '#222';
      g.beginPath();
      g.arc(x, y, 1.4, 0, TAU);
      g.fill();
    }
    const grd = g.createRadialGradient(-1, -1, 0.5, 0, 0, 5);
    grd.addColorStop(0, '#e05a3a');
    grd.addColorStop(1, '#6a1a10');
    g.fillStyle = grd;
    roundRect(g, -5, -4, 10, 8, 2);
    g.fill();
    g.fillStyle = '#ff3b30';
    g.beginPath();
    g.arc(4, 0, 1.3, 0, TAU);
    g.fill();
  });
}

// Mortar truck (faces +x).
function truckSprite() {
  return sprite(60, 30, (g) => {
    const c = '#6b6a45';
    // Wheels
    g.fillStyle = '#151515';
    for (const x of [-18, -8, 14]) {
      roundRect(g, x - 4, -13, 8, 4, 1.5);
      g.fill();
      roundRect(g, x - 4, 9, 8, 4, 1.5);
      g.fill();
    }
    // Bed
    const bg = g.createLinearGradient(-25, -10, 5, 10);
    bg.addColorStop(0, shade(c, 0.2));
    bg.addColorStop(1, shade(c, -0.35));
    g.fillStyle = bg;
    roundRect(g, -27, -10, 34, 20, 2);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 0.8;
    g.stroke();
    // Mortar tubes
    for (const [x, y] of [[-18, -4], [-18, 4], [-9, -4], [-9, 4]]) {
      g.fillStyle = '#222';
      g.beginPath();
      g.arc(x, y, 3.2, 0, TAU);
      g.fill();
      g.fillStyle = '#000';
      g.beginPath();
      g.arc(x, y, 2, 0, TAU);
      g.fill();
    }
    // Cab
    const cg = g.createLinearGradient(8, -9, 26, 9);
    cg.addColorStop(0, shade(c, 0.3));
    cg.addColorStop(1, shade(c, -0.3));
    g.fillStyle = cg;
    roundRect(g, 8, -9, 19, 18, 3);
    g.fill();
    g.stroke();
    g.fillStyle = '#20384a';
    roundRect(g, 19, -7, 5, 14, 1.5);
    g.fill();
    g.fillStyle = 'rgba(160,210,240,0.4)';
    g.fillRect(20, -6, 1.2, 12);
    emblem(g, 'chevron', '#c0392b', 12, 0, 2.5);
  });
}

// --- Pickups & projectiles -----------------------------------------------------------

function pickupSprite(kind) {
  const colors = { repair: '#2ecc71', missiles: '#e67e22', overdrive: '#9b59b6', shield: '#3498db', nuke: '#f1c40f' };
  const col = colors[kind];
  return sprite(34, 34, (g) => {
    const grd = g.createRadialGradient(-3, -3, 1, 0, 0, 13);
    grd.addColorStop(0, shade(col, 0.5));
    grd.addColorStop(0.7, col);
    grd.addColorStop(1, shade(col, -0.4));
    g.fillStyle = grd;
    roundRect(g, -12, -12, 24, 24, 5);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 1.5;
    g.stroke();
    g.fillStyle = '#fff';
    g.strokeStyle = '#fff';
    g.lineWidth = 2.6;
    g.lineCap = 'round';
    if (kind === 'repair') {
      g.fillRect(-2.5, -8, 5, 16);
      g.fillRect(-8, -2.5, 16, 5);
    } else if (kind === 'missiles') {
      for (const x of [-5, 0, 5]) {
        g.beginPath();
        g.moveTo(x, -8);
        g.lineTo(x + 2, -5);
        g.lineTo(x + 2, 6);
        g.lineTo(x - 2, 6);
        g.lineTo(x - 2, -5);
        g.closePath();
        g.fill();
      }
    } else if (kind === 'overdrive') {
      poly(g, [[2, -9], [-6, 1], [-1, 1], [-3, 9], [6, -2], [1, -2]]);
      g.fill();
    } else if (kind === 'shield') {
      g.beginPath();
      g.moveTo(0, -8);
      g.lineTo(7, -5);
      g.quadraticCurveTo(6, 5, 0, 9);
      g.quadraticCurveTo(-6, 5, -7, -5);
      g.closePath();
      g.fill();
    } else if (kind === 'nuke') {
      g.fillStyle = '#222';
      g.beginPath();
      g.arc(0, 0, 2.2, 0, TAU);
      g.fill();
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.moveTo(0, 0);
        g.arc(0, 0, 8, (i / 3) * TAU - 0.5, (i / 3) * TAU + 0.5);
        g.closePath();
        g.fill();
      }
    }
  });
}

function shellSprite(len, w, color) {
  return sprite(len + 4, w + 4, (g) => {
    const grd = g.createLinearGradient(0, -w / 2, 0, w / 2);
    grd.addColorStop(0, shade(color, 0.5));
    grd.addColorStop(0.5, color);
    grd.addColorStop(1, shade(color, -0.4));
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(len / 2, 0);
    g.quadraticCurveTo(len / 2 - w, -w / 2, len / 4, -w / 2);
    g.lineTo(-len / 2, -w / 2);
    g.lineTo(-len / 2, w / 2);
    g.lineTo(len / 4, w / 2);
    g.quadraticCurveTo(len / 2 - w, w / 2, len / 2, 0);
    g.fill();
  });
}

function missileSprite() {
  return sprite(22, 10, (g) => {
    g.fillStyle = '#ddd';
    roundRect(g, -8, -2, 15, 4, 2);
    g.fill();
    g.fillStyle = '#c0392b';
    g.beginPath();
    g.moveTo(10, 0);
    g.lineTo(6, -2);
    g.lineTo(6, 2);
    g.closePath();
    g.fill();
    g.fillStyle = '#555';
    poly(g, [[-8, -2], [-10, -4.5], [-5, -2]]);
    g.fill();
    poly(g, [[-8, 2], [-10, 4.5], [-5, 2]]);
    g.fill();
  });
}

// --- Effects ---------------------------------------------------------------------------

// Soft round particle, cached per colour.
const softCache = new Map();
export function soft(color, size = 32) {
  const key = color + size;
  let s = softCache.get(key);
  if (!s) {
    s = sprite(size, size, (g) => {
      const grd = g.createRadialGradient(0, 0, 0, 0, 0, size / 2);
      grd.addColorStop(0, rgba(color, 1));
      grd.addColorStop(0.4, rgba(color, 0.6));
      grd.addColorStop(1, rgba(color, 0));
      g.fillStyle = grd;
      g.fillRect(-size / 2, -size / 2, size, size);
    });
    softCache.set(key, s);
  }
  return s;
}

// Puffy smoke texture with a bit of internal structure.
function smokeSprite(seed, color) {
  const rng = makeRng(seed);
  return sprite(64, 64, (g) => {
    for (let i = 0; i < 9; i++) {
      const x = (rng() - 0.5) * 22, y = (rng() - 0.5) * 22, r = 12 + rng() * 12;
      const grd = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
      grd.addColorStop(0, rgba(color, 0.55));
      grd.addColorStop(0.6, rgba(color, 0.25));
      grd.addColorStop(1, rgba(color, 0));
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    }
  });
}

function muzzleFlashSprite() {
  return sprite(70, 46, (g) => {
    g.translate(-30, 0);
    const layers = [
      ['rgba(255,140,30,0.6)', 34, 12],
      ['rgba(255,200,60,0.85)', 26, 8],
      ['rgba(255,250,210,1)', 16, 4.5],
    ];
    for (const [c, len, w] of layers) {
      g.fillStyle = c;
      g.beginPath();
      g.moveTo(0, -w * 0.6);
      g.quadraticCurveTo(len * 0.6, -w, len, 0);
      g.quadraticCurveTo(len * 0.6, w, 0, w * 0.6);
      g.closePath();
      g.fill();
    }
    // Muzzle-brake side jets
    for (const sy of [-1, 1]) {
      g.fillStyle = 'rgba(255,180,60,0.75)';
      g.beginPath();
      g.moveTo(2, sy * 2);
      g.quadraticCurveTo(6, sy * 14, 4, sy * 20);
      g.quadraticCurveTo(0, sy * 10, -1, sy * 2);
      g.fill();
    }
  });
}

function scorchSprite(r, seed) {
  const rng = makeRng(seed);
  return sprite(r * 2.4, r * 2.4, (g) => {
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, r);
    grd.addColorStop(0, 'rgba(15,10,5,0.75)');
    grd.addColorStop(0.5, 'rgba(25,18,10,0.5)');
    grd.addColorStop(1, 'rgba(30,20,10,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.fill();
    // Radial streaks
    g.strokeStyle = 'rgba(20,12,6,0.35)';
    for (let i = 0; i < 14; i++) {
      const a = rng() * TAU, l = r * (0.6 + rng() * 0.6);
      g.lineWidth = 0.6 + rng() * 1.5;
      g.beginPath();
      g.moveTo(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3);
      g.lineTo(Math.cos(a) * l, Math.sin(a) * l);
      g.stroke();
    }
    // Crater rim
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(0, 0, r * 0.32, 0, TAU);
    g.stroke();
    g.strokeStyle = 'rgba(255,230,190,0.08)';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(-0.7, -0.7, r * 0.34, Math.PI, Math.PI * 1.6);
    g.stroke();
  });
}

function debrisSprite(color, seed) {
  const rng = makeRng(seed);
  return sprite(10, 10, (g) => {
    const pts = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + rng() * 0.6;
      const r = 2 + rng() * 3;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    g.fillStyle = color;
    poly(g, pts);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 0.6;
    g.stroke();
  });
}

function ringSprite() {
  return sprite(128, 128, (g) => {
    const grd = g.createRadialGradient(0, 0, 40, 0, 0, 62);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.7, 'rgba(255,240,220,0.7)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(0, 0, 62, 0, TAU);
    g.fill();
  });
}

// Building roof texture for perspective buildings (drawn stretched).
export function roofSprite(w, h, seed, palette) {
  const rng = makeRng(seed);
  return sprite(w, h, (g) => {
    g.translate(-w / 2, -h / 2);
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, shade(palette, 0.15));
    grd.addColorStop(1, shade(palette, -0.2));
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    // Parapet
    g.strokeStyle = shade(palette, -0.35);
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, w - 3, h - 3);
    g.strokeStyle = shade(palette, 0.3);
    g.lineWidth = 1;
    g.strokeRect(3.5, 3.5, w - 7, h - 7);
    // Tiles / slabs
    g.strokeStyle = 'rgba(0,0,0,0.08)';
    for (let x = 12; x < w - 4; x += 12) {
      g.beginPath();
      g.moveTo(x, 4);
      g.lineTo(x, h - 4);
      g.stroke();
    }
    for (let y = 12; y < h - 4; y += 12) {
      g.beginPath();
      g.moveTo(4, y);
      g.lineTo(w - 4, y);
      g.stroke();
    }
    // AC units / vents / hatches
    const n = Math.floor((w * h) / 1800) + 1;
    for (let i = 0; i < n; i++) {
      const bw = 8 + rng() * 10, bh = 8 + rng() * 10;
      const x = 8 + rng() * (w - bw - 16), y = 8 + rng() * (h - bh - 16);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x + 2, y + 2, bw, bh);
      g.fillStyle = rng() < 0.5 ? '#9a9a92' : '#7c7c74';
      g.fillRect(x, y, bw, bh);
      g.strokeStyle = 'rgba(0,0,0,0.4)';
      g.lineWidth = 0.6;
      g.strokeRect(x, y, bw, bh);
      if (rng() < 0.6) {
        g.strokeStyle = 'rgba(0,0,0,0.5)';
        g.beginPath();
        g.arc(x + bw / 2, y + bh / 2, Math.min(bw, bh) * 0.33, 0, TAU);
        g.stroke();
      }
    }
    grit(g, 0, 0, w, h, w * h * 0.05, 0.08, seed);
    // Water stains
    for (let i = 0; i < 3; i++) {
      const x = rng() * w, y = rng() * h, r = 6 + rng() * 14;
      const sg = g.createRadialGradient(x, y, 0, x, y, r);
      sg.addColorStop(0, 'rgba(0,0,0,0.12)');
      sg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = sg;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
}

// --- Bank ---------------------------------------------------------------------------------

export function buildSprites() {
  const tanks = {};
  let seed = 11;
  for (const [name, style] of Object.entries(TANK_STYLES)) tanks[name] = makeTankSet(name, style, seed++);

  const leafy = [
    ['#1f3a1a', '#2f5626', '#467a34', '#78a850'],
    ['#2a3c18', '#3d5a22', '#5b7f2e', '#94b555'],
    ['#1c3324', '#2a4d33', '#3f6e45', '#6f9a6a'],
  ];
  const trees = [];
  for (let i = 0; i < 9; i++) trees.push(treeSprite(26 + (i % 3) * 6, 100 + i, leafy[i % 3]));
  const pines = [];
  for (let i = 0; i < 4; i++) pines.push(pineSprite(20 + i * 3, 200 + i));
  const bushes = [];
  for (let i = 0; i < 5; i++) bushes.push(bushSprite(10 + (i % 3) * 2, 300 + i));
  const rocks = [];
  for (let i = 0; i < 6; i++) rocks.push(rockSprite(16 + i * 4, 400 + i));

  return {
    tanks,
    trees,
    pines,
    bushes,
    rocks,
    treeShadow: shadowSprite(56, 56, 0, 6, true),
    crate: crateSprite(22),
    crateShadow: shadowSprite(22, 22, 2, 3),
    barrel: barrelPropSprite(9, '#b03a2e'),
    barrelShadow: shadowSprite(18, 18, 0, 3, true),
    sandbag: sandbagSprite(56, 9),
    emplacement: emplacementSprite(30),
    emplacementShadow: shadowSprite(62, 62, 0, 4, true),
    heli: heliSprite(),
    heliShadow: shadowSprite(46, 18, 9, 5),
    rotor: rotorSprite(38),
    drone: droneSprite(),
    droneShadow: shadowSprite(20, 20, 0, 4, true),
    truck: truckSprite(),
    truckShadow: shadowSprite(56, 26, 3, 4),
    pickups: {
      repair: pickupSprite('repair'),
      missiles: pickupSprite('missiles'),
      overdrive: pickupSprite('overdrive'),
      shield: pickupSprite('shield'),
      nuke: pickupSprite('nuke'),
    },
    shell: shellSprite(12, 4, '#f5d76e'),
    shellEnemy: shellSprite(12, 4, '#ff7b5a'),
    bigShell: shellSprite(18, 6, '#ff5a3a'),
    missile: missileSprite(),
    smoke: [0, 1, 2, 3].map((i) => smokeSprite(500 + i, '#9a9a96')),
    darkSmoke: [0, 1, 2].map((i) => smokeSprite(600 + i, '#2a2622')),
    dust: [0, 1].map((i) => smokeSprite(700 + i, '#b9a27a')),
    muzzle: muzzleFlashSprite(),
    scorch: [0, 1, 2].map((i) => scorchSprite(30, 800 + i)),
    debris: {
      metal: [0, 1, 2].map((i) => debrisSprite('#4a4a44', 900 + i)),
      wood: [0, 1, 2].map((i) => debrisSprite('#8a6233', 950 + i)),
      stone: [0, 1, 2].map((i) => debrisSprite('#8d8a84', 980 + i)),
      leaf: [0, 1, 2].map((i) => debrisSprite('#3f6a2e', 990 + i)),
    },
    ring: ringSprite(),
    glow: soft('#ffffff', 64),
  };
}
