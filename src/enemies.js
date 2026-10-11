// Enemy behaviours: tank AI, mortar trucks, the boss, static gun turrets,
// helicopter gunships and kamikaze drones.

import { Tank, leadAim } from './tank.js';
import { Body } from './physics.js';
import { clamp, rand, chance, angleDiff, approachAngle, TAU, pick } from './util.js';
import { drawSprite } from './sprites.js';
import { audio } from './audio.js';

// Convert a desired world direction into throttle/turn for a tracked vehicle.
export function driveToward(tank, dx, dy, mag, allowReverse = true) {
  if (mag < 0.01) {
    tank.throttle = 0;
    tank.turn = 0;
    return;
  }
  const want = Math.atan2(dy, dx);
  const e = angleDiff(tank.angle, want);
  if (allowReverse && Math.abs(e) > 2.3) {
    const e2 = angleDiff(tank.angle, want + Math.PI);
    tank.turn = clamp(e2 * 3, -1, 1);
    tank.throttle = -mag * Math.max(0, Math.cos(e2));
  } else {
    tank.turn = clamp(e * 3, -1, 1);
    tank.throttle = mag * Math.max(0, Math.cos(e)) ** 0.7;
  }
}

const ROLE = {
  scout: { range: 170, fireRange: 420, strafe: true, accuracy: 0.08 },
  battle: { range: 380, fireRange: 650, strafe: true, accuracy: 0.05 },
  heavy: { range: 300, fireRange: 650, strafe: false, accuracy: 0.04 },
  boss: { range: 360, fireRange: 800, strafe: false, accuracy: 0.03 },
  truck: { range: 780, fireRange: 1000, strafe: false, accuracy: 0 },
};

export class TankAI {
  constructor(game, tank) {
    this.game = game;
    this.tank = tank;
    this.role = ROLE[tank.kind];
    this.strafeDir = chance(0.5) ? 1 : -1;
    this.strafeTimer = rand(2, 5);
    this.stuck = 0;
    this.reverse = 0;
    this.reverseTurn = 1;
    this.losTimer = 0;
    this.los = false;
    this.aimError = 0;
    this.aimErrTimer = 0;
    // Boss state
    this.missileTimer = 5;
    this.droneTimer = 9;
    this.sprayTimer = 3;
    this.mortarTimer = rand(2, 4);
  }

  get alive() {
    return this.tank.alive;
  }

  update(dt) {
    const t = this.tank, g = this.game, p = g.player;
    if (!t.alive) return;
    if (!p || !p.alive) {
      t.throttle = 0;
      t.turn = 0;
      return;
    }
    const dx = p.x - t.x, dy = p.y - t.y;
    const dist = Math.hypot(dx, dy);
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.25 + Math.random() * 0.1;
      this.los = dist < 1200 && g.lineOfSight(t.x, t.y, p.x, p.y, t.body, p.body);
    }

    // --- Movement ---
    let mx = 0, my = 0, mag = 1;
    const role = this.role;
    if (this.reverse > 0) {
      this.reverse -= dt;
      t.throttle = -1;
      t.turn = this.reverseTurn;
    } else {
      if (dist > role.range * 1.25 || !this.los) {
        const f = dist > 180 ? g.world.flowDir(t.x, t.y) : null;
        if (f && !(this.los && dist < 700)) {
          mx = f[0];
          my = f[1];
        } else {
          mx = dx / dist;
          my = dy / dist;
        }
      } else if (dist < role.range * 0.7) {
        mx = -dx / dist;
        my = -dy / dist;
        if (role.strafe) {
          mx += (-dy / dist) * this.strafeDir * 0.8;
          my += (dx / dist) * this.strafeDir * 0.8;
        }
      } else if (role.strafe) {
        mx = (-dy / dist) * this.strafeDir;
        my = (dx / dist) * this.strafeDir;
        mag = t.kind === 'scout' ? 1 : 0.7;
      } else {
        mag = t.kind === 'truck' ? 0 : 0.35;
        mx = dx / dist;
        my = dy / dist;
      }
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeTimer = rand(2, 5);
        this.strafeDir *= -1;
      }
      // Separation from other enemies so they don't clump.
      for (const o of g.enemyTanks) {
        if (o === this || !o.alive) continue;
        const ox = t.x - o.tank.x, oy = t.y - o.tank.y;
        const d2 = ox * ox + oy * oy;
        const rr = (t.L + o.tank.L) * 1.1;
        if (d2 < rr * rr && d2 > 1) {
          const d = Math.sqrt(d2);
          mx += (ox / d) * (1 - d / rr) * 1.5;
          my += (oy / d) * (1 - d / rr) * 1.5;
        }
      }
      // Avoid deep water ahead.
      const ahead = 60 + t.body.speed * 0.4;
      const ax = t.x + Math.cos(t.angle) * ahead, ay = t.y + Math.sin(t.angle) * ahead;
      if (g.world.tileAt(ax, ay) === 0) {
        mx -= Math.cos(t.angle) * 1.5;
        my -= Math.sin(t.angle) * 1.5;
      }
      const ml = Math.hypot(mx, my);
      if (ml > 0.001) driveToward(t, mx / ml, my / ml, mag);
      else driveToward(t, 0, 0, 0);

      // Stuck detection: trying to move but going nowhere.
      if (Math.abs(t.throttle) > 0.4 && t.body.speed < 25) {
        this.stuck += dt;
        if (this.stuck > 0.9) {
          this.stuck = 0;
          this.reverse = rand(0.5, 1.0);
          this.reverseTurn = chance(0.5) ? 1 : -1;
        }
      } else this.stuck = Math.max(0, this.stuck - dt * 2);
    }

    // --- Aiming & firing ---
    this.aimErrTimer -= dt;
    if (this.aimErrTimer <= 0) {
      this.aimErrTimer = rand(0.4, 1);
      this.aimError = rand(-1, 1) * role.accuracy * g.difficultyAim;
    }
    if (t.kind === 'truck') return this._mortar(dt, dist);
    const speed = t.spec.weapon === 'mg' ? 950 : t.spec.shellSpeed;
    t.aim = leadAim(t.x, t.y, p.x, p.y, p.body.vx, p.body.vy, speed) + this.aimError;
    const aligned = Math.abs(angleDiff(t.turretAngle, t.aim)) < (t.spec.weapon === 'mg' ? 0.2 : 0.09);
    if (this.los && dist < role.fireRange && aligned) {
      if (t.spec.weapon === 'mg') t.fireMg();
      else t.fireCannon();
    }
    if (t.kind === 'boss') this._boss(dt, dist);
  }

  _mortar(dt, dist) {
    const t = this.tank, g = this.game, p = g.player;
    this.mortarTimer -= dt;
    if (this.mortarTimer <= 0 && dist < this.role.fireRange && t.body.speed < 60) {
      this.mortarTimer = t.spec.reload * rand(0.9, 1.2);
      const n = 3;
      for (let i = 0; i < n; i++) {
        const flight = 1.6 + i * 0.25;
        // Predict where the player will be, with scatter.
        const tx = p.x + p.body.vx * flight * 0.8 + rand(-70, 70);
        const ty = p.y + p.body.vy * flight * 0.8 + rand(-70, 70);
        g.spawnMortar(t.x, t.y, tx, ty, flight, t.spec.damage, t.spec.splash, t, true);
      }
      audio.play('mortar', t.x, t.y);
      g.fx.muzzle(t.x - Math.cos(t.angle) * 14, t.y - Math.sin(t.angle) * 14, -Math.PI / 2, 0.7);
    }
  }

  _boss(dt, dist) {
    const t = this.tank, g = this.game, p = g.player;
    const enraged = t.hp < t.maxHp * 0.5;
    this.missileTimer -= dt;
    this.droneTimer -= dt;
    this.sprayTimer -= dt;
    if (this.missileTimer <= 0 && this.los) {
      this.missileTimer = enraged ? 4 : 6.5;
      const n = enraged ? 6 : 4;
      for (let i = 0; i < n; i++) {
        const a = t.angle + Math.PI + (i - (n - 1) / 2) * 0.35;
        const [sx, sy] = t.body.toWorld(-t.L * 0.2, (i - (n - 1) / 2) * 10);
        g.spawnMissile(sx, sy, a, 'enemy', t, p, { speed: 150, maxSpeed: 430, turnRate: 2.2, damage: 12 });
      }
      audio.play('missile', t.x, t.y);
    }
    if (this.droneTimer <= 0) {
      this.droneTimer = enraged ? 8 : 12;
      for (let i = 0; i < (enraged ? 4 : 3); i++) g.spawnDrone(t.x + rand(-60, 60), t.y + rand(-60, 60));
    }
    if (this.sprayTimer <= 0 && dist < 600) {
      // Sweeping MG spray from the hull.
      this.sprayTimer = enraged ? 3 : 4.5;
      this.spray = 1.2;
      this.sprayAngle = t.aim - 0.7;
    }
    if (this.spray > 0) {
      this.spray -= dt;
      this.sprayAngle += dt * 1.2;
      if (Math.random() < 0.7) {
        const [sx, sy] = t.body.toWorld(t.L * 0.4, 0);
        g.spawnBullet({ x: sx, y: sy, angle: this.sprayAngle + rand(-0.05, 0.05), speed: 900, damage: 3, owner: t, team: 'enemy' });
        audio.play('mg', sx, sy, { volume: 0.7 });
      }
    }
  }
}

// --- Static gun turret ------------------------------------------------------------

export class Turret {
  constructor(game, x, y, base) {
    this.game = game;
    this.x = x;
    this.y = y;
    this.base = base;
    this.team = 'enemy';
    this.hp = this.maxHp = 140;
    this.alive = true;
    this.turretAngle = rand(0, TAU);
    this.aim = this.turretAngle;
    this.cooldown = rand(1, 2);
    this.recoil = 0;
    this.flash = 0;
    this.range = 720;
    this.radius = 28;
    this.body = new Body({ shape: 'circle', x, y, r: 26, isStatic: true, friction: 0.4 });
    this.body.kind = 'turret';
    this.body.owner = this;
    game.physics.add(this.body);
    this.set = game.sprites.tanks.heavy;
    this.scoreValue = 500;
    this.losTimer = 0;
    this.los = false;
  }

  update(dt) {
    this.cooldown -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 3);
    this.flash = Math.max(0, this.flash - dt * 6);
    const g = this.game, p = g.player;
    if (!this.alive) {
      if (Math.random() < 0.1) g.fx.smoke(this.x, this.y, 0.8, true);
      return;
    }
    if (!p || !p.alive) return;
    const d = Math.hypot(p.x - this.x, p.y - this.y);
    if (d > this.range + 200) return;
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.3;
      this.los = g.lineOfSight(this.x, this.y, p.x, p.y, this.body, p.body);
    }
    if (!this.los) return;
    this.aim = leadAim(this.x, this.y, p.x, p.y, p.body.vx, p.body.vy, 850);
    this.turretAngle = approachAngle(this.turretAngle, this.aim, 1.6 * dt);
    if (d < this.range && this.cooldown <= 0 && Math.abs(angleDiff(this.turretAngle, this.aim)) < 0.06) {
      this.cooldown = 2.0 / g.difficultyRate;
      this.recoil = 1;
      for (const off of [-5, 5]) {
        const c = Math.cos(this.turretAngle), s = Math.sin(this.turretAngle);
        const mx = this.x + c * 52 - s * off, my = this.y + s * 52 + c * off;
        g.spawnShell({ x: mx, y: my, angle: this.turretAngle + rand(-0.03, 0.03), speed: 850, damage: 9, splash: 30, owner: this, team: 'enemy', big: true });
      }
      const c = Math.cos(this.turretAngle), s = Math.sin(this.turretAngle);
      g.fx.muzzle(this.x + c * 52, this.y + s * 52, this.turretAngle, 1);
      audio.play('cannon', this.x, this.y, { big: true });
    }
  }

  damage(amount, source, hx, hy) {
    if (!this.alive) return 0;
    this.hp -= amount;
    this.flash = 1;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.game.onTurretDestroyed(this, source);
    }
    return amount;
  }

  render(ctx) {
    const sp = this.game.sprites;
    drawSprite(ctx, sp.emplacementShadow, this.x + 4, this.y + 5);
    drawSprite(ctx, sp.emplacement, this.x, this.y);
    const set = this.set;
    const turret = this.alive ? set.turret : set.wreckTurret;
    const barrel = this.alive ? set.barrel : set.wreckBarrel;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.turretAngle);
    ctx.globalAlpha = 0.35;
    ctx.drawImage(turret.img, -turret.w / 2 + 3, -turret.h / 2 + 4, turret.w, turret.h);
    ctx.globalAlpha = 1;
    const start = 12 - this.recoil * 7;
    ctx.drawImage(barrel.img, start, -barrel.h / 2, barrel.w, barrel.h);
    ctx.drawImage(turret.img, -turret.w / 2, -turret.h / 2, turret.w, turret.h);
    if (this.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = this.flash * 0.6;
      ctx.drawImage(turret.img, -turret.w / 2, -turret.h / 2, turret.w, turret.h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }
}

// --- Helicopter gunship ---------------------------------------------------------

export class Helicopter {
  constructor(game, x, y) {
    this.game = game;
    this.x = x;
    this.y = y;
    this.z = 70;
    this.vx = 0;
    this.vy = 0;
    this.angle = 0;
    this.team = 'enemy';
    this.air = true;
    this.hp = this.maxHp = 110;
    this.alive = true;
    this.radius = 30;
    this.orbit = rand(0, TAU);
    this.orbitDir = chance(0.5) ? 1 : -1;
    this.rocketTimer = rand(2, 3);
    this.gunTimer = 1;
    this.burst = 0;
    this.rotor = 0;
    this.flash = 0;
    this.dying = 0;
    this.scoreValue = 700;
    this.pod = 0;
  }

  update(dt) {
    const g = this.game, p = g.player;
    this.rotor += dt * 32;
    this.flash = Math.max(0, this.flash - dt * 6);
    if (this.dying > 0) {
      // Spiral down trailing smoke, then crash.
      this.dying -= dt;
      this.angle += dt * 9;
      this.z = Math.max(0, this.z - dt * 60);
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      g.fx.smoke(this.x, this.y - this.z * 0.5, 1, true);
      g.fx.flame(this.x, this.y - this.z * 0.5, 1);
      if (this.dying <= 0) {
        this.alive = false;
        g.explode(this.x, this.y, 110, 40, this.killer, { size: 2.2, debris: 'metal', team: 'neutral' });
        g.fx.tankDeath(this.x, this.y, 1);
      }
      return;
    }
    if (!this.alive || !p) return;
    const dx = p.x - this.x, dy = p.y - this.y;
    const dist = Math.hypot(dx, dy);
    // Orbit the player at standoff range.
    this.orbit += dt * 0.45 * this.orbitDir;
    const R = 340;
    const tx = p.x + Math.cos(this.orbit) * R, ty = p.y + Math.sin(this.orbit) * R;
    const ax = (tx - this.x) * 1.4 - this.vx * 1.2, ay = (ty - this.y) * 1.4 - this.vy * 1.2;
    const al = Math.hypot(ax, ay), amax = 420;
    this.vx += (al > amax ? (ax / al) * amax : ax) * dt;
    this.vy += (al > amax ? (ay / al) * amax : ay) * dt;
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > 300) {
      this.vx *= 300 / sp;
      this.vy *= 300 / sp;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.angle = approachAngle(this.angle, Math.atan2(dy, dx), 2.5 * dt);
    this.z = 70 + Math.sin(g.time * 2 + this.orbit) * 5;
    if (!p.alive) return;
    // Rocket salvo
    this.rocketTimer -= dt;
    if (this.rocketTimer <= 0 && dist < 650) {
      this.burst = 4;
      this.rocketTimer = 4.5 / g.difficultyRate;
    }
    this.gunTimer -= dt;
    if (this.burst > 0 && this.gunTimer <= 0) {
      this.burst--;
      this.gunTimer = 0.14;
      this.pod = -this.pod || 1;
      const c = Math.cos(this.angle), s = Math.sin(this.angle);
      const sx = this.x - s * 13 * this.pod, sy = this.y + c * 13 * this.pod;
      const a = leadAim(sx, sy, p.x, p.y, p.body.vx, p.body.vy, 620) + rand(-0.06, 0.06);
      g.spawnRocket(sx, sy, a, this);
      audio.play('missile', sx, sy, { volume: 0.6 });
    } else if (this.burst === 0 && dist < 480 && this.gunTimer <= 0 && Math.abs(angleDiff(this.angle, Math.atan2(dy, dx))) < 0.4) {
      this.gunTimer = 0.11;
      const c = Math.cos(this.angle), s = Math.sin(this.angle);
      const sx = this.x + c * 26, sy = this.y + s * 26;
      g.spawnBullet({ x: sx, y: sy, angle: Math.atan2(p.y - sy, p.x - sx) + rand(-0.1, 0.1), speed: 1000, damage: 1.3, owner: this, team: 'enemy' });
      audio.play('mg', sx, sy, { volume: 0.5 });
      if (Math.random() < 0.06) this.gunTimer = 1.2;
    }
  }

  damage(amount, source) {
    if (!this.alive || this.dying > 0) return 0;
    this.hp -= amount;
    this.flash = 1;
    if (this.hp <= 0) {
      this.dying = 1.3;
      this.killer = source;
      this.game.onAirKill(this, source);
    }
    return amount;
  }

  render(ctx) {
    const sp = this.game.sprites;
    const sx = this.x + this.z * 0.6, sy = this.y + this.z * 0.8;
    drawSprite(ctx, sp.heliShadow, sx, sy, this.angle, 1, 0.8);
    // Rotor shadow
    ctx.globalAlpha = 0.25;
    drawSprite(ctx, sp.rotor, sx, sy, this.rotor, 0.9);
    ctx.globalAlpha = 1;
    const sc = 1 + this.z / 600;
    drawSprite(ctx, sp.heli, this.x, this.y, this.angle, sc);
    if (this.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      drawSprite(ctx, sp.heli, this.x, this.y, this.angle, sc, this.flash * 0.6);
      ctx.globalCompositeOperation = 'source-over';
    }
    drawSprite(ctx, sp.rotor, this.x, this.y, this.rotor, sc);
    drawSprite(ctx, sp.rotor, this.x, this.y, -this.rotor * 0.7 + 0.4, sc * 0.98, 0.5);
    // Blinking nav light
    if (Math.sin(this.game.time * 8) > 0.6) {
      ctx.globalCompositeOperation = 'lighter';
      drawSprite(ctx, this.game.fx.fireRed, this.x - Math.cos(this.angle) * 38, this.y - Math.sin(this.angle) * 38, 0, 0.4);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}

// --- Kamikaze drone -----------------------------------------------------------------

export class Drone {
  constructor(game, x, y) {
    this.game = game;
    this.x = x;
    this.y = y;
    this.z = 34;
    this.vx = 0;
    this.vy = 0;
    this.team = 'enemy';
    this.air = true;
    this.hp = this.maxHp = 8;
    this.alive = true;
    this.radius = 14;
    this.angle = 0;
    this.wobble = rand(0, TAU);
    this.scoreValue = 60;
    this.flash = 0;
    this.speed = rand(260, 330);
  }

  update(dt) {
    const g = this.game, p = g.player;
    this.flash = Math.max(0, this.flash - dt * 6);
    if (!this.alive || !p) return;
    const dx = p.x - this.x, dy = p.y - this.y;
    const dist = Math.hypot(dx, dy) || 1;
    const perpX = -dy / dist, perpY = dx / dist;
    const w = Math.sin(g.time * 3 + this.wobble) * 0.6;
    const tx = (dx / dist + perpX * w) * this.speed, ty = (dy / dist + perpY * w) * this.speed;
    this.vx += (tx - this.vx) * Math.min(1, dt * 2.5);
    this.vy += (ty - this.vy) * Math.min(1, dt * 2.5);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.angle = Math.atan2(this.vy, this.vx);
    if (p.alive && dist < 34) {
      this.alive = false;
      g.explode(this.x, this.y, 60, 10, this, { size: 1, team: 'enemy' });
    }
  }

  damage(amount, source) {
    if (!this.alive) return 0;
    this.hp -= amount;
    this.flash = 1;
    if (this.hp <= 0) {
      this.alive = false;
      this.game.onAirKill(this, source);
      this.game.explode(this.x, this.y, 40, 6, source, { size: 0.6, team: 'player', noScorch: true });
    }
    return amount;
  }

  render(ctx) {
    const sp = this.game.sprites;
    drawSprite(ctx, sp.droneShadow, this.x + this.z * 0.6, this.y + this.z * 0.8);
    const bob = Math.sin(this.game.time * 10 + this.wobble) * 2;
    drawSprite(ctx, sp.drone, this.x, this.y + bob, this.angle + Math.PI / 4);
    if (Math.sin(this.game.time * 14 + this.wobble) > 0) {
      ctx.globalCompositeOperation = 'lighter';
      drawSprite(ctx, this.game.fx.fireRed, this.x, this.y + bob, 0, 0.35);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}

export function makeEnemyTank(game, kind, x, y) {
  const t = new Tank(game, kind, x, y, rand(0, TAU), 'enemy');
  const hpScale = game.difficultyHp;
  t.hp = t.maxHp = t.spec.hp * (kind === 'boss' ? 1 + (game.wave / 5 - 1) * 0.5 : hpScale);
  t.spec.reload /= game.difficultyRate;
  return new TankAI(game, t);
}
