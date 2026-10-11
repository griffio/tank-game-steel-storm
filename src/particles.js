// Particle system and high-level visual effects (explosions, smoke, debris,
// sparks, muzzle flashes, dynamic lights).

import { Pool, rand, randInt, pick, TAU, clamp } from './util.js';
import { soft, drawSprite } from './sprites.js';

class Particle {
  constructor() {
    this.alive = false;
  }
}

// Layers: 0 = ground (under vehicles), 1 = air (above everything).
export class Particles {
  constructor(sprites, world) {
    this.sprites = sprites;
    this.world = world;
    this.pool = new Pool(() => new Particle(), 4000);
    this.lights = [];
    this.rings = [];
    this.count = 0;
    this.fire = soft('#ff8a2a', 48);
    this.fireCore = soft('#fff1b0', 48);
    this.fireRed = soft('#d23a10', 48);
    this.spark = soft('#ffd27a', 16);
    this.blue = soft('#7ad7ff', 32);
    this.white = soft('#ffffff', 32);
    this.green = soft('#7dff8a', 32);
    this.purple = soft('#c77dff', 32);
    this.water = soft('#d8f2ff', 32);
  }

  spawn(o) {
    const p = this.pool.obtain();
    p.alive = true;
    p.x = o.x;
    p.y = o.y;
    p.z = o.z ?? 0;
    p.vx = o.vx ?? 0;
    p.vy = o.vy ?? 0;
    p.vz = o.vz ?? 0;
    p.gravity = o.gravity ?? 0;
    p.drag = o.drag ?? 0;
    p.life = 0;
    p.max = o.life ?? 1;
    p.delay = o.delay ?? 0;
    p.size0 = o.size ?? 10;
    p.size1 = o.size1 ?? p.size0;
    p.alpha0 = o.alpha ?? 1;
    p.alpha1 = o.alpha1 ?? 0;
    p.rot = o.rot ?? rand(0, TAU);
    p.vrot = o.vrot ?? 0;
    p.spr = o.spr;
    p.add = !!o.add;
    p.layer = o.layer ?? 1;
    p.stretch = o.stretch ?? 0; // velocity-aligned streaks (sparks)
    p.bounce = o.bounce ?? 0;
    p.stampOnLand = o.stampOnLand ?? false;
    p.shadow = o.shadow ?? false;
    p.fadeIn = o.fadeIn ?? 0;
    return p;
  }

  light(x, y, radius, color, life, intensity = 1) {
    this.lights.push({ x, y, radius, color, life, max: life, intensity });
  }

  ring(x, y, r0, r1, life, alpha = 0.8) {
    this.rings.push({ x, y, r0, r1, life: 0, max: life, alpha });
  }

  update(dt) {
    let n = 0;
    for (const p of this.pool.items) {
      if (!p.alive) continue;
      if (p.delay > 0) {
        p.delay -= dt;
        continue;
      }
      p.life += dt;
      if (p.life >= p.max) {
        p.alive = false;
        continue;
      }
      n++;
      if (p.drag) {
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k;
        p.vy *= k;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
      if (p.gravity) {
        p.vz -= p.gravity * dt;
        p.z += p.vz * dt;
        if (p.z <= 0) {
          p.z = 0;
          if (p.bounce && Math.abs(p.vz) > 40) {
            p.vz = -p.vz * p.bounce;
            p.vx *= 0.6;
            p.vy *= 0.6;
            p.vrot *= 0.5;
          } else {
            p.vz = 0;
            p.vx *= 0.85;
            p.vy *= 0.85;
            p.vrot *= 0.8;
            if (p.stampOnLand && this.world) {
              this.world.stamp(p.spr, p.x, p.y, p.rot, 0.9, p.size0 / p.spr.w);
              p.alive = false;
            }
          }
        }
      }
    }
    this.count = n;
    for (let i = this.lights.length - 1; i >= 0; i--) {
      const l = this.lights[i];
      l.life -= dt;
      if (l.life <= 0) this.lights.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life += dt;
      if (r.life >= r.max) this.rings.splice(i, 1);
    }
  }

  // Camera transform (set by the game each frame) so each particle can use a
  // single setTransform instead of save/translate/rotate/restore.
  setCamera(z, tx, ty) {
    this.camZ = z;
    this.camTX = tx;
    this.camTY = ty;
  }

  _xf(ctx, x, y, rot) {
    const z = this.camZ, c = Math.cos(rot) * z, s = Math.sin(rot) * z;
    ctx.setTransform(c, s, -s, c, x * z + this.camTX, y * z + this.camTY);
  }

  _restoreCam(ctx) {
    ctx.setTransform(this.camZ, 0, 0, this.camZ, this.camTX, this.camTY);
  }

  render(ctx, layer, view) {
    const pad = 80;
    for (const p of this.pool.items) {
      if (!p.alive || p.delay > 0 || p.layer !== layer) continue;
      if (p.x < view.x0 - pad || p.x > view.x1 + pad || p.y < view.y0 - pad || p.y > view.y1 + pad) continue;
      const t = p.life / p.max;
      const size = p.size0 + (p.size1 - p.size0) * t;
      let alpha = p.alpha0 + (p.alpha1 - p.alpha0) * t;
      if (p.fadeIn && t < p.fadeIn) alpha *= t / p.fadeIn;
      if (alpha <= 0.01) continue;
      const spr = p.spr;
      const sc = size / spr.w;
      // Height lifts the sprite up-left and casts a ground shadow.
      if (p.shadow && p.z > 1) {
        ctx.globalAlpha = 0.3 * alpha;
        this._xf(ctx, p.x + p.z * 0.25, p.y + p.z * 0.35, p.rot);
        ctx.drawImage(spr.img, (-spr.w / 2) * sc, (-spr.h / 2) * sc, spr.w * sc, spr.h * sc);
      }
      const x = p.x - p.z * 0.15, y = p.y - p.z * 0.5;
      ctx.globalAlpha = alpha;
      if (p.add) ctx.globalCompositeOperation = 'lighter';
      if (p.stretch) {
        const sp = Math.hypot(p.vx, p.vy);
        const len = Math.max(size, sp * p.stretch);
        this._xf(ctx, x, y, Math.atan2(p.vy, p.vx));
        ctx.drawImage(spr.img, -len / 2, -size / 2, len, size);
      } else {
        this._xf(ctx, x, y, p.rot);
        ctx.drawImage(spr.img, (-spr.w / 2) * sc, (-spr.h / 2) * sc, spr.w * sc, spr.h * sc);
      }
      if (p.add) ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
    this._restoreCam(ctx);
    if (layer === 1) {
      for (const r of this.rings) {
        const t = r.life / r.max;
        const rad = r.r0 + (r.r1 - r.r0) * (1 - (1 - t) * (1 - t));
        ctx.globalAlpha = r.alpha * (1 - t);
        drawSprite(ctx, this.sprites.ring, r.x, r.y, 0, (rad * 2) / 124);
      }
      ctx.globalAlpha = 1;
    }
  }

  // Additive light glow pass.
  renderLights(ctx, view) {
    if (!this.lights.length) return;
    ctx.globalCompositeOperation = 'lighter';
    for (const l of this.lights) {
      if (l.x < view.x0 - l.radius || l.x > view.x1 + l.radius || l.y < view.y0 - l.radius || l.y > view.y1 + l.radius) continue;
      const t = l.life / l.max;
      ctx.globalAlpha = clamp(t * l.intensity, 0, 1);
      const spr = soft(l.color, 64);
      const s = l.radius * 2;
      ctx.drawImage(spr.img, l.x - s / 2, l.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // --- High-level effects -----------------------------------------------------------

  explosion(x, y, size = 1, opts = {}) {
    const sp = this.sprites;
    // Flash core
    this.spawn({ x, y, spr: this.fireCore, size: 60 * size, size1: 95 * size, life: 0.16, alpha: 0.9, add: true });
    // Fireballs
    const nf = Math.round(10 * size + 4);
    for (let i = 0; i < nf; i++) {
      const a = rand(0, TAU), s = rand(30, 160) * size;
      this.spawn({
        x: x + Math.cos(a) * rand(0, 10) * size,
        y: y + Math.sin(a) * rand(0, 10) * size,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        drag: 3.5,
        spr: pick([this.fire, this.fire, this.fireCore, this.fireRed]),
        size: rand(28, 52) * size,
        size1: rand(50, 90) * size,
        life: rand(0.35, 0.7),
        alpha: 1,
        add: true,
        delay: rand(0, 0.08),
      });
    }
    // Smoke
    const ns = Math.round(8 * size + 3);
    for (let i = 0; i < ns; i++) {
      const a = rand(0, TAU), s = rand(20, 90) * size;
      this.spawn({
        x: x + Math.cos(a) * 6,
        y: y + Math.sin(a) * 6,
        vx: Math.cos(a) * s + 8,
        vy: Math.sin(a) * s - 10,
        drag: 1.4,
        spr: pick(opts.dirt ? sp.dust : sp.darkSmoke),
        size: rand(30, 50) * size,
        size1: rand(90, 150) * size,
        life: rand(1.4, 2.8),
        alpha: 0.75,
        vrot: rand(-0.6, 0.6),
        delay: rand(0.05, 0.25),
        fadeIn: 0.1,
      });
    }
    // Sparks / embers
    const nk = Math.round(16 * size);
    for (let i = 0; i < nk; i++) {
      const a = rand(0, TAU), s = rand(200, 600) * size;
      this.spawn({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        drag: 2.5,
        spr: this.spark,
        size: rand(3, 6),
        life: rand(0.3, 0.9),
        alpha: 1,
        add: true,
        stretch: 0.04,
      });
    }
    // Ground debris chunks with arcs and shadows.
    const kind = opts.debris ?? 'stone';
    const nd = Math.round(6 * size);
    for (let i = 0; i < nd; i++) {
      const a = rand(0, TAU), s = rand(60, 220) * size;
      this.spawn({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        vz: rand(150, 420) * Math.sqrt(size),
        gravity: 900,
        bounce: 0.35,
        spr: pick(sp.debris[kind]),
        size: rand(5, 10) * Math.sqrt(size),
        life: rand(1.5, 3),
        alpha: 1,
        alpha1: 0.9,
        vrot: rand(-12, 12),
        shadow: true,
        stampOnLand: Math.random() < 0.5,
      });
    }
    this.ring(x, y, 10 * size, 140 * size, 0.45, 0.6);
    this.light(x, y, 170 * size, '#ff9a40', 0.3 + size * 0.08, 0.55);
    if (!opts.noScorch && this.world) {
      this.world.stamp(pick(sp.scorch), x, y, rand(0, TAU), 0.85, size * rand(0.9, 1.25));
    }
  }

  smallHit(x, y, ang, color = '#ffd27a') {
    for (let i = 0; i < 8; i++) {
      const a = ang + Math.PI + rand(-1.1, 1.1), s = rand(120, 420);
      this.spawn({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, drag: 4, spr: this.spark, size: rand(2, 4), life: rand(0.15, 0.4), add: true, stretch: 0.035 });
    }
    this.spawn({ x, y, spr: soft(color, 32), size: 26, size1: 36, life: 0.1, add: true });
    this.light(x, y, 50, '#ffcc66', 0.08, 0.8);
  }

  dirtHit(x, y, color = '#8a7354') {
    for (let i = 0; i < 6; i++) {
      const a = rand(0, TAU), s = rand(30, 120);
      this.spawn({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rand(60, 200), gravity: 700, spr: soft(color, 16), size: rand(3, 6), life: rand(0.4, 0.8), alpha: 0.9, shadow: true });
    }
    this.spawn({ x, y, spr: pick(this.sprites.dust), size: 14, size1: 34, life: 0.8, alpha: 0.5, drag: 2 });
  }

  muzzle(x, y, ang, scale = 1) {
    // Directional flash + gas puffs + smoke.
    this.spawn({ x: x + Math.cos(ang) * 20 * scale, y: y + Math.sin(ang) * 20 * scale, spr: this.sprites.muzzle, size: 70 * scale, life: 0.07, alpha: 1, alpha1: 0.6, rot: ang, add: true });
    for (let i = 0; i < 6; i++) {
      const a = ang + rand(-0.4, 0.4), s = rand(60, 220) * scale;
      this.spawn({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, drag: 4, spr: pick(this.sprites.smoke), size: rand(12, 20) * scale, size1: rand(40, 60) * scale, life: rand(0.6, 1.2), alpha: 0.55, vrot: rand(-1, 1) });
    }
    for (const side of [-1, 1]) {
      const a = ang + side * Math.PI / 2;
      this.spawn({ x, y, vx: Math.cos(a) * 140 * scale, vy: Math.sin(a) * 140 * scale, drag: 5, spr: pick(this.sprites.smoke), size: 14 * scale, size1: 36 * scale, life: 0.7, alpha: 0.5 });
    }
    this.light(x, y, 120 * scale, '#ffc070', 0.08, 1);
  }

  mgFlash(x, y, ang) {
    this.spawn({ x: x + Math.cos(ang) * 6, y: y + Math.sin(ang) * 6, spr: this.sprites.muzzle, size: 24, life: 0.04, rot: ang, add: true });
    this.light(x, y, 40, '#ffd080', 0.05, 0.7);
  }

  smoke(x, y, size = 1, dark = false, vx = 0, vy = 0) {
    const sp = this.sprites;
    this.spawn({
      x: x + rand(-4, 4),
      y: y + rand(-4, 4),
      vx: vx + rand(-10, 10) + 10,
      vy: vy + rand(-10, 10) - 14,
      drag: 0.6,
      spr: pick(dark ? sp.darkSmoke : sp.smoke),
      size: 16 * size,
      size1: 60 * size,
      life: rand(1.5, 2.5),
      alpha: dark ? 0.6 : 0.4,
      vrot: rand(-0.5, 0.5),
      fadeIn: 0.15,
    });
  }

  flame(x, y, size = 1) {
    this.spawn({ x: x + rand(-5, 5), y: y + rand(-5, 5), vx: rand(-15, 15) + 8, vy: rand(-15, 15) - 30, drag: 1, spr: pick([this.fire, this.fireRed, this.fireCore]), size: rand(14, 22) * size, size1: 4, life: rand(0.3, 0.6), alpha: 0.9, add: true });
  }

  dust(x, y, color, size = 1, vx = 0, vy = 0) {
    this.spawn({ x, y, vx: vx + rand(-15, 15), vy: vy + rand(-15, 15), drag: 2, spr: soft(color, 32), size: 10 * size, size1: 34 * size, life: rand(0.6, 1.1), alpha: 0.35, layer: 0 });
  }

  splash(x, y, size = 1) {
    for (let i = 0; i < 10 * size; i++) {
      const a = rand(0, TAU), s = rand(30, 140) * size;
      this.spawn({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rand(80, 260) * size, gravity: 800, spr: this.water, size: rand(3, 7), life: rand(0.4, 0.9), alpha: 0.9, shadow: true });
    }
    this.ring(x, y, 4, 40 * size, 0.6, 0.5);
  }

  wake(x, y) {
    this.spawn({ x, y, spr: this.water, size: 8, size1: 30, life: 0.9, alpha: 0.35, layer: 0 });
  }

  debris(x, y, kind, count, speed = 200, up = 300) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU), s = rand(0.3, 1) * speed;
      this.spawn({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        vz: rand(0.4, 1) * up,
        gravity: 900,
        bounce: 0.3,
        spr: pick(this.sprites.debris[kind]),
        size: rand(5, 10),
        life: rand(1.5, 3),
        alpha: 1,
        alpha1: 0.9,
        vrot: rand(-10, 10),
        shadow: true,
        stampOnLand: Math.random() < 0.6,
      });
    }
  }

  leaves(x, y, count = 14) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU), s = rand(20, 140);
      this.spawn({ x: x + rand(-15, 15), y: y + rand(-15, 15), vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rand(50, 200), gravity: 200, drag: 1.5, spr: pick(this.sprites.debris.leaf), size: rand(4, 8), life: rand(1.2, 2.4), alpha: 1, vrot: rand(-6, 6), shadow: true });
    }
  }

  trail(x, y, color = '#cccccc', size = 1) {
    this.spawn({ x, y, vx: rand(-8, 8), vy: rand(-8, 8), drag: 1, spr: pick(this.sprites.smoke), size: 6 * size, size1: 26 * size, life: rand(0.6, 1.0), alpha: 0.45, vrot: rand(-1, 1) });
    this.spawn({ x, y, spr: this.fire, size: 10 * size, size1: 2, life: 0.12, add: true });
  }

  shellCasing(x, y, ang) {
    const a = ang + Math.PI / 2 + rand(-0.3, 0.3), s = rand(60, 120);
    this.spawn({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rand(80, 160), gravity: 700, bounce: 0.4, spr: soft('#e0b040', 16), size: 3, life: 1.2, alpha: 1, alpha1: 0.7, shadow: true });
  }

  pickupBurst(x, y, color) {
    const spr = soft(color, 32);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU, s = rand(120, 260);
      this.spawn({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, drag: 3, spr, size: rand(5, 9), life: rand(0.4, 0.7), add: true });
    }
    this.ring(x, y, 10, 70, 0.4, 0.7);
    this.light(x, y, 120, color, 0.3, 0.9);
  }

  boostFlame(x, y, ang, scale = 1) {
    const a = ang + Math.PI + rand(-0.15, 0.15), s = rand(140, 260);
    this.spawn({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, drag: 3, spr: pick([this.fire, this.fireCore, this.blue]), size: rand(10, 16) * scale, size1: 3, life: rand(0.15, 0.3), add: true });
  }

  tankDeath(x, y, size = 1) {
    this.explosion(x, y, 1.6 * size, { debris: 'metal' });
    // Secondary cook-off pops.
    for (let i = 0; i < 4; i++) {
      const d = 0.15 + i * rand(0.12, 0.22);
      const ox = rand(-25, 25) * size, oy = rand(-25, 25) * size;
      this.spawn({ x: x + ox, y: y + oy, spr: this.fireCore, size: 50 * size, size1: 90 * size, life: 0.25, add: true, delay: d });
      for (let k = 0; k < 5; k++) {
        const a = rand(0, TAU), s = rand(40, 140);
        this.spawn({ x: x + ox, y: y + oy, vx: Math.cos(a) * s, vy: Math.sin(a) * s, drag: 3, spr: this.fire, size: rand(25, 40) * size, size1: 60 * size, life: 0.5, add: true, delay: d });
      }
    }
    this.ring(x, y, 20, 260 * size, 0.6, 0.8);
    this.light(x, y, 260 * size, '#ff8a30', 0.5, 0.6);
  }

  nukeBlast(x, y) {
    this.ring(x, y, 20, 900, 1.2, 1);
    this.ring(x, y, 20, 600, 0.9, 0.8);
    this.light(x, y, 1400, '#fff0c0', 1.2, 1.4);
    for (let i = 0; i < 30; i++) {
      const a = rand(0, TAU), d = rand(0, 500);
      this.explosion(x + Math.cos(a) * d, y + Math.sin(a) * d, rand(0.8, 1.8), { noScorch: Math.random() < 0.5 });
    }
  }
}

