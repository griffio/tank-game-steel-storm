// Plays the bundled single file straight from disk (file://), no server.
import puppeteer from 'puppeteer-core';
const out = new URL('./out/', import.meta.url).pathname;
const file = 'file://' + new URL('../dist/steel-storm.html', import.meta.url).pathname;
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', defaultViewport: { width: 1280, height: 800 } });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('requestfailed', (r) => errors.push('request failed: ' + r.url().slice(0, 80)));
await page.goto(file);
await page.waitForFunction(() => window.game && window.game.world, { timeout: 20000 });
await new Promise((r) => setTimeout(r, 1500));
const fonts = await page.evaluate(() => ({ russo: document.fonts.check('20px "Russo One"'), mono: document.fonts.check('20px "Share Tech Mono"'), requests: performance.getEntriesByType('resource').map((e) => e.name.slice(0, 60)) }));
console.log('fonts', JSON.stringify(fonts));
await page.screenshot({ path: out + 'dist-title.png' });
await page.mouse.click(640, 400);
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(() => { const g = window.game; g.player.hp = g.player.maxHp = 5000; g.waveTimer = 0; });
await page.keyboard.down('KeyW');
for (let i = 0; i < 10; i++) {
  const [x, y] = await page.evaluate(() => { const g = window.game; const t = g.findTarget(g.player.x, g.player.y, 'player', 1200); return t ? g.worldToScreen(t.x, t.y) : [900, 300]; });
  await page.mouse.move(x, y);
  await page.mouse.down();
  await new Promise((r) => setTimeout(r, 400));
  await page.mouse.up();
}
await page.keyboard.up('KeyW');
const s = await page.evaluate(() => { const g = window.game; return { state: g.state, wave: g.wave, kills: g.kills, score: g.score, best: g.best }; });
console.log(JSON.stringify(s));
await page.screenshot({ path: out + 'dist-play.png' });
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
