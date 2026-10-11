// Keyboard, mouse and gamepad input, normalised into a single control state.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set(); // edge-triggered this frame
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseDown = [false, false, false];
    this.mouseClicked = [false, false, false];
    this.usingGamepad = false;
    this.pad = null;
    this.padPressed = new Set();
    this._padPrev = [];

    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.usingGamepad = false;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = [false, false, false];
    });
    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      this.mouseY = e.clientY - r.top;
      this.usingGamepad = false;
    });
    canvas.addEventListener('mousedown', (e) => {
      this.mouseDown[e.button] = true;
      this.mouseClicked[e.button] = true;
      this.usingGamepad = false;
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => (this.mouseDown[e.button] = false));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  down(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  hit(...codes) {
    return codes.some((c) => this.pressed.has(c));
  }

  padHit(i) {
    return this.padPressed.has(i);
  }

  pollGamepad() {
    this.pad = null;
    this.padPressed.clear();
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (p && p.connected) {
        this.pad = p;
        break;
      }
    }
    if (!this.pad) return;
    const p = this.pad;
    p.buttons.forEach((b, i) => {
      if (b.pressed && !this._padPrev[i]) {
        this.padPressed.add(i);
        this.usingGamepad = true;
      }
      this._padPrev[i] = b.pressed;
    });
    const mag = (x, y) => Math.hypot(x, y);
    if (mag(p.axes[0], p.axes[1]) > 0.3 || mag(p.axes[2] ?? 0, p.axes[3] ?? 0) > 0.3) this.usingGamepad = true;
  }

  // Axis with radial dead-zone.
  stick(ix, iy, dead = 0.2) {
    if (!this.pad) return [0, 0];
    const x = this.pad.axes[ix] ?? 0, y = this.pad.axes[iy] ?? 0;
    const m = Math.hypot(x, y);
    if (m < dead) return [0, 0];
    const k = Math.min(1, (m - dead) / (1 - dead)) / m;
    return [x * k, y * k];
  }

  padButton(i) {
    return !!(this.pad && this.pad.buttons[i] && this.pad.buttons[i].pressed);
  }

  padValue(i) {
    return this.pad && this.pad.buttons[i] ? this.pad.buttons[i].value : 0;
  }

  endFrame() {
    this.pressed.clear();
    this.mouseClicked = [false, false, false];
  }
}
