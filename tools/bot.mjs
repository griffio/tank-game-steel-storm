// Bot playthrough: auto-aim, drive, pick upgrades, exercise bases/pickups/boss.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
const out = new URL('./out/', import.meta.url).pathname;
const server = spawn('node', [new URL('../server.mjs', import.meta.url).pathname], { env: { ...process.env, PORT: '8142' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 400));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', defaultViewport: { width: 1280, height: 800 } });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + ' ' + e.stack));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:8142/');
await page.waitForFunction(() => window.game && window.game.world);
await page.evaluate(() => {
  const g = window.game;
  g.startGame();
  g.player.hp = g.player.maxHp = 5000;
  // Bot replaces player control.
  g.controlPlayer = function (dt) {
    const p = this.player;
    const t = this.findTarget(p.x, p.y, 'player', 1500);
    if (t) {
      const d = Math.hypot(t.x - p.x, t.y - p.y);
      p.aim = Math.atan2(t.y - p.y, t.x - p.x);
      this.aimX = t.x; this.aimY = t.y;
      const dir = d > 300 ? 1 : -0.3;
      const ang = p.aim + (d < 300 ? 1.2 : 0.3);
      p.throttle = dir; p.turn = Math.max(-1, Math.min(1, ((ang - p.angle + Math.PI * 3) % (Math.PI * 2) - Math.PI) * 2));
      if (p.fireCannon()) this.stats.shots++;
      p.fireMg();
      p.wantBoost = d > 600;
      if (this.missiles > 0 && Math.random() < 0.01) this.fireMissiles();
    } else { p.throttle = 0; p.turn = 0; }
  };
});
let maxWave = 0;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const s = await page.evaluate((i) => {
    const g = window.game;
    if (g.state === 'upgrade') g.chooseUpgrade(Math.floor(Math.random() * g.upgradeChoices.length));
    if (i === 6) { // visit a base
      const b = g.world.bases[0];
      g.player.body.x = b.x - b.w / 2 - 150; g.player.body.y = b.y;
    }
    if (i === 10) { g.spawnPickup(g.player.x + 10, g.player.y, 'nuke'); g.spawnPickup(g.player.x, g.player.y + 10, 'shield'); g.spawnPickup(g.player.x, g.player.y - 10, 'overdrive'); }
    if (i === 12 && g.wave < 4) { g.wave = 4; g.waveState = 'intermission'; g.waveTimer = 0; g.spawnQueue = []; for (const e of g.enemyTanks) e.tank.damage(1e5, g.player); for (const a of g.air) a.alive = false; }
    return { i, state: g.state, wave: g.wave, ws: g.waveState, score: g.score, kills: g.kills, hp: Math.round(g.player.hp), en: g.enemyTanks.length, air: g.air.length, bases: g.stats.bases, parts: g.fx.count, proj: g.projectiles.list.length, wrecks: g.wrecks.length, boss: g.boss ? Math.round(g.boss.hp) : null };
  }, i);
  maxWave = Math.max(maxWave, s.wave);
  if (i % 3 === 0) console.log(JSON.stringify(s));
  if (i === 20) await page.screenshot({ path: out + 'bot.png' });
}
const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const s = performance.now(); const f = () => { n++; if (performance.now() - s < 2000) requestAnimationFrame(f); else res(n / 2); }; requestAnimationFrame(f); }));
console.log('maxWave', maxWave, 'fps', fps);
console.log(errors.length ? errors.slice(0, 10).join('\n') : 'no errors');
await browser.close();
server.kill();
