import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
const server = spawn('node', [new URL('../server.mjs', import.meta.url).pathname], { env: { ...process.env, PORT: '8140' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 400));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log(e.message));
await page.goto('http://localhost:8140/');
await page.waitForFunction(() => window.game && window.game.world);
await page.evaluate(() => { const g = window.game; g.startGame(); g.player.hp = g.player.maxHp = 1e6; g.wave = 3; g.waveTimer = 0.05; });
await new Promise((r) => setTimeout(r, 1500));
await new Promise((r) => setTimeout(r, 6000));
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 250));
  console.log(await page.evaluate(() => {
    const g = window.game, ai = g.enemyTanks.find((e) => e.tank.kind !== 'scout' && Math.hypot(e.tank.x - g.player.x, e.tank.y - g.player.y) > 800); if (!ai) return 'none';
    const t = ai.tank, w = g.world;
    const f = w.flowDir(t.x, t.y);
    const C = w.flowC; const c = (t.x / C) | 0, r = (t.y / C) | 0;
    const here = w.flow[r * w.flowCols + c];
    return JSON.stringify({ x: Math.round(t.x), y: Math.round(t.y), ang: t.angle.toFixed(2), thr: t.throttle.toFixed(2), turn: t.turn.toFixed(2), sp: Math.round(t.body.speed), f: f && f.map((v) => v.toFixed(2)), here, blocked: w.blocked[r * w.flowCols + c], rev: ai.reverse.toFixed(2), tile: w.tileAt(t.x, t.y), los: ai.los, kind: t.kind, near: g.physics.query(t.x, t.y, 60).filter(b=>b!==t.body).map(b => b.kind + ':' + (b.owner && b.owner.type || '')).join(',') });
  }));
}
await browser.close();
server.kill();
