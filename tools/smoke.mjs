// Headless smoke test: loads the game, plays a little, captures screenshots and errors.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = new URL('./out/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const server = spawn('node', [new URL('../server.mjs', import.meta.url).pathname], { env: { ...process.env, PORT: '8137' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 400));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', '--use-angle=metal', '--enable-gpu-rasterization'],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message + '\n' + e.stack));
const t0 = Date.now();
await page.goto('http://localhost:8137/', { waitUntil: 'load' });
await page.waitForFunction(() => window.game, { timeout: 20000 });
console.log('boot ms', Date.now() - t0);
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: out + '1-title.png' });
const scenario = process.argv[2] || 'basic';
try {
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 1500));
await page.mouse.move(900, 300);
await page.keyboard.down('KeyW');
await page.keyboard.down('ShiftLeft');
await new Promise((r) => setTimeout(r, 1200));
await page.keyboard.up('ShiftLeft');
await page.mouse.down();
await new Promise((r) => setTimeout(r, 1500));
await page.mouse.up();
await page.keyboard.down('KeyD');
await new Promise((r) => setTimeout(r, 800));
await page.keyboard.up('KeyD');
await page.keyboard.up('KeyW');
await page.screenshot({ path: out + '2-driving.png' });
// Fast-forward into combat: spawn wave 4 right next to the player.
await page.evaluate(() => {
  const g = window.game;
  g.player.shield = 30;
  g.startWave(4);
  for (let i = 0; i < 6; i++) g.spawnEnemy(g.spawnQueue.shift() || 'battle');
  for (const ai of g.enemyTanks) {
    const a = Math.random() * Math.PI * 2;
    ai.tank.body.x = g.player.x + Math.cos(a) * 420;
    ai.tank.body.y = g.player.y + Math.sin(a) * 300;
  }
  for (const a of g.air) { a.x = g.player.x + 300; a.y = g.player.y - 200; }
});
for (let i = 0; i < 8; i++) {
  await page.evaluate(() => {
    const g = window.game;
    const e = g.enemyTanks[0];
    if (e) { const [sx, sy] = g.worldToScreen(e.tank.x, e.tank.y); window.__aim = [sx, sy]; } else window.__aim = [900, 400];
  });
  const [ax, ay] = await page.evaluate(() => window.__aim);
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await new Promise((r) => setTimeout(r, 350));
  await page.mouse.up();
}
await page.screenshot({ path: out + '3-combat.png' });
const stats = await page.evaluate(() => {
  const g = window.game;
  return { state: g.state, score: g.score, kills: g.kills, enemies: g.enemyTanks.length, air: g.air.length, particles: g.fx.count, chunks: g.world.chunks.size, props: g.world.props.length, hp: Math.round(g.player.hp) };
});
console.log(JSON.stringify(stats));
// Measure frame time
const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const s = performance.now(); const f = () => { n++; if (performance.now() - s < 2000) requestAnimationFrame(f); else res(n / 2); }; requestAnimationFrame(f); }));
console.log('fps (headless)', fps);
if (scenario === 'upgrade') {
  await page.evaluate(() => window.game.openUpgrade());
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: out + '4-upgrade.png' });
  await page.keyboard.press('Digit2');
  await page.evaluate(() => { const g = window.game; g.player.shield = 0; g.player.damage(9999, null); });
  await new Promise((r) => setTimeout(r, 3500));
  await page.screenshot({ path: out + '5-gameover.png' });
}
} catch (e) { console.log('SCRIPT ERROR', e.message); }
console.log(errors.length ? errors.slice(0, 15).join('\n') : 'no console errors');
await browser.close();
server.kill();
