// Keyboard + mouse (pointer lock) + standard gamepad. Produces a unified per-frame snapshot.
// Gamepad: radial dead zone + response curve sticks (padStick) and subtle dual-rumble (rumble), scaled by
// settings.rumble (0..1, default 1) and only while the pad is the active device.
import { G } from './ctx.js';

// keys whose browser default (focus moves, page scroll) must never fire while the game has the mouse
const GAME_KEYS = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash', 'Quote']);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();       // keys pressed this frame
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftPressed: false, rightPressed: false };
    this.locked = false;
    this.enabled = true;
    this.pad = null;
    this.padPrev = [];
    this.padPressed = new Set();
    this.lastDevice = 'kbm';
    // Which key codes the touch layer currently holds down. Needed so they can be released
    // as a group when touch input stops (app backgrounded, overlay hidden), and so a
    // synthesized key is never confused with a real keyboard press of the same code.
    this._touchKeys = new Set();
    this.onKey = null;              // (e) => bool consumed  (menus)
    window.addEventListener('keydown', (e) => {
      // ⌘-combos (⌘Q quit, ⌘H hide, ⌘M minimise, ⌘W close …) belong to macOS: never read them as game / menu keys
      // (the menus mapped ⌘Q to "previous tab" and swallowed it). macOS also sends no keyup for a key released while
      // ⌘ is held, so tracking them would leave the key stuck down.
      if (e.metaKey) return;
      // the menus call preventDefault themselves when needed (text fields must still receive keystrokes)
      // auto-repeat must be swallowed too: holding TAB for the map used to let the repeats move browser focus off the
      // canvas → pointer lock dropped → the round paused ("opening the map opens the menu")
      if (e.repeat) {
        if (e.code === 'Tab' || (this.locked && GAME_KEYS.has(e.code))) e.preventDefault();
        if (this.onKey) this.onKey(e, true);
        return;
      }
      this.lastDevice = 'kbm';
      if (this.onKey && this.onKey(e, false)) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (GAME_KEYS.has(e.code) && this.locked) e.preventDefault();
      if (e.code === 'Tab') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
      this.lastDevice = 'kbm';
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightPressed = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.mouse.left = this.mouse.right = false; this.onUnlock?.(); }
    });
  }

  requestLock() {
    // Color Brawl: Android WebView has no Pointer Lock API. The touch layer replaces the
    // mouse entirely, so requesting a lock is meaningless — and must not throw.
    if (!this.canvas.requestPointerLock) return;
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      // some platforms reject unadjustedMovement: fall back to a plain request
      if (p && p.catch) p.catch(() => { try { const q = this.canvas.requestPointerLock(); if (q && q.catch) q.catch(() => {}); } catch { /* ignore */ } });
    } catch { /* not allowed without a gesture */ }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  down(code) { return this.keys.has(code); }
  wasPressed(code) { return this.pressed.has(code); }

  /* COLORBRAWL-ANDROID */
  // Color Brawl: the Android touch layer is a third input source, polled once per frame
  // exactly like the gamepad. Fire and sub are level-triggered (hold to shoot); the rest
  // are edges consumed by endFrame().
  pollTouch() {
    const t = window.__cbTouch;
    if (!t) return;
    t.active = true;
    if (t.lookX || t.lookY) {
      this.mouse.dx += t.lookX; this.mouse.dy += t.lookY;
      this.lastDevice = 'touch';
      if (window.__cbSeam) window.__cbSeam('pollWrote', { lookX: t.lookX, lookY: t.lookY, dxAfter: this.mouse.dx, dyAfter: this.mouse.dy });
    }
    if (t.fire && !this.mouse.left) this.mouse.leftPressed = true;
    this.mouse.left = !!t.fire;
    if (t.sub && !this.mouse.right) this.mouse.rightPressed = true;
    this.mouse.right = !!t.sub;
    if (t.jump) this.touchKey('Space', true); else this.touchKey('Space', false);
    if (t.squid) this.touchKey('ShiftLeft', true); else this.touchKey('ShiftLeft', false);
    if (t.special) this.touchKey('KeyF', true); else this.touchKey('KeyF', false);
    if (t.map) this.touchKey('Tab', true); else this.touchKey('Tab', false);
    if (t.pause) this.touchKey('Escape', true); else this.touchKey('Escape', false);
    if (t.cheer) this.touchKey('KeyC', true); else this.touchKey('KeyC', false);
  }
  /* COLORBRAWL-ANDROID */
  // Sets a synthesized key to match the touch state, every frame.
  //
  // The first version of this method only ADDED to this.keys (it was called touchAdd), so
  // once the player tapped JUMP the 'Space' entry stayed in this.keys for the life of the
  // page: player.js reads inp.down('Space') every frame, so the actor jumped permanently
  // and could never stop. Fire and sub escaped the bug because they assign this.mouse.left
  // and this.mouse.right directly, and pollTouch DOES clear those each frame — that asymmetry
  // is what exposed it. Every touch-owned key is tracked in _touchKeys so it can be released
  // here, and released as a group if the whole touch layer goes inactive.
  touchKey(code, on) {
    if (on) {
      if (!this.keys.has(code)) this.pressed.add(code);   // edge, for wasPressed()
      this.keys.add(code);
      this._touchKeys.add(code);
    } else if (this._touchKeys.has(code)) {
      this.keys.delete(code);
      this._touchKeys.delete(code);
    }
  }
  releaseTouchKeys() {
    for (const code of this._touchKeys) this.keys.delete(code);
    this._touchKeys.clear();
  }

  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) if (p && p.connected && p.mapping === 'standard') { pad = p; break; }
    if (!pad) for (const p of pads) if (p && p.connected) { pad = p; break; }
    // Color Brawl: expose the touch joystick as a gamepad-shaped device so the original
    // analog look path, aim assist and menu navigation work unchanged.
    if (!pad && window.__cbTouchPad && window.__cbTouch && window.__cbTouch.active) {
      pad = window.__cbTouchPad;
      if (window.__cbTouch.moveX || window.__cbTouch.moveY || window.__cbTouch.lookX || window.__cbTouch.lookY) this.lastDevice = 'touch';
    }
    this.pad = pad;
    this.padPressed.clear();
    if (!pad) return;
    pad.buttons.forEach((b, i) => {
      const was = this.padPrev[i] || false;
      if (b.pressed && !was) { this.padPressed.add(i); this.lastDevice = 'pad'; }
      this.padPrev[i] = b.pressed;
    });
    const ax = pad.axes;
    if (Math.abs(ax[0]) > 0.3 || Math.abs(ax[1]) > 0.3 || Math.abs(ax[2]) > 0.3 || Math.abs(ax[3]) > 0.3) this.lastDevice = 'pad';
  }
  padButton(i) { return !!(this.pad && this.pad.buttons[i] && this.pad.buttons[i].pressed); }
  padValue(i) { return this.pad && this.pad.buttons[i] ? this.pad.buttons[i].value : 0; }
  padAxis(i) {
    if (!this.pad) return 0;
    const v = this.pad.axes[i] || 0;
    const dz = 0.14;
    return Math.abs(v) < dz ? 0 : Math.sign(v) * (Math.abs(v) - dz) / (1 - dz);
  }

  // Stick with a RADIAL dead zone (no axis snapping on diagonals), an outer dead zone (full deflection is reachable
  // on worn sticks) and an optional response exponent applied to the magnitude only (direction is preserved).
  padStick(ix, iy, out, dz = 0.12, outer = 0.96, expo = 1) {
    out.x = 0; out.y = 0; out.mag = 0;
    if (!this.pad) return out;
    const x = this.pad.axes[ix] || 0, y = this.pad.axes[iy] || 0;
    const m = Math.hypot(x, y);
    if (m <= dz) return out;
    const k = Math.min(1, (m - dz) / (outer - dz));
    const c = expo === 1 ? k : Math.pow(k, expo);
    out.x = (x / m) * c; out.y = (y / m) * c; out.mag = c;
    return out;
  }

  // Dual-rumble pulse. strong = low-frequency motor, weak = high-frequency motor (0..1), ms = duration.
  // A pulse only pre-empts a running one if it is at least as strong, so rapid fire never becomes a constant buzz.
  rumble(strong, weak, ms = 60) {
    const pad = this.pad;
    if (!pad || this.lastDevice !== 'pad') return;
    const k = G.settings?.rumble ?? 1;
    if (!(k > 0)) return;
    const act = pad.vibrationActuator;
    if (!act || !act.playEffect) return;
    const now = performance.now();
    const mag = Math.max(strong, weak) * k;
    if (now < (this._rumbleUntil || 0) && mag < (this._rumbleMag || 0) * 0.95) return;
    this._rumbleUntil = now + ms; this._rumbleMag = mag;
    try {
      const p = act.playEffect('dual-rumble', { startDelay: 0, duration: Math.round(ms), strongMagnitude: Math.min(1, strong * k), weakMagnitude: Math.min(1, weak * k) });
      if (p && p.catch) p.catch(() => {});
    } catch { /* unsupported */ }
  }

  // Call once at the very end of each frame.
  endFrame() {
    // Color Brawl: refresh touch state for the NEXT frame, then consume the edges.
    if (this.pollTouch) this.pollTouch();
    // Hand over the accumulated touch look delta and ZERO it.
    //
    // This single call is why the camera works at all. The touch layer accumulates raw
    // pointer movement in __cbTouch.lookX/lookY, and pollTouch() adds the whole total to
    // this.mouse.dx. Without zeroing it, the SAME ever-growing total is applied on every
    // frame, so the camera receives one enormous yaw change per frame and the view appears
    // frozen or spins wildly. A tap on FIRE also changes the aim path in player.js, which is
    // why it looked like firing was what broke the camera.
    //
    // The reset lives here rather than in a separate hook because touch.js's own
    // __cbTouchEndFrame was defined but never called by anything: an exported function with
    // no caller is not an integration. Keeping the reset beside the read makes that
    // impossible to reintroduce.
    if (window.__cbSeam) window.__cbSeam('endFrameBeforeReset', { dx: this.mouse.dx, dy: this.mouse.dy, lookX: window.__cbTouch ? window.__cbTouch.lookX : null });
    if (window.__cbTouchEndFrame) window.__cbTouchEndFrame();
    this.pressed.clear();
    this.mouse.dx = 0; this.mouse.dy = 0;
    this.mouse.leftPressed = false; this.mouse.rightPressed = false;
  }
}
