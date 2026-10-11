// Rigid-body physics: oriented boxes and circles with forces, torques and
// impulse-based collision response including angular effects and friction.

let nextId = 1;

export class Body {
  constructor(opts) {
    this.id = nextId++;
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    this.angle = opts.angle ?? 0;
    this.vx = 0;
    this.vy = 0;
    this.av = 0;
    this.fx = 0;
    this.fy = 0;
    this.torque = 0;
    this.shape = opts.shape ?? 'box';
    this.hw = opts.hw ?? 10; // half extents for boxes
    this.hh = opts.hh ?? 10;
    this.r = this.shape === 'circle' ? opts.r ?? 10 : Math.hypot(this.hw, this.hh);
    this.isStatic = !!opts.isStatic;
    this.setMass(this.isStatic ? 0 : opts.mass ?? 1);
    this.restitution = opts.restitution ?? 0.2;
    this.friction = opts.friction ?? 0.5;
    // Simple ground drag for objects that are not driven (crates, wrecks).
    this.linearDrag = opts.linearDrag ?? 0;
    this.angularDrag = opts.angularDrag ?? 0;
    this.groundFriction = opts.groundFriction ?? 0; // constant decel (px/s^2)
    this.layer = opts.layer ?? 1;
    this.mask = opts.mask ?? 0xffff;
    this.owner = opts.owner ?? null;
    this.alive = true;
    this.cos = Math.cos(this.angle);
    this.sin = Math.sin(this.angle);
  }

  setMass(m) {
    if (m <= 0 || this.isStatic) {
      this.mass = 0;
      this.invMass = 0;
      this.inertia = 0;
      this.invInertia = 0;
      return;
    }
    this.mass = m;
    this.invMass = 1 / m;
    this.inertia =
      this.shape === 'circle'
        ? 0.5 * m * this.r * this.r
        : (m * ((2 * this.hw) ** 2 + (2 * this.hh) ** 2)) / 12;
    this.invInertia = 1 / this.inertia;
  }

  applyForce(fx, fy) {
    this.fx += fx;
    this.fy += fy;
  }

  // Force applied at world point (px, py) – produces torque when off-centre.
  applyForceAt(fx, fy, px, py) {
    this.fx += fx;
    this.fy += fy;
    this.torque += (px - this.x) * fy - (py - this.y) * fx;
  }

  applyImpulseAt(jx, jy, px, py) {
    if (this.isStatic) return;
    this.vx += jx * this.invMass;
    this.vy += jy * this.invMass;
    this.av += ((px - this.x) * jy - (py - this.y) * jx) * this.invInertia;
  }

  // Velocity of a world point attached to this body.
  pointVelocity(px, py) {
    const rx = px - this.x, ry = py - this.y;
    return [this.vx - this.av * ry, this.vy + this.av * rx];
  }

  toWorld(lx, ly) {
    return [this.x + lx * this.cos - ly * this.sin, this.y + lx * this.sin + ly * this.cos];
  }

  toLocal(wx, wy) {
    const dx = wx - this.x, dy = wy - this.y;
    return [dx * this.cos + dy * this.sin, -dx * this.sin + dy * this.cos];
  }

  get speed() {
    return Math.hypot(this.vx, this.vy);
  }

  vertices() {
    const c = this.cos, s = this.sin, w = this.hw, h = this.hh;
    return [
      [this.x + w * c - h * s, this.y + w * s + h * c],
      [this.x - w * c - h * s, this.y - w * s + h * c],
      [this.x - w * c + h * s, this.y - w * s - h * c],
      [this.x + w * c + h * s, this.y + w * s - h * c],
    ];
  }

  containsPoint(px, py, pad = 0) {
    if (this.shape === 'circle') {
      const dx = px - this.x, dy = py - this.y;
      return dx * dx + dy * dy <= (this.r + pad) ** 2;
    }
    const [lx, ly] = this.toLocal(px, py);
    return Math.abs(lx) <= this.hw + pad && Math.abs(ly) <= this.hh + pad;
  }
}

// --- Narrow phase ----------------------------------------------------------
// Each returns null or { nx, ny, depth, cx, cy } with normal pointing A -> B.

function circleCircle(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const rs = a.r + b.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rs * rs) return null;
  const d = Math.sqrt(d2) || 0.0001;
  const nx = dx / d, ny = dy / d;
  return { nx, ny, depth: rs - d, cx: a.x + nx * a.r, cy: a.y + ny * a.r };
}

function boxCircle(box, circ, flip) {
  const [lx, ly] = box.toLocal(circ.x, circ.y);
  const qx = Math.max(-box.hw, Math.min(box.hw, lx));
  const qy = Math.max(-box.hh, Math.min(box.hh, ly));
  let nlx, nly, depth;
  const inside = qx === lx && qy === ly;
  if (inside) {
    // Centre inside the box: push out along the shallowest face.
    const px = box.hw - Math.abs(lx), py = box.hh - Math.abs(ly);
    if (px < py) {
      nlx = Math.sign(lx) || 1;
      nly = 0;
      depth = px + circ.r;
    } else {
      nlx = 0;
      nly = Math.sign(ly) || 1;
      depth = py + circ.r;
    }
  } else {
    const dx = lx - qx, dy = ly - qy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= circ.r * circ.r) return null;
    const d = Math.sqrt(d2) || 0.0001;
    nlx = dx / d;
    nly = dy / d;
    depth = circ.r - d;
  }
  const c = box.cos, s = box.sin;
  let nx = nlx * c - nly * s, ny = nlx * s + nly * c;
  const [cx, cy] = box.toWorld(qx, qy);
  if (flip) {
    nx = -nx;
    ny = -ny;
  }
  return { nx, ny, depth, cx, cy };
}

function project(verts, ax, ay) {
  let min = Infinity, max = -Infinity;
  for (const v of verts) {
    const p = v[0] * ax + v[1] * ay;
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return [min, max];
}

function boxBox(a, b) {
  const va = a.vertices(), vb = b.vertices();
  const axes = [
    [a.cos, a.sin],
    [-a.sin, a.cos],
    [b.cos, b.sin],
    [-b.sin, b.cos],
  ];
  let best = Infinity, bnx = 0, bny = 0;
  for (const [ax, ay] of axes) {
    const [amin, amax] = project(va, ax, ay);
    const [bmin, bmax] = project(vb, ax, ay);
    const o = Math.min(amax, bmax) - Math.max(amin, bmin);
    if (o <= 0) return null;
    if (o < best) {
      best = o;
      bnx = ax;
      bny = ay;
    }
  }
  // Orient normal A -> B.
  if ((b.x - a.x) * bnx + (b.y - a.y) * bny < 0) {
    bnx = -bnx;
    bny = -bny;
  }
  // Contact point: average of vertices that lie inside the other box.
  let sx = 0, sy = 0, n = 0;
  for (const v of vb) if (a.containsPoint(v[0], v[1], 0.5)) { sx += v[0]; sy += v[1]; n++; }
  for (const v of va) if (b.containsPoint(v[0], v[1], 0.5)) { sx += v[0]; sy += v[1]; n++; }
  if (n === 0) {
    sx = (a.x + b.x) / 2;
    sy = (a.y + b.y) / 2;
    n = 1;
  }
  return { nx: bnx, ny: bny, depth: best, cx: sx / n, cy: sy / n };
}

export function collide(a, b) {
  if (a.shape === 'circle' && b.shape === 'circle') return circleCircle(a, b);
  if (a.shape === 'box' && b.shape === 'circle') return boxCircle(a, b, false);
  if (a.shape === 'circle' && b.shape === 'box') return boxCircle(b, a, true);
  return boxBox(a, b);
}

// --- World -------------------------------------------------------------------

const CELL = 128;

export class PhysicsWorld {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.cols = Math.ceil(width / CELL) + 1;
    this.rows = Math.ceil(height / CELL) + 1;
    this.dynamic = [];
    this.staticBodies = [];
    this.staticGrid = Array.from({ length: this.cols * this.rows }, () => []);
    this.dynGrid = Array.from({ length: this.cols * this.rows }, () => []);
    this._stamp = 0;
    // Hook: (a, b, contact) => false to skip resolution (e.g. crushables).
    this.onContact = null;
    // Hook: (a, b, impulse, contact) after resolution (damage from impacts).
    this.onImpact = null;
  }

  add(body) {
    if (body.isStatic) {
      this.staticBodies.push(body);
      this._gridInsert(this.staticGrid, body);
    } else {
      this.dynamic.push(body);
    }
    return body;
  }

  remove(body) {
    body.alive = false;
    if (body.isStatic) {
      const i = this.staticBodies.indexOf(body);
      if (i >= 0) this.staticBodies.splice(i, 1);
      const r = body.r;
      const c0 = Math.max(0, Math.floor((body.x - r) / CELL));
      const c1 = Math.min(this.cols - 1, Math.floor((body.x + r) / CELL));
      const r0 = Math.max(0, Math.floor((body.y - r) / CELL));
      const r1 = Math.min(this.rows - 1, Math.floor((body.y + r) / CELL));
      for (let cy = r0; cy <= r1; cy++) {
        for (let cx = c0; cx <= c1; cx++) {
          const cell = this.staticGrid[cy * this.cols + cx];
          const j = cell.indexOf(body);
          if (j >= 0) cell.splice(j, 1);
        }
      }
    }
    // Dynamic bodies are filtered lazily in step().
  }

  _gridInsert(grid, body) {
    const r = body.r;
    const c0 = Math.max(0, Math.floor((body.x - r) / CELL));
    const c1 = Math.min(this.cols - 1, Math.floor((body.x + r) / CELL));
    const r0 = Math.max(0, Math.floor((body.y - r) / CELL));
    const r1 = Math.min(this.rows - 1, Math.floor((body.y + r) / CELL));
    for (let cy = r0; cy <= r1; cy++)
      for (let cx = c0; cx <= c1; cx++) grid[cy * this.cols + cx].push(body);
  }

  // All bodies (static + dynamic) whose bounds overlap the circle.
  query(x, y, radius, out = []) {
    out.length = 0;
    const c0 = Math.max(0, Math.floor((x - radius) / CELL));
    const c1 = Math.min(this.cols - 1, Math.floor((x + radius) / CELL));
    const r0 = Math.max(0, Math.floor((y - radius) / CELL));
    const r1 = Math.min(this.rows - 1, Math.floor((y + radius) / CELL));
    const stamp = ++this._stamp;
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const idx = cy * this.cols + cx;
        for (const grid of [this.staticGrid, this.dynGrid]) {
          for (const b of grid[idx]) {
            if (!b.alive || b._q === stamp) continue;
            b._q = stamp;
            const dx = b.x - x, dy = b.y - y, rr = b.r + radius;
            if (dx * dx + dy * dy <= rr * rr) out.push(b);
          }
        }
      }
    }
    return out;
  }

  // Ray-march style segment test returning the first body hit.
  raycast(x0, y0, x1, y1, filter) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len / 6));
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const candidates = this.query(mx, my, len / 2 + 4, []);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = x0 + dx * t, py = y0 + dy * t;
      for (const b of candidates) {
        if (filter && !filter(b)) continue;
        if (b.containsPoint(px, py)) return { body: b, x: px, y: py, t };
      }
    }
    return null;
  }

  step(dt) {
    // Remove dead bodies.
    if (this.dynamic.some((b) => !b.alive)) this.dynamic = this.dynamic.filter((b) => b.alive);

    // Integrate.
    for (const b of this.dynamic) {
      b.vx += b.fx * b.invMass * dt;
      b.vy += b.fy * b.invMass * dt;
      b.av += b.torque * b.invInertia * dt;
      if (b.linearDrag) {
        const k = Math.max(0, 1 - b.linearDrag * dt);
        b.vx *= k;
        b.vy *= k;
      }
      if (b.groundFriction) {
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > 0) {
          const ns = Math.max(0, sp - b.groundFriction * dt);
          b.vx *= ns / sp;
          b.vy *= ns / sp;
        }
        const as = Math.abs(b.av);
        if (as > 0) b.av *= Math.max(0, as - b.groundFriction * 0.02 * dt) / as;
      }
      if (b.angularDrag) b.av *= Math.max(0, 1 - b.angularDrag * dt);
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.angle += b.av * dt;
      b.cos = Math.cos(b.angle);
      b.sin = Math.sin(b.angle);
      b.fx = b.fy = b.torque = 0;
      // Keep inside the world.
      const m = b.r;
      if (b.x < m) { b.x = m; b.vx = Math.abs(b.vx) * 0.3; }
      if (b.y < m) { b.y = m; b.vy = Math.abs(b.vy) * 0.3; }
      if (b.x > this.width - m) { b.x = this.width - m; b.vx = -Math.abs(b.vx) * 0.3; }
      if (b.y > this.height - m) { b.y = this.height - m; b.vy = -Math.abs(b.vy) * 0.3; }
    }

    // Broad phase: rebuild dynamic grid.
    for (const cell of this.dynGrid) cell.length = 0;
    for (const b of this.dynamic) this._gridInsert(this.dynGrid, b);

    // Narrow phase + resolution (two iterations for stacking stability).
    for (let iter = 0; iter < 2; iter++) {
      const stamp = (this._pairStamp = (this._pairStamp || 0) + 1);
      for (const a of this.dynamic) {
        if (!a.alive) continue;
        a._pair = stamp;
        const r = a.r;
        const c0 = Math.max(0, Math.floor((a.x - r) / CELL));
        const c1 = Math.min(this.cols - 1, Math.floor((a.x + r) / CELL));
        const r0 = Math.max(0, Math.floor((a.y - r) / CELL));
        const r1 = Math.min(this.rows - 1, Math.floor((a.y + r) / CELL));
        const seen = (this._seen = this._seen || new Set());
        seen.clear();
        for (let cy = r0; cy <= r1; cy++) {
          for (let cx = c0; cx <= c1; cx++) {
            const idx = cy * this.cols + cx;
            for (const b of this.staticGrid[idx]) {
              if (seen.has(b.id)) continue;
              seen.add(b.id);
              this._resolvePair(a, b, iter);
            }
            for (const b of this.dynGrid[idx]) {
              // Each dynamic pair once: only when b hasn't been processed as 'a'.
              if (b === a || b._pair === stamp || seen.has(b.id)) continue;
              seen.add(b.id);
              this._resolvePair(a, b, iter);
            }
          }
        }
      }
    }
  }

  _resolvePair(a, b, iter) {
    if (!a.alive || !b.alive) return;
    if (!(a.layer & b.mask) || !(b.layer & a.mask)) return;
    const dx = b.x - a.x, dy = b.y - a.y, rr = a.r + b.r;
    if (dx * dx + dy * dy > rr * rr) return;
    const c = collide(a, b);
    if (!c) return;
    if (this.onContact && this.onContact(a, b, c) === false) return;

    const { nx, ny, cx, cy } = c;
    const rax = cx - a.x, ray = cy - a.y;
    const rbx = cx - b.x, rby = cy - b.y;
    const vax = a.vx - a.av * ray, vay = a.vy + a.av * rax;
    const vbx = b.vx - b.av * rby, vby = b.vy + b.av * rbx;
    const rvx = vbx - vax, rvy = vby - vay;
    const vn = rvx * nx + rvy * ny;

    // Positional correction (split by inverse mass).
    const invSum = a.invMass + b.invMass;
    if (invSum > 0) {
      const corr = (Math.max(c.depth - 0.3, 0) / invSum) * 0.7;
      a.x -= nx * corr * a.invMass;
      a.y -= ny * corr * a.invMass;
      b.x += nx * corr * b.invMass;
      b.y += ny * corr * b.invMass;
    }

    if (vn > 0) return;

    const raCn = rax * ny - ray * nx;
    const rbCn = rbx * ny - rby * nx;
    const denom = invSum + raCn * raCn * a.invInertia + rbCn * rbCn * b.invInertia;
    if (denom <= 0) return;
    const e = iter === 0 ? Math.min(a.restitution, b.restitution) : 0;
    const j = (-(1 + e) * vn) / denom;
    a.applyImpulseAt(-nx * j, -ny * j, cx, cy);
    b.applyImpulseAt(nx * j, ny * j, cx, cy);

    // Coulomb friction along the tangent.
    const tx = -ny, ty = nx;
    const vt = rvx * tx + rvy * ty;
    const raCt = rax * ty - ray * tx;
    const rbCt = rbx * ty - rby * tx;
    const tden = invSum + raCt * raCt * a.invInertia + rbCt * rbCt * b.invInertia;
    if (tden > 0) {
      const mu = Math.sqrt(a.friction * b.friction);
      let jt = -vt / tden;
      jt = Math.max(-j * mu, Math.min(j * mu, jt));
      a.applyImpulseAt(-tx * jt, -ty * jt, cx, cy);
      b.applyImpulseAt(tx * jt, ty * jt, cx, cy);
    }

    if (iter === 0 && this.onImpact) this.onImpact(a, b, j, c, -vn);
  }
}
