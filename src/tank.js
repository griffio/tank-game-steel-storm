// Tracked vehicle built on the rigid-body core. Each track pushes at its own
// line of action, so steering comes from differential thrust; four contact
// patches resist rolling and side-slip (capped by terrain grip, so tanks slide
// and drift when pushed hard).

import { Body } from './physics.js';
import { TERRAIN_PROPS, T } from './world.js';
import { clamp, approachAngle, rand, chance, TAU, angleDiff } from './util.js';
import { drawSprite } from './sprites.js';
import { audio } from './audio.js';

export const LAYER = { TANK: 1, PROP: 2, WRECK: 4 };

// accel: px/s^2 at full drive; vmax: top speed on neutral terrain.
export const SPECS = {
  player: { mass: 50, accel: 950, vmax: 340, hp: 150, turretSpeed: 7.5, reload: 0.5, damage: 34, shellSpeed: 1250, splash: 46, recoil: 6500, turnK: 1.0, mg: true, boostMul: 1.75 },
  scout: { mass: 26, accel: 620, vmax: 330, hp: 30, turretSpeed: 4.5, reload: 0.25, damage: 1.1, shellSpeed: 950, splash: 0, recoil: 0, turnK: 1.0, weapon: 'mg', score: 100 },
  battle: { mass: 50, accel: 460, vmax: 240, hp: 75, turretSpeed: 2.6, reload: 2.3, damage: 11, shellSpeed: 820, splash: 30, recoil: 4000, turnK: 1.0, weapon: 'cannon', score: 250 },
  heavy: { mass: 95, accel: 380, vmax: 190, hp: 220, turretSpeed: 1.8, reload: 2.8, damage: 13, shellSpeed: 800, splash: 40, recoil: 8000, turnK: 1.4, weapon: 'twin', score: 600 },
  boss: { mass: 420, accel: 300, vmax: 140, hp: 2600, turretSpeed: 1.6, reload: 1.8, damage: 13, shellSpeed: 860, splash: 60, recoil: 0, turnK: 3.2, weapon: 'boss', score: 5000 },
  truck: { mass: 30, accel: 520, vmax: 260, hp: 45, turretSpeed: 0, reload: 5, damage: 16, shellSpeed: 0, splash: 80, recoil: 0, turnK: 1.3, weapon: 'mortar', score: 400, wheeled: true },
};

export class Tank {
  constructor(game, kind, x, y, angle, team) {
    this.game = game;
    this.kind = kind;
    this.team = team;
    this.spec = { ...SPECS[kind] };
    this.set = game.sprites.tanks[kind === 'truck' ? 'battle' : kind];
    const st = this.set.style;
    this.L = kind === 'truck' ? 56 : st.L;
    this.W = kind === 'truck' ? 26 : st.W;
    this.body = new Body({
      shape: 'box',
      x,
      y,
      angle,
      hw: this.L / 2 - 2,
      hh: this.W / 2 - 1,
      mass: this.spec.mass,
      restitution: 0.15,
      friction: 0.6,
      layer: LAYER.TANK,
    });
    this.body.kind = 'tank';
    this.body.owner = this;
    game.physics.add(this.body);

    this.hp = this.maxHp = this.spec.hp;
    this.alive = true;
    this.throttle = 0;
    this.turn = 0;
    this.aim = angle;
    this.turretAngle = angle;
    this.wantFire = false;
    this.wantMg = false;
    this.wantBoost = false;
    this.cooldown = rand(0.3, 1);
    this.mgCooldown = 0;
    this.mgHeat = 0;
    this.overheated = false;
    this.recoil = 0;
    this.boostEnergy = 1;
    this.boosting = false;
    this.trackOff = [0, 0];
    this.lastMark = [null, null];
    this.flash = 0;
    this.shield = 0;
    this.lastHitTime = -10;
    this.slip = 0;
    this.terrain = T.GRASS;
    this.wasInWater = false;
    this.exhaustTimer = 0;
    this.trackY = this.W * 0.36;
    this.trackW = this.set.trackW;
    // Mutable modifiers (player upgrades)
    this.mods = { speed: 1, reload: 1, damage: 1, splash: 1, armor: 1, ram: 1, mgRate: 1, mgHeat: 1, ricochet: 0, spread: 0, cluster: 0, regen: 0, boostRegen: 1 };
  }

  get x() {
    return this.body.x;
  }
  get y() {
    return this.body.y;
  }
  get angle() {
    return this.body.angle;
  }

  // World position of the turret pivot.
  pivot() {
    return this.body.toWorld(-this.L * 0.06, 0);
  }

  muzzle(offset = 0) {
    const [px, py] = this.pivot();
    const len = this.L * 0.18 + this.set.barrelLen - this.recoil * 6;
    const c = Math.cos(this.turretAngle), s = Math.sin(this.turretAngle);
    return [px + c * len - s * offset, py + s * len + c * offset];
  }

  applyForces(dt) {
    const b = this.body;
    if (!this.alive) return;
    const world = this.game.world;
    this.terrain = world.tileAt(b.x, b.y);
    const tp = TERRAIN_PROPS[this.terrain];
    const sp = this.spec;

    // Boost
    const canBoost = this.wantBoost && this.boostEnergy > 0.05 && Math.abs(this.throttle) > 0.1;
    if (canBoost && !this.boosting && this.team === 'player') audio.play('boost', b.x, b.y);
    this.boosting = canBoost;
    if (this.boosting) this.boostEnergy = Math.max(0, this.boostEnergy - dt * 0.55);
    else this.boostEnergy = Math.min(1, this.boostEnergy + dt * 0.2 * this.mods.boostRegen);

    const boostMul = this.boosting ? sp.boostMul ?? 1.6 : 1;
    const m = b.mass;
    const drive = m * sp.accel * this.mods.speed * boostMul;
    const vmax = sp.vmax * this.mods.speed * (this.boosting ? 1.55 : 1);
    const roll = (m * sp.accel * this.mods.speed * boostMul) / (4 * vmax);
    const lat = m * 5.2;
    const latCap = m * 380 * tp.grip * (this.boosting ? 0.8 : 1);

    // Differential drive per track.
    const half = drive / 2;
    let fl = half * this.throttle + half * 0.9 * sp.turnK * this.turn;
    let fr = half * this.throttle - half * 0.9 * sp.turnK * this.turn;
    const lim = half * 1.25 * Math.max(1, sp.turnK * 0.8);
    const over = Math.max(Math.abs(fl), Math.abs(fr)) / lim;
    if (over > 1) {
      fl /= over;
      fr /= over;
    }
    const c = b.cos, s = b.sin;
    const ty = this.trackY;
    const braking = Math.abs(this.throttle) < 0.05 && Math.abs(this.turn) < 0.05;
    const rollK = roll * tp.drag * (braking ? 4 : 1);
    const Lx = this.L * 0.18;
    for (let side = -1; side <= 1; side += 2) {
      const f = side < 0 ? fl : fr;
      // Track line of action at local (0, side*ty).
      const [tx, tyw] = b.toWorld(0, side * ty);
      b.applyForceAt(c * f, s * f, tx, tyw);
      let vfSum = 0;
      for (let end = -1; end <= 1; end += 2) {
        const [px, py] = b.toWorld(end * Lx, side * ty);
        const [vx, vy] = b.pointVelocity(px, py);
        const vf = vx * c + vy * s;
        const vl = -vx * s + vy * c;
        vfSum += vf;
        const Ff = -rollK * vf;
        let Fl = -lat * vl;
        if (Fl > latCap) Fl = latCap;
        else if (Fl < -latCap) Fl = -latCap;
        b.applyForceAt(c * Ff - s * Fl, s * Ff + c * Fl, px, py);
      }
      // Tread scroll follows the track's ground speed.
      this.trackOff[side < 0 ? 0 : 1] += (vfSum / 2) * dt;
    }
    const vlat = -b.vx * s + b.vy * c;
    this.slip = Math.abs(vlat);

    // Turret slews toward aim (world-space stabilised).
    if (sp.turretSpeed > 0) this.turretAngle = approachAngle(this.turretAngle, this.aim, sp.turretSpeed * dt);
  }

  update(dt) {
    const b = this.body;
    this.cooldown -= dt;
    this.mgCooldown -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 4);
    this.flash = Math.max(0, this.flash - dt * 6);
    if (this.shield > 0) this.shield -= dt;
    this.mgHeat = Math.max(0, this.mgHeat - dt * (this.overheated ? 0.45 : 0.6));
    if (this.overheated && this.mgHeat < 0.25) this.overheated = false;
    if (!this.alive) return;
    if (this.mods.regen && this.game.time - this.lastHitTime > 3) this.hp = Math.min(this.maxHp, this.hp + this.mods.regen * dt);
    this._effects(dt);
  }

  _effects(dt) {
    const b = this.body;
    const fx = this.game.fx;
    const world = this.game.world;
    const speed = b.speed;
    const tp = TERRAIN_PROPS[this.terrain];
    const c = b.cos, s = b.sin;

    // Track marks from the rear of each track.
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const [x, y] = b.toWorld(-this.L * 0.4, side * this.trackY);
      const last = this.lastMark[i];
      if (!last) {
        this.lastMark[i] = [x, y];
        continue;
      }
      const d = Math.hypot(x - last[0], y - last[1]);
      if (d > 7) {
        if (d < 40) {
          let color = null, alpha = 0;
          switch (this.terrain) {
            case T.SAND: color = '#6b5434'; alpha = 0.32; break;
            case T.DRY: color = '#6a5a34'; alpha = 0.28; break;
            case T.GRASS: case T.FOREST: color = '#33401c'; alpha = 0.3; break;
            case T.DIRT: color = '#4a3a22'; alpha = 0.32; break;
            case T.ROCKY: color = '#4a463c'; alpha = 0.15; break;
            case T.ROAD: case T.CONCRETE: case T.BRIDGE:
              if (this.slip > 60) { color = '#111111'; alpha = clamp((this.slip - 60) / 200, 0, 0.4); }
              break;
          }
          if (color && alpha > 0.02) world.trackMark(last[0], last[1], x, y, this.trackW * 0.85, alpha, color, this.trackOff[i]);
        }
        this.lastMark[i] = [x, y];
      }
      // Dust kicked up by tracks.
      if (tp.dust && tp.dust !== 'water' && speed > 70 && chance(Math.min(0.5, speed / 900 + this.slip / 500))) {
        fx.dust(x, y, tp.dust, (0.8 + speed / 400) * (this.L / 64), -c * 30, -s * 30);
      }
    }

    // Water: wake and splashes.
    const inWater = this.terrain === T.SHALLOW;
    if (inWater) {
      if (speed > 40 && chance(0.6)) {
        const [x, y] = b.toWorld(-this.L * 0.3, (Math.random() < 0.5 ? -1 : 1) * this.trackY);
        fx.wake(x, y);
      }
      if (speed > 150 && chance(0.15)) {
        const [x, y] = b.toWorld(this.L * 0.45, rand(-1, 1) * this.trackY);
        fx.splash(x, y, 0.4);
      }
    }
    if (inWater && !this.wasInWater && speed > 100) {
      fx.splash(b.x, b.y, 1);
      audio.play('splash', b.x, b.y);
    }
    this.wasInWater = inWater;

    // Exhaust
    this.exhaustTimer -= dt;
    const [ex, ey] = b.toWorld(-this.L / 2, 0);
    if (this.boosting) {
      for (const side of [-0.55, 0.55]) {
        const [bx, by] = b.toWorld(-this.L / 2, side * (this.W / 2 - this.trackW * 0.55));
        fx.boostFlame(bx, by, b.angle, this.L / 64);
      }
      if (chance(0.5)) fx.smoke(ex, ey, 0.6, false, -c * 60, -s * 60);
    } else if (this.exhaustTimer <= 0) {
      this.exhaustTimer = Math.abs(this.throttle) > 0.5 ? rand(0.08, 0.16) : rand(0.3, 0.6);
      fx.spawn({ x: ex, y: ey, vx: -c * 40 + rand(-10, 10), vy: -s * 40 + rand(-10, 10), drag: 1.5, spr: this.game.sprites.smoke[0], size: 6, size1: 22, life: 0.8, alpha: 0.25 });
    }

    // Damage smoke and fire.
    const hpf = this.hp / this.maxHp;
    if (hpf < 0.5 && chance(hpf < 0.25 ? 0.5 : 0.15)) {
      const [sx, sy] = b.toWorld(-this.L * 0.25, rand(-4, 4));
      fx.smoke(sx, sy, (this.L / 64) * 0.8, hpf < 0.25);
      if (hpf < 0.25 && chance(0.5)) fx.flame(sx, sy, this.L / 64);
    }
  }

  canFire() {
    return this.alive && this.cooldown <= 0;
  }

  fireCannon() {
    if (!this.canFire()) return false;
    const g = this.game;
    const sp = this.spec;
    this.cooldown = sp.reload * this.mods.reload * (this.overdrive ? 0.45 : 1);
    this.recoil = 1;
    const twin = sp.weapon === 'twin' || sp.weapon === 'boss';
    const offsets = twin ? [-this.W * 0.09, this.W * 0.09] : [0];
    const angles = [0];
    for (let i = 1; i <= this.mods.spread; i++) angles.push(i * 0.09, -i * 0.09);
    const big = this.kind === 'boss' || this.kind === 'heavy';
    for (const off of offsets) {
      for (const da of angles) {
        const [mx, my] = this.muzzle(off);
        const a = this.turretAngle + da + (this.team === 'enemy' ? rand(-0.03, 0.03) : 0);
        g.spawnShell({
          x: mx,
          y: my,
          angle: a,
          speed: sp.shellSpeed,
          vx: this.body.vx * 0.3,
          vy: this.body.vy * 0.3,
          damage: sp.damage * this.mods.damage,
          splash: sp.splash * this.mods.splash,
          owner: this,
          team: this.team,
          big,
          ricochet: this.mods.ricochet,
          cluster: this.mods.cluster,
        });
      }
      const [mx, my] = this.muzzle(off);
      g.fx.muzzle(mx, my, this.turretAngle, this.L / 64);
    }
    const [px, py] = this.pivot();
    g.fx.shellCasing(px, py, this.turretAngle);
    // Recoil impulse at the turret pivot shoves (and twists) the hull.
    if (sp.recoil) {
      const c = Math.cos(this.turretAngle), s = Math.sin(this.turretAngle);
      this.body.applyImpulseAt(-c * sp.recoil, -s * sp.recoil, px, py);
    }
    audio.play('cannon', px, py, { big, volume: this.team === 'player' ? 1 : 0.8 });
    if (this.team === 'player') g.addShake(0.22);
    else if (g.player) {
      const d = Math.hypot(px - g.player.x, py - g.player.y);
      if (d < 600) g.addShake(0.06);
    }
    return true;
  }

  fireMg() {
    if (!this.alive || this.mgCooldown > 0 || this.overheated) return false;
    const g = this.game;
    const player = this.team === 'player';
    const od = this.overdrive;
    this.mgCooldown = (player ? 0.065 / this.mods.mgRate : this.spec.reload) * (od ? 0.6 : 1);
    if (player && !od) {
      this.mgHeat += 0.035 * this.mods.mgHeat;
      if (this.mgHeat >= 1) {
        this.mgHeat = 1;
        this.overheated = true;
        audio.play('ui', undefined, undefined, { freq: 220 });
      }
    }
    // Coax MG sits beside the main gun.
    const [mx, my] = this.muzzle(this.W * 0.12);
    const a = this.turretAngle + (player ? rand(-0.05, 0.05) : rand(-0.12, 0.12));
    g.spawnBullet({ x: mx, y: my, angle: a, speed: 1500, damage: player ? 4.5 : this.spec.damage, owner: this, team: this.team });
    g.fx.mgFlash(mx, my, a);
    audio.play('mg', mx, my, { volume: player ? 1 : 0.6 });
    return true;
  }

  damage(amount, source, hx, hy) {
    if (!this.alive) return 0;
    if (this.shield > 0) {
      audio.play('shieldHit', hx, hy);
      this.game.fx.smallHit(hx ?? this.x, hy ?? this.y, 0, '#7ad7ff');
      return 0;
    }
    const dmg = amount * this.mods.armor;
    this.hp -= dmg;
    this.flash = 1;
    this.lastHitTime = this.game.time;
    if (this.team === 'player') this.game.playerHit(dmg, source);
    if (this.hp <= 0) {
      this.hp = 0;
      this.game.onTankDestroyed(this, source);
    }
    return dmg;
  }

  render(ctx) {
    const b = this.body;
    const set = this.set;
    const x = b.x, y = b.y, a = b.angle;
    const wreck = !this.alive;
    if (this.kind === 'truck') return this._renderTruck(ctx, wreck);

    // Shadow
    drawSprite(ctx, set.shadow, x + 5, y + 7, a, 1, 0.9);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    // Tracks with scrolling treads.
    const tr = set.track;
    const L = this.L, tw = this.trackW;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const period = tr.period;
      let off = (-this.trackOff[i] % period + period) % period;
      if (wreck) off = 0;
      ctx.drawImage(tr.img, off * 2, 0, L * 2, tw * 2, -L / 2, side * this.trackY - tw / 2, L, tw);
    }
    if (wreck) {
      ctx.fillStyle = 'rgba(15,12,10,0.7)';
      ctx.fillRect(-L / 2, -this.W / 2, L, this.W);
    }
    const hull = wreck ? set.wreckHull : set.hull;
    ctx.drawImage(hull.img, -hull.w / 2, -hull.h / 2, hull.w, hull.h);
    if (this.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = this.flash * 0.6;
      ctx.drawImage(hull.img, -hull.w / 2, -hull.h / 2, hull.w, hull.h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    if (this.turretLost) return;
    // Barrel then turret, rotating about the pivot.
    const [px, py] = this.pivot();
    const ta = this.turretAngle;
    const barrel = wreck ? set.wreckBarrel : set.barrel;
    const turret = wreck ? set.wreckTurret : set.turret;
    const blen = set.barrelLen;
    const start = this.L * 0.18 - this.recoil * 6;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ta);
    // Turret drop shadow
    ctx.globalAlpha = 0.35;
    ctx.drawImage(turret.img, -turret.w / 2 + 3, -turret.h / 2 + 4, turret.w, turret.h);
    ctx.globalAlpha = 1;
    ctx.drawImage(barrel.img, start + blen / 2 - barrel.w / 2, -barrel.h / 2, barrel.w, barrel.h);
    ctx.drawImage(turret.img, -turret.w / 2, -turret.h / 2, turret.w, turret.h);
    if (this.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = this.flash * 0.6;
      ctx.drawImage(turret.img, -turret.w / 2, -turret.h / 2, turret.w, turret.h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    if (this.shield > 0) {
      const t = this.game.time;
      const pulse = 0.5 + Math.sin(t * 10) * 0.15;
      const fade = Math.min(1, this.shield);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = pulse * fade;
      const g = this.game.fx.blue;
      const r = this.L * 0.95;
      ctx.drawImage(g.img, x - r, y - r, r * 2, r * 2);
      ctx.strokeStyle = `rgba(140,220,255,${0.6 * fade})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.75, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  _renderTruck(ctx, wreck) {
    const b = this.body;
    const sp = this.game.sprites;
    drawSprite(ctx, sp.truckShadow, b.x + 4, b.y + 6, b.angle);
    drawSprite(ctx, sp.truck, b.x, b.y, b.angle);
    if (wreck) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle);
      ctx.fillStyle = 'rgba(15,12,10,0.75)';
      ctx.fillRect(-28, -12, 56, 24);
      ctx.restore();
    }
    if (this.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      drawSprite(ctx, sp.truck, b.x, b.y, b.angle, 1, this.flash * 0.6);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}

// Helper used by AI: lead a moving target.
export function leadAim(sx, sy, tx, ty, tvx, tvy, speed) {
  const dx = tx - sx, dy = ty - sy;
  const a = tvx * tvx + tvy * tvy - speed * speed;
  const b = 2 * (dx * tvx + dy * tvy);
  const c = dx * dx + dy * dy;
  let t = 0;
  if (Math.abs(a) < 1e-6) t = -c / b;
  else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const r = Math.sqrt(disc);
      const t1 = (-b - r) / (2 * a), t2 = (-b + r) / (2 * a);
      t = Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
    }
  }
  if (!(t > 0) || t > 3) t = Math.hypot(dx, dy) / speed;
  return Math.atan2(dy + tvy * t, dx + tvx * t);
}

export { angleDiff };
