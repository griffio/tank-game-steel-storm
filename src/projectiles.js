// Shells, MG bullets, homing missiles, rockets and ballistic mortar rounds.

import { rand, TAU, angleDiff, clamp, pick } from './util.js';
import { drawSprite, soft } from './sprites.js';
import { audio } from './audio.js';

export class Projectiles {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  add(p) {
    p.alive = true;
    p.age = 0;
    this.list.push(p);
    return p;
  }

  // Bodies a projectile can strike.
  _filter(p) {
    return (b) => {
      if (!b.alive) return false;
      if (b.kind === 'water') return false;
      if (p.owner && b === p.owner.body) return false;
      const o = b.owner;
      if (o) {
        if (o.type === 'bush') return false;
        if (o.team && o.team === p.team && o.alive) return false;
      }
      return true;
    };
  }

  update(dt) {
    const g = this.game;
    for (const p of this.list) {
      if (!p.alive) continue;
      p.age += dt;
      switch (p.type) {
        case 'mortar':
          this._updateMortar(p, dt);
          continue;
        case 'missile':
          this._steerMissile(p, dt);
          break;
      }
      const px = p.x, py = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;

      // Trails
      if (p.type === 'missile' || p.type === 'rocket') g.fx.trail(p.x, p.y, '#ccc', p.type === 'missile' ? 0.8 : 0.6);
      else if (p.type === 'shell' && p.big && Math.random() < 0.6) g.fx.spawn({ x: p.x, y: p.y, spr: g.sprites.smoke[1], size: 5, size1: 16, life: 0.4, alpha: 0.3 });

      // Air targets (helicopters, drones) and missiles.
      const air = g.hitAir(p, px, py, p.x, p.y);
      if (air) {
        this._impact(p, p.x, p.y, null, air);
        continue;
      }
      const hit = g.physics.raycast(px, py, p.x, p.y, this._filter(p));
      if (hit) {
        // Ricochet off hard cover.
        const o = hit.body.owner;
        const hard = hit.body.isStatic || (o && !o.alive && o.body);
        if (p.ricochet > 0 && hard && p.type === 'shell') {
          const [nx, ny] = surfaceNormal(hit.body, hit.x, hit.y);
          const dot = p.vx * nx + p.vy * ny;
          p.vx -= 2 * dot * nx;
          p.vy -= 2 * dot * ny;
          p.x = hit.x + nx * 4;
          p.y = hit.y + ny * 4;
          p.ricochet--;
          p.life = Math.max(p.life, 0.5);
          g.fx.smallHit(hit.x, hit.y, Math.atan2(-ny, -nx));
          audio.play('ricochet', hit.x, hit.y);
          if (o && o.hp !== undefined) g.damageProp(o, p.damage * 0.5, p.owner);
          continue;
        }
        this._impact(p, hit.x, hit.y, hit.body, null);
        continue;
      }
      if (p.life <= 0) this._expire(p);
    }
    if (this.list.length > 50 && this.list.some((p) => !p.alive)) this.list = this.list.filter((p) => p.alive);
  }

  _steerMissile(p, dt) {
    const g = this.game;
    let t = p.target;
    if (!t || !t.alive) {
      t = p.target = g.findTarget(p.x, p.y, p.team, 700, Math.atan2(p.vy, p.vx));
    }
    const speed = Math.min(p.maxSpeed, Math.hypot(p.vx, p.vy) + p.accel * dt);
    let ang = Math.atan2(p.vy, p.vx);
    if (t && p.age > 0.12) {
      const desired = Math.atan2(t.y - p.y, t.x - p.x);
      ang += clamp(angleDiff(ang, desired), -p.turnRate * dt, p.turnRate * dt);
    }
    ang += Math.sin(p.age * 18 + p.wobble) * 0.02;
    p.vx = Math.cos(ang) * speed;
    p.vy = Math.sin(ang) * speed;
  }

  _updateMortar(p, dt) {
    const g = this.game;
    const t = clamp(p.age / p.flight, 0, 1);
    p.x = p.sx + (p.tx - p.sx) * t;
    p.y = p.sy + (p.ty - p.sy) * t;
    p.z = Math.sin(t * Math.PI) * p.apex;
    if (!p.whistled && p.flight - p.age < 1.0 && p.marker) {
      p.whistled = true;
      audio.play('whistle', p.tx, p.ty, { dur: Math.min(1, p.flight - p.age) });
    }
    if (p.marker && Math.random() < 0.5) g.fx.spawn({ x: p.x - p.z * 0.15, y: p.y - p.z * 0.5, spr: g.sprites.smoke[2], size: 4, size1: 14, life: 0.5, alpha: 0.35 });
    if (t >= 1) {
      p.alive = false;
      g.explode(p.tx, p.ty, p.splash, p.damage, p.owner, { size: p.splash / 60, team: p.team });
    }
  }

  _impact(p, x, y, body, air) {
    const g = this.game;
    p.alive = false;
    const ang = Math.atan2(p.vy, p.vx);
    const target = air || (body && body.owner);
    if (p.type === 'bullet') {
      if (target && target.damage) {
        target.damage(p.damage, p.owner, x, y);
        g.fx.smallHit(x, y, ang);
        if (Math.random() < 0.3) audio.play('hit', x, y, { volume: 0.4 });
      } else if (target && target.hp !== undefined) {
        g.damageProp(target, p.damage, p.owner);
        g.fx.smallHit(x, y, ang, '#ffe0a0');
      } else g.fx.smallHit(x, y, ang);
      if (body && !body.isStatic) body.applyImpulseAt(p.vx * 0.15, p.vy * 0.15, x, y);
      return;
    }
    // Shells / missiles / rockets
    if (body && !body.isStatic) {
      // Kinetic punch: knocks vehicles and props around.
      const k = p.type === 'shell' ? (p.big ? 7 : 5) : 3;
      body.applyImpulseAt(Math.cos(ang) * p.damage * k * 30, Math.sin(ang) * p.damage * k * 30, x, y);
    }
    if (target && target.damage) {
      if (p.team === 'player' && p.type === 'shell' && target.team === 'enemy' && g.stats) g.stats.hits++;
      target.damage(p.damage, p.owner, x, y);
      audio.play('hit', x, y);
    } else if (target && target.hp !== undefined) g.damageProp(target, p.damage, p.owner);
    if (p.splash > 0) g.explode(x, y, p.splash, p.damage * 0.5, p.owner, { size: p.splash / 55, team: p.team, exclude: target, cluster: p.cluster });
    else g.fx.smallHit(x, y, ang);
  }

  _expire(p) {
    const g = this.game;
    p.alive = false;
    if (p.type === 'bullet') {
      if (g.world.isWater(p.x, p.y)) g.fx.splash(p.x, p.y, 0.3);
      else g.fx.dirtHit(p.x, p.y);
      return;
    }
    if (g.world.isWater(p.x, p.y)) {
      g.fx.splash(p.x, p.y, 1.2);
      audio.play('splash', p.x, p.y);
      return;
    }
    if (p.splash > 0) g.explode(p.x, p.y, p.splash, p.damage * 0.5, p.owner, { size: p.splash / 60, team: p.team, dirt: true, cluster: p.cluster });
    else g.fx.dirtHit(p.x, p.y);
  }

  render(ctx, view) {
    const sp = this.game.sprites;
    const glowY = soft('#ffe9a0', 32), glowR = soft('#ff6a4a', 32);
    for (const p of this.list) {
      if (!p.alive) continue;
      if (p.x < view.x0 - 50 || p.x > view.x1 + 50 || p.y < view.y0 - 50 || p.y > view.y1 + 50) {
        if (p.type !== 'mortar') continue;
      }
      const ang = Math.atan2(p.vy, p.vx);
      switch (p.type) {
        case 'shell': {
          // Tracer streak + glow + shell body.
          const len = p.big ? 40 : 30;
          ctx.globalCompositeOperation = 'lighter';
          const glow = p.team === 'player' ? glowY : glowR;
          ctx.globalAlpha = 0.9;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(ang);
          ctx.drawImage(glow.img, -len, -6, len + 6, 12);
          ctx.restore();
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
          drawSprite(ctx, p.big ? sp.bigShell : p.team === 'player' ? sp.shell : sp.shellEnemy, p.x, p.y, ang);
          break;
        }
        case 'bullet': {
          ctx.strokeStyle = p.team === 'player' ? 'rgba(255,235,150,0.95)' : 'rgba(255,120,90,0.95)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - Math.cos(ang) * 16, p.y - Math.sin(ang) * 16);
          ctx.stroke();
          break;
        }
        case 'missile':
        case 'rocket': {
          ctx.globalCompositeOperation = 'lighter';
          drawSprite(ctx, glowR, p.x - Math.cos(ang) * 9, p.y - Math.sin(ang) * 9, 0, 0.6);
          ctx.globalCompositeOperation = 'source-over';
          drawSprite(ctx, sp.missile, p.x, p.y, ang, p.type === 'rocket' ? 0.8 : 1);
          break;
        }
        case 'mortar': {
          // Target marker on the ground plus the airborne shell.
          if (p.marker) {
            const t = p.age / p.flight;
            const pulse = 0.5 + 0.5 * Math.sin(p.age * 18);
            ctx.strokeStyle = `rgba(255,60,40,${0.4 + pulse * 0.5})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(p.tx, p.ty, p.splash, 0, TAU);
            ctx.stroke();
            ctx.fillStyle = `rgba(255,40,20,${0.08 + t * 0.18})`;
            ctx.beginPath();
            ctx.arc(p.tx, p.ty, p.splash * (1 - t), 0, TAU);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,80,60,0.8)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(p.tx - 10, p.ty);
            ctx.lineTo(p.tx + 10, p.ty);
            ctx.moveTo(p.tx, p.ty - 10);
            ctx.lineTo(p.tx, p.ty + 10);
            ctx.stroke();
          }
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.beginPath();
          ctx.ellipse(p.x + p.z * 0.25, p.y + p.z * 0.35, 5, 3, 0, 0, TAU);
          ctx.fill();
          drawSprite(ctx, sp.bigShell, p.x - p.z * 0.15, p.y - p.z * 0.5, Math.atan2(p.ty - p.sy, p.tx - p.sx), 0.8 + p.z / 400);
          break;
        }
      }
    }
  }
}

// Approximate outward surface normal of a body at a world point.
export function surfaceNormal(b, x, y) {
  if (b.shape === 'circle') {
    const dx = x - b.x, dy = y - b.y, l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  }
  const [lx, ly] = b.toLocal(x, y);
  const px = Math.abs(lx) / b.hw, py = Math.abs(ly) / b.hh;
  let nlx = 0, nly = 0;
  if (px > py) nlx = Math.sign(lx) || 1;
  else nly = Math.sign(ly) || 1;
  return [nlx * b.cos - nly * b.sin, nlx * b.sin + nly * b.cos];
}
