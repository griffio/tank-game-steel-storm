// Headless sanity test of tank handling: top speed, acceleration and pivot rate.
import { PhysicsWorld } from '../src/physics.js';
import { Tank, SPECS } from '../src/tank.js';
import { T } from '../src/world.js';

const physics = new PhysicsWorld(6400, 6400);
const style = (L, W) => ({ style: { L, W }, trackW: W * 0.24, barrelLen: L * 0.6 });
const game = {
  physics, time: 0,
  world: { tileAt: () => T.GRASS, trackMark() {} },
  sprites: { tanks: { player: style(66, 46), scout: style(52, 36), battle: style(64, 44), heavy: style(80, 56), boss: style(150, 104) }, smoke: [{}] },
  fx: new Proxy({}, { get: () => () => {} }),
};
const dt = 1 / 60;
for (const kind of ['player', 'scout', 'battle', 'heavy', 'boss']) {
  const t = new Tank(game, kind, 3200, 3200, 0, 'enemy');
  t.throttle = 1;
  let t90 = null;
  for (let i = 0; i < 300; i++) {
    t.applyForces(dt); physics.step(dt);
    if (t90 === null && t.body.speed > SPECS[kind].vmax * 0.9) t90 = (i * dt).toFixed(2);
  }
  const top = t.body.speed.toFixed(0);
  // Pivot turn
  t.throttle = 0; t.turn = 1;
  for (let i = 0; i < 120; i++) { t.applyForces(dt); physics.step(dt); }
  const a0 = t.body.angle;
  for (let i = 0; i < 60; i++) { t.applyForces(dt); physics.step(dt); }
  const pivot = (t.body.angle - a0).toFixed(2);
  // Moving turn
  t.throttle = 1; t.turn = 1;
  for (let i = 0; i < 120; i++) { t.applyForces(dt); physics.step(dt); }
  const a1 = t.body.angle;
  for (let i = 0; i < 60; i++) { t.applyForces(dt); physics.step(dt); }
  const moving = (t.body.angle - a1).toFixed(2);
  const spdTurn = t.body.speed.toFixed(0);
  // Boost
  t.turn = 0; t.wantBoost = true; t.spec.boostMul = t.spec.boostMul ?? 1.6;
  for (let i = 0; i < 90; i++) { t.applyForces(dt); physics.step(dt); }
  console.log(kind.padEnd(7), 'top', top, 't90', t90, 'pivot rad/s', pivot, 'moving turn', moving, '@', spdTurn, 'boost', t.body.speed.toFixed(0));
  physics.remove(t.body);
}
