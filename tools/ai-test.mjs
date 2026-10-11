// Observe enemy AI over time with an invulnerable, stationary player.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
const out = new URL('./out/', import.meta.url).pathname;
const server = spawn('node', [new URL('../server.mjs', import.meta.url).pathname], { env: { ...process.env, PORT: '8139' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 400));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + ' ' + e.stack));
await page.goto('http://localhost:8139/');
await page.waitForFunction(() => window.game && window.game.world, { timeout: 20000 });
const wave = Number(process.argv[2] || 1);
await page.evaluate((wave) => {
  const g = window.game;
  g.startGame();
  g.player.hp = g.player.maxHp = 1e6;
  g.waveTimer = 0.1;
  if (wave > 1) { g.wave = wave - 1; }
}, wave);
for (let i = 0; i < 10; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  const s = await page.evaluate(() => {
    const g = window.game, p = g.player;
    return {
      t: g.time.toFixed(1),
      wave: g.wave, ws: g.waveState, q: g.spawnQueue.length,
      dmg: Math.round(g.stats.damageTaken),
      enemies: g.enemyTanks.map((e) => `${e.tank.kind}:${Math.round(Math.hypot(e.tank.x - p.x, e.tank.y - p.y))}${e.los ? '*' : ''}@${Math.round(e.tank.body.speed)}`).join(' '),
      air: g.air.map((a) => `${a.constructor.name[0]}:${Math.round(Math.hypot(a.x - p.x, a.y - p.y))}`).join(' '),
      proj: g.projectiles.list.filter((x) => x.alive).length, src: Object.fromEntries(Object.entries(g.stats.bySource).map(([k, v]) => [k, Math.round(v)])),
    };
  });
  console.log(JSON.stringify(s));
  if (i === 5) await page.screenshot({ path: out + `ai-wave${wave}.png` });
}
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
server.kill();
