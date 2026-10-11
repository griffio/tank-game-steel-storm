// Entry point: build the game once fonts are ready and start the frame loop.

import { Game } from './game.js';

async function boot() {
  const canvas = document.getElementById('screen');
  try {
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
  } catch {}
  // Let the loading screen paint before the (synchronous) world generation.
  await new Promise((r) => setTimeout(r, 30));
  const game = new Game(canvas);
  window.game = game;
  document.getElementById('loading').remove();
  const loop = (now) => {
    game.frame(now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

boot();
