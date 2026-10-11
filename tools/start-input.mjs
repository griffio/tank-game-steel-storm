// Starting the game must not also fire: the key/click that deploys is consumed.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
const server = spawn('node', [new URL('../server.mjs', import.meta.url).pathname], { env: { ...process.env, PORT: '8143' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 400));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', defaultViewport: { width: 1280, height: 800 } });
const page = await browser.newPage();
await page.goto('http://localhost:8143/');
await page.waitForFunction(() => window.game && window.game.world);
const frames = (n) => page.evaluate((n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const fired = () => page.evaluate(() => ({ state: game.state, missiles: game.missiles, shots: game.stats.shots, inFlight: game.projectiles.list ? game.projectiles.list.filter((p) => p.team === 'player').length : undefined }));
let fail = 0;
for (const how of ['Enter', 'Space', 'click']) {
  await page.evaluate(() => game.state !== 'title' && game.toTitle());
  await frames(5);
  if (how === 'click') {
    await page.mouse.move(640, 300);
    await page.mouse.down();
    await frames(20);
    await page.mouse.up();
  } else {
    await page.keyboard.down(how);
    await frames(20);
    await page.keyboard.up(how);
  }
  await frames(5);
  const r = await fired();
  const ok = r.state === 'playing' && r.missiles === 3 && r.shots === 0;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} start via ${how}:`, JSON.stringify(r));
}
await browser.close();
server.kill();
process.exit(fail ? 1 : 0);
