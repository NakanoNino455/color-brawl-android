/*
 * Color Brawl 鈥?Android Touch Input Layer
 * =============================================================================
 * This file is ADDITIVE. It changes no game logic. It presents itself to the original
 * INKWAVE code through the two seams that already exist:
 *
 *   1. `window.__cbTouch`     鈥?read by src/core/input.js   (a third input source beside
 *                               keyboard/mouse and gamepad)
 *   2. `window.__cbTouchPad`  鈥?read by src/game/player.js  (a synthetic controller that
 *                               supplies the analog MOVE and LOOK axes a virtual joystick
 *                               needs, using the same response curve as the real gamepad)
 *
 * No keyboard, mouse, actor, weapon, sub, special or kit code is touched. See
 * tools/patch-for-android.mjs for the exact, reversible diff.
 *
 * LAYOUT (landscape): left thumb = movement slider, right thumb = camera drag, right-hand
 * button cluster. Every button mirrors a real documented keyboard binding from
 * src/ui/menus.js `_scr_howto` 鈥?none are invented:
 *
 *   FIRE    = mouse left        JUMP  = Space        SQUID = Shift
 *   SUB     = mouse right / E   SPECIAL = F / Q      MAP   = Tab
 *   PAUSE   = Esc
 *
 * POINTER ROUTING. Only two elements ever take pointer events: the joystick pad and the
 * buttons. Everything else is `pointer-events: none`, so the original menu and HUD keep
 * receiving native taps and clicks 鈥?no synthetic click dispatch is needed anywhere, and
 * the canvas still sees a real gesture for the game's audio unlock.
 *
 * MULTI-TOUCH. Pointers are tracked by `pointerId`. The camera drag is served from a
 * window-level listener, so a finger that slides off any element keeps control, and every
 * pointer that ends (or is cancelled, or the window loses focus) releases exactly what it
 * owned. Nothing can stick.
 */
(function () {
  'use strict';

  // Re-entrancy accounting. This file must run exactly once per document. `window.__cbTouch`
  // is created just below, so a second evaluation is expected to bail out at the guard; if it
  // ever does not, the number of live instances is the first thing to check, because each
  // instance owns its own closure state.
  window.__cbTouchInstance = (window.__cbTouchInstance || 0) + 1;
  var INSTANCE = window.__cbTouchInstance;

  // Editor chrome elements. Declared at the very top so no code path can touch them before
  // their assignment runs — this project has already produced two bugs from `var` hoisting
  // (geom in BUG-003, forceVisible in BUG-015a), both silent.
  var handleBar = null, readout = null;
  /** True once the overlay is in the DOM and its state objects exist. */
  var mounted = false;

  if (window.__cbTouch) return;

  /**
   * Resolves the game's global context object.
   *
   * NOT `window.G`. `src/main.js` publishes the running game as `window.__inkwave` (the Game
   * instance) and `window.__G` (the shared context object from `src/core/ctx.js`), and
   * nothing anywhere assigns `window.G`. An earlier version of this file read `window.G`,
   * which is therefore *always* undefined — so every state check here silently failed. That
   * looked exactly like "the game has not booted yet", and it hid the real cause for several
   * debugging rounds: the overlay was never shown during a real match, and the automated
   * probe always reported `hasG:false` even while a match ran to completion.
   *
   * Both names are checked because `__G` and `__inkwave` are published on adjacent lines and
   * either alone is enough to reach `.mode`, `.match`, `.game` and `.input`.
   */
  function cbCtx() {
    return window.__G || window.__inkwave || null;
  }
  function hasCtx() {
    return !!(window.__G || window.__inkwave);
  }

  function log(level, msg) {
    try { window.ColorBrawl && window.ColorBrawl.log(level, String(msg)); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // State contract (consumed by the patched input.js / player.js)
  // ---------------------------------------------------------------------------

  var state = {
    moveX: 0, moveY: 0,
    lookX: 0, lookY: 0,
    fire: false,
    jump: false,
    squid: false,
    sub: false,
    special: false,
    map: false,
    pause: false,
    cheer: false,
    active: false,
    pausedByHost: false
  };

  var pad = {
    axes: [0, 0, 0, 0],
    buttons: [],
    _synthetic: true,
    stick: function (ix, iy, out, dz, outer, expo) {
      out = out || {};
      out.x = 0; out.y = 0; out.mag = 0;
      if (ix !== 0 || iy !== 1) return out;
      var x = pad.axes[0], y = pad.axes[1];
      var m = Math.sqrt(x * x + y * y);
      if (m <= dz) return out;
      var k = Math.min(1, (m - dz) / (outer - dz));
      var c = (expo === 1 || expo === undefined) ? k : Math.pow(k, expo);
      out.x = (x / m) * c;
      out.y = (y / m) * c;
      out.mag = c;
      return out;
    }
  };

  window.__cbTouch = state;
  window.__cbTouchPad = pad;

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  var CSS = [
    '#cb-touch{position:fixed;inset:0;z-index:40;pointer-events:none;',
    'font-family:Rubik,system-ui,sans-serif;-webkit-user-select:none;user-select:none;',
    'touch-action:none;overscroll-behavior:none;-webkit-tap-highlight-color:transparent;}',
    '#cb-touch *{box-sizing:border-box;}',

    /* The ONLY large interactive surface: the joystick pad. It exists so a drag starting
       there never scrolls the page. Its rectangle is a circle's bounding box. */
    '#cb-stick-pad{position:absolute;pointer-events:auto;touch-action:none;border-radius:50%;}',

    '#cb-stick-base{position:absolute;border-radius:50%;pointer-events:none;',
    'border:2px solid rgba(255,255,255,.30);background:radial-gradient(circle at 50% 50%,',
    'rgba(10,14,32,.34),rgba(6,9,22,.20) 70%,rgba(6,9,22,.05));',
    'box-shadow:0 0 26px rgba(0,0,0,.30) inset;transition:opacity .12s ease;opacity:.55;}',
    '#cb-stick-knob{position:absolute;border-radius:50%;pointer-events:none;',
    'background:radial-gradient(circle at 36% 32%,rgba(255,255,255,.96),rgba(255,138,20,.94) 60%,rgba(206,82,0,.94));',
    'box-shadow:0 3px 14px rgba(0,0,0,.50),0 0 0 2px rgba(255,255,255,.22);',
    'transition:opacity .12s ease;opacity:.88;}',

    /* Action buttons: a large glyph disc with a small caption underneath.
       The caption sits BELOW the disc (not inside it) so the disc stays readable at a
       glance and the word never has to shrink to fit — the previous version put a full
       word inside a small circle, which is what made the labels overwhelming. */
    '.cb-btn{position:absolute;pointer-events:auto;touch-action:none;border-radius:50%;',
    'display:flex;align-items:center;justify-content:center;',
    'color:#fff;border:2px solid rgba(255,255,255,.42);',
    'background:radial-gradient(circle at 50% 38%,rgba(38,48,86,.52),rgba(10,14,32,.46));',
    'box-shadow:0 4px 16px rgba(0,0,0,.42),0 0 0 1px rgba(0,0,0,.25);',
    'transition:transform .06s ease,background .06s ease,border-color .06s ease;}',
    '.cb-btn__glyph{font-weight:800;line-height:1;text-shadow:0 1px 3px rgba(0,0,0,.8);',
    'pointer-events:none;}',
    '.cb-btn__cap{position:absolute;left:50%;top:100%;transform:translateX(-50%);',
    'margin-top:2px;color:#fff;font-weight:600;letter-spacing:.06em;white-space:nowrap;',
    'font-size:9px;opacity:.82;text-shadow:0 1px 3px rgba(0,0,0,.9),0 0 2px rgba(0,0,0,.9);',
    'pointer-events:none;}',
    '.cb-btn.is-down{transform:translate(-50%,-50%) scale(.90)!important;',
    'background:radial-gradient(circle at 50% 38%,rgba(255,168,72,.94),rgba(214,86,0,.90));',
    'border-color:#fff;}',
    '.cb-btn.is-down .cb-btn__cap{opacity:1;}',

    /* FIRE is the primary action: warm, larger, and always on top of the cluster. */
    '#cb-fire{background:radial-gradient(circle at 50% 36%,rgba(214,58,86,.62),rgba(120,20,40,.52));',
    'border-color:rgba(255,255,255,.60);z-index:2;}',
    '#cb-fire.is-down{background:radial-gradient(circle at 50% 36%,rgba(255,96,124,.96),rgba(196,32,62,.92));}',

    /* Utility buttons are small, dim and out of the thumb arc. */
    '.cb-btn--util{background:rgba(10,14,32,.38);border-color:rgba(255,255,255,.30);}',
    '.cb-btn--util .cb-btn__glyph{opacity:.9;font-weight:700;}',

    /* -------- layout editor -------- */
    '#cb-edit-bar{position:absolute;left:50%;transform:translateX(-50%);top:1.2vh;z-index:3;',
    'display:flex;align-items:center;gap:1.1vh;padding:.7vh 1.2vh;border-radius:999px;',
    'background:rgba(8,12,28,.80);border:2px solid rgba(255,255,255,.28);pointer-events:auto;',
    'font-size:1.7vh;font-weight:700;letter-spacing:.05em;color:#fff;}',
    '.cb-edit-bar__title{opacity:.75;font-size:1.4vh;}',
    '.cb-edit-bar__btn{font:inherit;color:#fff;cursor:pointer;border-radius:999px;',
    'padding:.5vh 1.6vh;border:2px solid rgba(255,255,255,.35);background:rgba(255,255,255,.10);}',
    '.cb-edit-bar__btn--done{background:rgba(96,224,168,.85);border-color:#fff;color:#05231a;}',
    '.cb-edit-bar__btn--reset{background:rgba(255,90,110,.75);border-color:#fff;}',
    '#cb-edit-readout{position:absolute;top:100%;left:50%;transform:translateX(-50%);',
    'margin-top:.6vh;white-space:pre;font:600 1.15vh/1.35 ui-monospace,Menlo,monospace;',
    'opacity:.8;text-align:center;}',
    /* while editing: dim the buttons, ring the dragged one, and let the stick stop hijacking */
    'body.cb-editing .cb-btn{border-style:dashed;}',
    'body.cb-editing #cb-stick-pad,body.cb-editing #cb-stick-base,',
    'body.cb-editing #cb-stick-knob{opacity:.25;}',
    '.cb-btn.is-editing{border-color:#fff;border-style:solid!important;',
    'box-shadow:0 0 0 3px rgba(255,255,255,.55),0 4px 16px rgba(0,0,0,.5);}',
    'body.cb-editing .cb-btn__cap{opacity:1;}',

    /* Aim latch: lit while armed, so its state is readable without covering the screen. */
    '#cb-look.is-on{background:radial-gradient(circle at 50% 38%,rgba(96,224,168,.92),rgba(14,122,86,.88));',
    'border-color:#fff;box-shadow:0 0 14px rgba(96,224,168,.65),0 4px 16px rgba(0,0,0,.42);}',
    '#cb-look.is-on .cb-btn__cap{opacity:1;}'
  ].join('');

  var styleEl = document.createElement('style');
  styleEl.id = 'cb-touch-style';
  styleEl.textContent = CSS;
  (document.head || document.documentElement).appendChild(styleEl);

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------

  var root = document.createElement('div');
  root.id = 'cb-touch';

  var stickPad = document.createElement('div');
  stickPad.id = 'cb-stick-pad';
  var stickBase = document.createElement('div');
  stickBase.id = 'cb-stick-base';
  var stickKnob = document.createElement('div');
  stickKnob.id = 'cb-stick-knob';

  root.appendChild(stickPad);
  root.appendChild(stickBase);
  root.appendChild(stickKnob);

  /*
   * CONTROL LAYOUT — modelled on the mobile-shooter convention (PUBG / Call of Duty Mobile):
   * a left-thumb movement stick, and a right cluster where the primary action is the biggest
   * disc and sits under the right thumb, with the secondary actions arced around it and the
   * utility buttons pushed out to the corners where they cannot be hit by accident.
   *
   *   size  — disc diameter, as a percentage of the SHORTER screen edge (so it scales with
   *           the device instead of with the aspect ratio)
   *   x, y  — disc centre, as viewport percentages
   *   glyph — the single character drawn in the disc
   *   cap   — the small caption printed BELOW the disc
   *   util  — small, dim, out of the thumb arc
   *
   * Every control maps to a real documented keyboard binding from the game's own HOW TO PLAY
   * screen (src/ui/menus.js `_scr_howto`); none are invented.
   */
  var BUTTONS = [
    // Defaults below were tuned by hand on device and read back out of
    // localStorage['colorbrawl.layout'] over the Chrome DevTools protocol, then baked in here.
    // 'pause' and 'look' were left where they were. Players can still move any of them from
    // Settings > Controls > Custom button layout.

    // primary action, bottom-right, under the right thumb
    { id: 'fire',    glyph: '\u25CF', cap: 'FIRE',    size: 19.0, x: 84.04, y: 69.91 },
    // secondary actions, arced left and above the primary
    { id: 'jump',    glyph: '\u25B2', cap: 'JUMP',    size: 13.0, x: 73.45, y: 64.94 },
    { id: 'squid',   glyph: '\u25BC', cap: 'SQUID',   size: 13.0, x: 76.29, y: 83.81 },
    { id: 'sub',     glyph: '\u25C6', cap: 'SUB',     size: 12.0, x: 79.68, y: 41.82 },
    { id: 'special', glyph: '\u2605', cap: 'SPECIAL', size: 12.0, x: 88.5,  y: 40.4 },
    // utility, corners only
    { id: 'map',     glyph: '\u25A6', cap: 'MAP',     size: 9.0,  x: 89.87, y: 23.03, util: true },
    { id: 'pause',   glyph: 'II',     cap: 'PAUSE',   size: 9.0,  x: 97.5, y: 10.0, util: true },
    // aim latch, under the left thumb beside the stick so it can be toggled by feel
    { id: 'look',    glyph: '\u25C9', cap: 'AIM',     size: 9.5,  x: 15.5, y: 10.0, util: true }
  ];

  var byId = {};
  BUTTONS.forEach(function (b) {
    var el = document.createElement('div');
    el.className = 'cb-btn' + (b.util ? ' cb-btn--util' : '');
    el.id = 'cb-' + b.id;
    el.dataset.cbFlag = b.id;

    // The glyph lives inside the disc; the caption sits just below it. Keeping them in
    // separate elements is what lets the disc stay large while the text stays small.
    var glyph = document.createElement('span');
    glyph.className = 'cb-btn__glyph';
    glyph.textContent = b.glyph;
    el.appendChild(glyph);

    var cap = document.createElement('span');
    cap.className = 'cb-btn__cap';
    cap.textContent = b.cap;
    el.appendChild(cap);

    root.appendChild(el);
    byId[b.id] = el;
  });

  /** Disc diameter in pixels, from the shorter edge so it holds across aspect ratios. */
  function discPx(b) {
    var vmin = Math.min(window.innerWidth, window.innerHeight);
    return Math.round(vmin * (b.size / 100));
  }

  // ---------------------------------------------------------------------------
  // Geometry
  //
  // Declared BEFORE mount() runs: this script is injected after the document has
  // already finished loading, so `mount()` below calls `layout()` synchronously.
  // ---------------------------------------------------------------------------

  var geom = { cx: 0, cy: 0, R: 0, knobR: 0 };

  /* ---------------------------------------------------------------- editor chrome */
  function buildEditorChrome() {
    handleBar = document.createElement('div');
    handleBar.id = 'cb-edit-bar';
    handleBar.style.display = 'none';

    var title = document.createElement('span');
    title.className = 'cb-edit-bar__title';
    title.textContent = 'DRAG TO REPOSITION';
    handleBar.appendChild(title);

    var mk = function (label, cls, fn) {
      var b = document.createElement('button');
      b.className = 'cb-edit-bar__btn ' + cls;
      b.textContent = label;
      b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
      handleBar.appendChild(b);
      return b;
    };
    mk('RESET', 'cb-edit-bar__btn--reset', function () { clearLayout(); layout(); updateReadout(); });
    mk('DONE', 'cb-edit-bar__btn--done', function () { setEditMode(false); });

    readout = document.createElement('div');
    readout.id = 'cb-edit-readout';
    handleBar.appendChild(readout);

    root.appendChild(handleBar);
  }

  function mount() {
    (document.body || document.documentElement).appendChild(root);
    buildEditorChrome();
    mounted = true;
    layout();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }

  function layout() {
    var vw = window.innerWidth, vh = window.innerHeight;
    geom.R = Math.max(52, Math.min(vh * 0.20, vw * 0.15));
    geom.knobR = geom.R * 0.44;
    geom.cx = geom.R * 1.30;
    geom.cy = vh - geom.R * 1.30;

    stickPad.style.left = (geom.cx - geom.R) + 'px';
    stickPad.style.top = (geom.cy - geom.R) + 'px';
    stickPad.style.width = stickPad.style.height = (geom.R * 2) + 'px';

    stickBase.style.left = (geom.cx - geom.R) + 'px';
    stickBase.style.top = (geom.cy - geom.R) + 'px';
    stickBase.style.width = stickBase.style.height = (geom.R * 2) + 'px';

    // Place every action disc from live viewport dimensions. Done here (not once at creation)
    // so an orientation change or a WebView resize re-lays the cluster out instead of leaving
    // the buttons at stale coordinates — which silently sends taps at empty screen.
    for (var i = 0; i < BUTTONS.length; i++) {
      var b = BUTTONS[i];
      var el = byId[b.id];
      if (!el) continue;
      var d = discPx(b);
      var p = posOf(b);                       // stored override, else the default
      el.style.width = el.style.height = d + 'px';
      el.style.left = (vw * p.x / 100) + 'px';
      el.style.top = (vh * p.y / 100) + 'px';
      el.style.transform = 'translate(-50%,-50%)';
      var g = el.querySelector('.cb-btn__glyph');
      if (g) g.style.fontSize = Math.round(d * (b.util ? 0.34 : 0.42)) + 'px';
    }

    stickKnob.style.width = stickKnob.style.height = (geom.knobR * 2) + 'px';
    knobTo(0, 0);
  }

  function knobTo(dx, dy) {
    stickKnob.style.left = (geom.cx - geom.knobR + dx) + 'px';
    stickKnob.style.top = (geom.cy - geom.knobR + dy) + 'px';
  }

  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', function () { setTimeout(layout, 140); });

  // ---------------------------------------------------------------------------
  // Multi-touch routing
  // ---------------------------------------------------------------------------

  var stickId = null;      // pointerId owning the movement slider
  var lookId = null;       // pointerId owning the camera drag
  var lookLast = { x: 0, y: 0 };
  var buttonOwner = {};    // pointerId -> button id
  var heldButtons = {};    // button id -> pointerId
  var downPointers = {};   // every pointer currently down, by pointerId

  /**
   * Multi-touch accounting. `activePointers` is how many pointers are down right now;
   * `maxPointers` is the high-water mark. Both are reported by the probe, so a multi-touch
   * result is backed by the layer's own count rather than by an assumption about what was
   * dispatched.
   */
  state.activePointers = 0;
  state.maxPointers = 0;
  var maxConcurrent = 0;

  /**
   * Aim latch. When on, a drag anywhere on screen turns the camera — including drags that
   * start on top of another button. This is the standard mobile-shooter "aim" toggle, and it
   * exists because a pointer landing on a button is otherwise consumed by that button and can
   * never reach the camera path: with the thumb resting on FIRE there was no free surface left
   * to aim with.
   */
  var lookActive = false;

  /* ===========================================================================
   * CUSTOM BUTTON LAYOUT
   *
   * Positions are stored as viewport percentages per control id, in localStorage. Defaults come
   * from the BUTTONS table, so a stored file only ever overrides the entries the player moved.
   * =========================================================================== */
  var LAYOUT_KEY = 'colorbrawl.layout';
  /**
   * Bump this whenever the DEFAULT table below changes in a way that should reach devices that
   * already have a stored override. On a mismatch the stored override is dropped once, so the
   * new defaults take effect; the player's next edit is then kept as normal. Without it, every
   * device that had ever opened the editor would keep its old positions for ever.
   */
  var LAYOUT_VERSION = 2;
  var LAYOUT_VERSION_KEY = 'colorbrawl.layoutVersion';
  var layoutOverride = {};
  var editMode = false;
  var editDrag = null;          // { id, dx, dy } — grab offset so the disc does not jump
  var editOnDown = false;
  var editLongPress = null;

  function loadLayout() {
    try {
      // One-time migration: a stored override from an older default layout is discarded so the
      // new defaults take effect. See LAYOUT_VERSION. The player's next edit is kept normally.
      var seenVersion = parseInt(localStorage.getItem(LAYOUT_VERSION_KEY) || '0', 10) || 0;
      if (seenVersion !== LAYOUT_VERSION) {
        localStorage.removeItem(LAYOUT_KEY);
        localStorage.setItem(LAYOUT_VERSION_KEY, String(LAYOUT_VERSION));
        layoutOverride = {};
        return;
      }
      var raw = localStorage.getItem(LAYOUT_KEY);
      layoutOverride = raw ? JSON.parse(raw) : {};
      if (!layoutOverride || typeof layoutOverride !== 'object') layoutOverride = {};
    } catch (err) { layoutOverride = {}; }
  }
  function saveLayout() {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layoutOverride));
      localStorage.setItem(LAYOUT_VERSION_KEY, String(LAYOUT_VERSION));
    } catch (err) { /* ignore */ }
  }
  function clearLayout() {
    layoutOverride = {};
    try { localStorage.removeItem(LAYOUT_KEY); } catch (err) { /* ignore */ }
  }
  loadLayout();

  /** Where a control should sit: the stored override if any, else its default from BUTTONS. */
  function posOf(b) {
    // (layoutOverride || {}) rather than layoutOverride: this is called from layout(), which
    // can run before the override table has been populated. Reaching it early threw
    // "Cannot read properties of undefined (reading 'fire')" — b.id is the button id.
    var o = (layoutOverride || {})[b.id];
    return (o && typeof o.x === 'number' && typeof o.y === 'number') ? o : b;
  }

  function setEditMode(on) {
    // Guarded: setEditMode can be reached from initialization as well as from a tap, and
    // releaseAll() touches pointer state that does not exist until the layer is mounted.
    // Without this the first call threw "Cannot read properties of undefined (reading 'fire')"
    // from inside releaseAll's `state[id]` loop.
    if (!mounted) {
      // Report the caller once, so a pre-mount call is visible rather than silently ignored.
      if (!window.__cbEditEarlyWarned) {
        window.__cbEditEarlyWarned = true;
        log('warn', 'setEditMode called before mount; ignored. stack=' + (new Error().stack || '').slice(0, 300));
      }
      return;
    }
    editMode = !!on;
    document.body.classList.toggle('cb-editing', editMode);
    if (handleBar) handleBar.style.display = editMode ? 'flex' : 'none';
    if (!editMode) { editDrag = null; releaseAll(); }
    updateReadout();
    requestAnimationFrame(layout);
  }

  function updateReadout() {
    if (!readout) return;
    if (!editMode) { readout.textContent = ''; return; }
    var lines = [];
    for (var i = 0; i < BUTTONS.length; i++) {
      var b = BUTTONS[i], p = posOf(b);
      lines.push(b.id + ' ' + Math.round(p.x) + ',' + Math.round(p.y));
    }
    readout.textContent = lines.join('\n');
  }
  /** The pointer that switched the latch on; it sets the reference point but does not steer. */
  var lookAnchorId = null;

  var LOOK_GAIN = 3.0;
  // Most CSS pixels of banked drag that one frame may spend on rotation. Pointer events arrive
  // far faster than frames, so an unlimited spend turned a steady drag into one instant snap.
  // The remainder is carried to the next frame, so a gesture's total rotation is unchanged.
  var LOOK_PER_FRAME = 34;

  function buttonFromTarget(el) {
    while (el && el !== root) {
      if (el.dataset && el.dataset.cbFlag) return el.dataset.cbFlag;
      el = el.parentElement;
    }
    return null;
  }

  function applyButton(id, down, why) {
    var el = byId[id];
    if (!el) { if (diagVisibility) log('info', 'BTN ' + id + ' NO-ELEMENT why=' + why); return; }
    if (down) {
      if (heldButtons[id] !== undefined) { if (diagVisibility) log('info', 'BTN ' + id + ' down IGNORED already-held why=' + why); return; }
      heldButtons[id] = true;
    } else {
      if (heldButtons[id] === undefined) { if (diagVisibility) log('info', 'BTN ' + id + ' up IGNORED not-held why=' + why + ' held=' + JSON.stringify(Object.keys(heldButtons))); return; }
      delete heldButtons[id];
    }
    state[id] = down;
    el.classList.toggle('is-down', down);
    if (diagVisibility) log('info', 'BTN ' + id + '=' + down + ' why=' + why + ' held=' + JSON.stringify(Object.keys(heldButtons)));
  }

  function syncPad() {
    pad.axes[0] = state.moveX;
    pad.axes[1] = state.moveY;
  }

  function stickMove(x, y) {
    var dx = x - geom.cx, dy = y - geom.cy;
    var m = Math.sqrt(dx * dx + dy * dy);
    var R = geom.R;
    if (m > R) { dx = (dx / m) * R; dy = (dy / m) * R; m = R; }
    knobTo(dx, dy);
    // Screen-up is forward. player.js computes `mz -= stick.y` and the keyboard path maps
    // W to `mz += 1`, so a negative y is forward 鈥?which is also screen-up. No inversion.
    var nx = dx / R, ny = dy / R;
    var mag = Math.min(1, m / R);
    var mm = Math.sqrt(nx * nx + ny * ny);
    if (mm > 1e-6) { nx = (nx / mm) * mag; ny = (ny / mm) * mag; }
    state.moveX = nx;
    state.moveY = ny;
    syncPad();
  }

  function stickEnd() {
    stickId = null;
    state.moveX = 0; state.moveY = 0;
    knobTo(0, 0);
    stickBase.style.opacity = '0.62';
    stickKnob.style.opacity = '0.85';
    syncPad();
  }

  /** Release everything. Used on blur / visibility loss / overlay hide so no input can stick. */
  function releaseAll() {
    if (stickId !== null) stickEnd();
    lookId = null;
    lookAnchorId = null;   // the aim latch itself survives; only the finger is dropped
    for (var id in heldButtons) {
      var el = byId[id];
      if (el) el.classList.remove('is-down');
      state[id] = false;
      if (diagVisibility) log('info', 'BTN ' + id + '=false why=releaseAll');
    }
    heldButtons = {};
    buttonOwner = {};
    downPointers = {};
    state.activePointers = 0;
    state.lookX = 0; state.lookY = 0;
  }

  function onDown(e) {
    if (state.pausedByHost) return;
    var id = e.pointerId;
    var x = e.clientX, y = e.clientY;

    /* ---- edit mode: every control is a drag handle, nothing is actuated ---- */
    if (editMode) {
      var hit = buttonFromTarget(e.target);
      if (!hit) return;
      var pel = byId[hit];
      if (!pel) return;
      var r0 = pel.getBoundingClientRect();
      editDrag = { id: hit, dx: x - (r0.left + r0.width / 2), dy: y - (r0.top + r0.height / 2) };
      if (!downPointers[id]) { downPointers[id] = true; state.activePointers++; }
      pel.classList.add('is-editing');
      if (e.cancelable) e.preventDefault();
      return;
    }

    /* ---- long-press on AIM toggles edit mode, a shortcut that avoids the menus ---- */
    var pressedBtn = buttonFromTarget(e.target);
    if (pressedBtn === 'look') {
      if (editLongPress) clearTimeout(editLongPress);
      editLongPress = setTimeout(function () { editLongPress = null; setEditMode(!editMode); }, 3000);
    }

    if (!downPointers[id]) { downPointers[id] = true; state.activePointers++; }
    state.maxPointers = Math.max(state.maxPointers, state.activePointers);

    var btn = buttonFromTarget(e.target);
    if (btn) {
      buttonOwner[id] = btn;
      if (btn === 'look') {
        // AIM TOGGLE. The mobile-shooter convention, and the answer to "I cannot turn the
        // camera while holding FIRE": with aim latched on, a drag ANYWHERE on screen turns the
        // view, including drags that start on top of another button. Without it, a pointer
        // that lands on a button is consumed by that button and can never drive the camera,
        // which is exactly why aiming died the moment the thumb was on FIRE.
        lookActive = !lookActive;
        state.lookActive = lookActive;
        byId.look.classList.toggle('is-on', lookActive);
        if (!lookActive) lookAnchorId = null;
        if (e.cancelable) e.preventDefault();
        return;
      }
      applyButton(btn, true, 'down-p' + id);
      if (e.cancelable) e.preventDefault();
      return;
    }

    if (e.target === stickPad) {
      // Reaching here only happens while the overlay is actually displayed: onDown checks the
      // event target, so a hidden pad (display:none) can never own the slider.
      if (stickId === null) {
        stickId = id;
        stickMove(x, y);
        stickBase.style.opacity = '0.95';
        stickKnob.style.opacity = '1';
      }
      if (e.cancelable) e.preventDefault();
      return;
    }

    // Anywhere else: a camera drag. This is a window-level listener, so the drag keeps
    // working even when the finger leaves the canvas or crosses other UI.
    if (lookId === null) {
      lookId = id;
      if (lookActive) lookAnchorId = id;
      lookLast.x = x; lookLast.y = y;
    }
  }

  function onMove(e) {
    var id = e.pointerId;

    /* ---- edit mode: move the grabbed control and remember it ---- */
    if (editMode && editDrag && downPointers[id]) {
      var b = null;
      for (var bi = 0; bi < BUTTONS.length; bi++) if (BUTTONS[bi].id === editDrag.id) b = BUTTONS[bi];
      if (b) {
        var vw = window.innerWidth, vh = window.innerHeight;
        var nx = ((e.clientX - editDrag.dx) / vw) * 100;
        var ny = ((e.clientY - editDrag.dy) / vh) * 100;
        // keep the disc fully on screen so it can never be dragged out of reach
        var half = (discPx(b) / 2);
        var minX = (half / vw) * 100, maxX = 100 - minX;
        var minY = (half / vh) * 100, maxY = 100 - minY;
        nx = Math.max(minX, Math.min(maxX, nx));
        ny = Math.max(minY, Math.min(maxY, ny));
        layoutOverride[b.id] = { x: +nx.toFixed(2), y: +ny.toFixed(2) };
        var el = byId[b.id];
        el.style.left = (vw * nx / 100) + 'px';
        el.style.top = (vh * ny / 100) + 'px';
        updateReadout();
      }
      if (e.cancelable) e.preventDefault();
      return;
    }

    if (id === stickId) { stickMove(e.clientX, e.clientY); return; }
    if (id === lookId) {
      var x = e.clientX, y = e.clientY;
      // With aim latched, the finger that switched it on only sets the reference point; it
      // does not steer, so the toggle tap itself never jerks the camera.
      if (lookActive && id === lookAnchorId) { lookLast.x = x; lookLast.y = y; return; }
      state.lookX += (x - lookLast.x) * LOOK_GAIN;
      state.lookY += (y - lookLast.y) * LOOK_GAIN;
      lookLast.x = x; lookLast.y = y;
      if (window.__cbSeam) window.__cbSeam('touchWrote', { id: id, lookX: +state.lookX.toFixed(1), lookY: +state.lookY.toFixed(1) });
    }
  }

  function onUp(e) {
    var id = e.pointerId;
    if (downPointers[id]) { delete downPointers[id]; state.activePointers = Math.max(0, state.activePointers - 1); }

    if (editLongPress) { clearTimeout(editLongPress); editLongPress = null; }

    /* ---- edit mode: finish the drag and persist ---- */
    if (editMode && editDrag) {
      var el2 = byId[editDrag.id];
      if (el2) el2.classList.remove('is-editing');
      editDrag = null;
      saveLayout();
      return;
    }
    if (id === stickId) { stickEnd(); return; }
    if (id === lookId) {
      // By delivering move/up to the element that took the pointerdown, the browser
      // implicitly captures the touch. If the finger that OWNS the look drag lifts while
      // another is still down, hand the drag to that one instead of dropping the camera.
      lookId = null;
      if (lookActive && lookAnchorId === id) lookAnchorId = null;
      for (var pid in downPointers) {
        var pidEl = buttonOwner[pid];
        if (pidEl === 'look') continue;                 // the toggle never steers
        lookId = Number(pid);
        break;
      }
      if (lookId !== null) {
        if (lookActive) lookAnchorId = lookId;
        lookLast.x = e.clientX; lookLast.y = e.clientY;
      }
      return;
    }
    var btn = buttonOwner[id];
    if (btn) { applyButton(btn, false, 'up-p' + id); delete buttonOwner[id]; } else if (diagVisibility && Object.keys(heldButtons).length) { log('info', 'UP p' + id + ' had NO buttonOwner; held=' + JSON.stringify(Object.keys(heldButtons))); }
  }

  window.addEventListener('pointerdown', onDown, { passive: false });
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp, { passive: true });
  window.addEventListener('pointercancel', onUp, { passive: true });
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', function () { if (document.hidden) releaseAll(); });
  // A context menu on a long press would steal the touch and break the drag.
  window.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // ---------------------------------------------------------------------------
  // Automated multi-touch scenario (?mttest=1)
  //
  // `adb shell input tap` can only produce ONE pointer, so it cannot exercise multi-touch
  // at all. This drives the real event path with genuinely concurrent pointers by
  // dispatching PointerEvents that carry distinct pointerIds 鈥?the same shape Android's
  // WebView produces for real fingers. After every phase it dumps what the GAME received
  // through the bridge, so the result is an observation, not an assumption.
  //
  //   0. baseline                      鈥?nothing held
  //   1. left thumb only               鈥?movement must appear, nothing else
  //   2. left + right thumb            鈥?camera drag must be served WHILE movement persists
  //   3. left + right + third on FIRE  鈥?all three concurrent
  //   4. all released                  鈥?nothing may remain held (no stuck input)
  // ---------------------------------------------------------------------------

  function firePointer(type, id, x, y) {
    var el = forceTargetAt(x, y);
    var ev;
    try {
      ev = new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        pointerId: id, pointerType: 'touch', isPrimary: id === 1,
        clientX: x, clientY: y, button: 0,
        buttons: type === 'pointerup' ? 0 : 1
      });
    } catch (err) {
      // PointerEvent is unavailable: fall back to a MouseEvent carrying a pointerId
      ev = new MouseEvent(type.replace('pointer', 'mouse'), {
        bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0
      });
      try { Object.defineProperty(ev, 'pointerId', { value: id }); } catch (e2) { /* ignore */ }
    }
    (el || window).dispatchEvent(ev);
  }

  /** elementFromPoint, but never our own chrome 鈥?we want the game's surface. */
  function forceTargetAt(x, y) {
    var el = document.elementFromPoint(x, y);
    while (el && el.closest && el.closest('#cb-touch')) el = el.parentElement;
    return el || document.body;
  }

  function runMultiTouchScenario() {
    // The scenario must drive the real controls, so every coordinate is derived from the
    // live geometry (geom.cx/geom.cy) and the live element rects 鈥?never from a guess about
    // the layout. An earlier version used a hard-coded 0.06/0.87 of the viewport, which
    // landed outside the pad and silently sent the movement pointer into the camera path.
    layout();
    var LX = Math.round(geom.cx), LY = Math.round(geom.cy);
    var LF = Math.round(geom.cy - geom.R * 0.72);      // slide up = forward
    var RX = Math.round(window.innerWidth * 0.55), RY = Math.round(window.innerHeight * 0.50);
    var FIRE = byId['fire'].getBoundingClientRect();
    var FX = Math.round(FIRE.left + FIRE.width / 2), FY = Math.round(FIRE.top + FIRE.height / 2);
    var JUMP = byId['jump'].getBoundingClientRect();
    var JX = Math.round(JUMP.left + JUMP.width / 2), JY = Math.round(JUMP.top + JUMP.height / 2);

    var steps = [];
    var step = function (label, fn, waitMs) {
      steps.push({ label: label, fn: fn, wait: waitMs });
    };

    step('00-baseline', function () { window.__cbProbe.layoutDump('00-baseline'); window.__cbProbe.dump('00-baseline'); }, 120);

    step('01-left-thumb-down', function () {
      // Re-assert geometry right before driving input: the WebView can report a stale
      // innerWidth/innerHeight, and a stale origin silently mis-targets every pointer.
      layout();
      firePointer('pointerdown', 101, LX, LY);
      firePointer('pointermove', 101, LX, LF);        // slide forward
      window.__cbProbe.layoutDump('01-targets');
      window.__cbProbe.dump('01-move-only');
    }, 400);

    step('02-plus-right-thumb', function () {
      firePointer('pointerdown', 102, RX, RY);        // second finger, while 101 is down
      var i;
      for (i = 1; i <= 5; i++) firePointer('pointermove', 102, RX + i * 22, RY - i * 5);
      window.__cbProbe.dump('02-move+look');
    }, 400);

    step('03-plus-fire', function () {
      firePointer('pointerdown', 103, FX, FY);        // third finger on FIRE
      var i;
      for (i = 1; i <= 4; i++) {
        firePointer('pointermove', 101, LX, LF - i * 6);   // keep moving
        firePointer('pointermove', 102, RX + 110 + i * 22, RY - 25 - i * 5); // keep looking
      }
      window.__cbProbe.dump('03-move+look+fire');
    }, 600);

    step('04-plus-jump', function () {
      firePointer('pointerdown', 104, JX, JY);        // fourth finger: JUMP
      window.__cbProbe.dump('04-move+look+fire+jump');
    }, 400);

    step('05-release-fire-jump-first', function () {
      // Real multi-touch lifts the newest fingers first, exactly like this.
      firePointer('pointerup', 104, JX, JY);
      firePointer('pointerup', 103, FX, FY);
      window.__cbProbe.dump('05-after-release-3-4');
    }, 300);

    step('06-release-look', function () {
      firePointer('pointerup', 102, RX + 110, RY - 25);
      window.__cbProbe.dump('06-after-release-look');
    }, 300);

    step('07-release-all', function () {
      firePointer('pointerup', 101, LX, LF);
      window.__cbProbe.dump('07-after-release-all');
    }, 500);

    step('08-final-settle', function () {
      window.__cbProbe.dump('08-final');
      log('info', 'MTTEST complete');
    }, 200);

    var i = 0;
    (function next() {
      if (i >= steps.length) return;
      var s = steps[i++];
      try { s.fn(); } catch (err) { log('error', 'MTTEST step ' + s.label + ' threw: ' + err); }
      setTimeout(next, s.wait);
    })();
  }

  // ---------------------------------------------------------------------------
  // Visibility
  //
  // The touch controls belong to gameplay only. In the menus the original UI is
  // pointer-driven, and an always-on overlay both obscures it and swallows taps, so the
  // cluster is hidden whenever the front end is up. State is read from the game's own
  // fields, never guessed: G.mode ('menu' | 'match'), match.paused, match.attract, and
  // the menu stack that menus.js maintains.
  // ---------------------------------------------------------------------------

  var shown = null;

  /**
   * Set by the automated multi-touch scenario so the overlay is live while it drives input.
   *
   * DECLARED HERE, ABOVE EVERY USE, ON PURPOSE. The ?mttest block further down assigns this
   * before the declaration would otherwise run. Because `var` hoists the binding but not the
   * initialiser, that assignment created a *global* of the same name, and the later
   * `var forceVisible = false` then initialised the *local* and shadowed it — so reads
   * returned true briefly and false forever after, within a single instance and with no page
   * reload. Same failure shape as the `geom` bug (BUG-003): keep state declarations above the
   * code that touches them.
   */
  var forceVisible = false;

  function matchWantsTouch() {
    try {
      if (forceVisible) return true;
      var G = cbCtx();
      if (!G || G.mode !== 'match') return false;
      var m = G.match;
      if (!m || m.attract) return false;
      // The pause menu keeps the cluster up so the player can resume by touch. It is the
      // only front-end screen that should.
      var stack = (G.game && G.game.menus && G.game.menus._stack) || [];
      if (stack.length && stack[0] === 'pause') return true;
      if (stack.length) return false;
      // Only a LIVE round gets controls.
      //
      // This used to be `G.mode === 'match'`, which is true for the whole session — so the
      // buttons sat on screen through the READY?/GO! countdown and stayed up over the
      // results. match.state is the honest signal: 'intro' -> 'playing' -> 'finish' ->
      // 'judge', and the game itself only accepts control once it reaches 'playing'
      // (match.js:193, and Match.updateController gates on the same state).
      if (m.state !== 'playing') return false;
      // Paused freezes the round but leaves state as 'playing' (main.js:885), so check it
      // explicitly or the cluster would linger over a frozen match.
      if (m.paused) return false;
      return true;
    } catch (err) {
      return false;
    }
  }

  function applyVisibility() {
    var want = matchWantsTouch();
    if (want === shown) return;
    shown = want;
    root.style.display = want ? '' : 'none';
    if (diagVisibility) {
      log('info', 'VIS ' + (want ? 'shown' : 'hidden') + ' ' + JSON.stringify(gateState()));
    }
    // Nothing may stay held across the transition.
    if (!want) releaseAll();
  }

  /** The exact inputs the visibility gate reads 鈥?reported so a false gate is diagnosable. */
  function gateState() {
    var G = cbCtx();
    var menus = G && G.game && G.game.menus;
    return {
      hasG: hasCtx(),
      mode: (G && G.mode) || null,
      hasMatch: !!(G && G.match),
      attract: (G && G.match) ? !!G.match.attract : null,
      stack: (menus && menus._stack) || null,
      forceVisible: forceVisible,
      instance: INSTANCE,
      liveInstances: (window.__cbTouchInstance || 0),
      bootErr: (function () {
        var e = document.getElementById('boot-error');
        var t = e ? (e.textContent || '').trim() : '';
        return t ? t.slice(0, 200) : null;
      })()
    };
  }
  /** Enabled by ?mttest=1 so normal play stays silent. */
  var diagVisibility = false;

  // menu.js also exposes `body > .iw-ui.is-ingame` while paused; not needed for the check
  // above, which reads the live stack directly.

  (function visibilityLoop() {
    applyVisibility();
    setTimeout(visibilityLoop, 150);
  })();

  // ---------------------------------------------------------------------------
  // Diagnostics
  //
  // Exposed so an automated test can assert what the GAME actually received, not what the
  // page claimed to send. Two views are reported:
  //   touchState()  鈥?what the touch layer holds
  //   gameState()   鈥?what the game's own Input/Actor/PlayerController now contain, which is
  //                   the only thing that proves the layer is correctly wired through the
  //                   patched seams (input.js pollTouch, player.js intent).
  // ---------------------------------------------------------------------------

  window.__cbProbe = {
    touchState: function () {
      var held = [];
      for (var k in heldButtons) held.push(k);
      var pids = [];
      for (var p in downPointers) pids.push(Number(p));
      return {
        moveX: +state.moveX.toFixed(3),
        moveY: +state.moveY.toFixed(3),
        lookX: +state.lookX.toFixed(1),
        lookY: +state.lookY.toFixed(1),
        buttons: held.sort(),
        // head-count proof for the multi-touch claim
        activePointers: state.activePointers,
        maxPointers: state.maxPointers,
        pointerIds: pids.sort(function (a, b) { return a - b; }),
        stickOwner: stickId,
        lookOwner: lookId,
        lookActive: lookActive,
        lookAnchor: lookAnchorId,
        fire: !!state.fire,
        jump: !!state.jump,
        squid: !!state.squid,
        sub: !!state.sub,
        special: !!state.special,
        active: !!state.active
      };
    },
    gameState: function () {
      try {
        var G = cbCtx();
        if (!G) return { error: 'no G' };
        var inp = G.input;
        var a = G.match && G.match.local;
        var rig = G.rig;
        var it = a && a.intent;
        return {
          mode: G.mode,
          // input.js side
          keysHeld: inp ? Array.from(inp.keys).filter(function (c) { return c !== 'Tab'; }).sort() : null,
          mouse: inp ? {
            dx: +inp.mouse.dx.toFixed(2), dy: +inp.mouse.dy.toFixed(2),
            left: !!inp.mouse.left, right: !!inp.mouse.right
          } : null,
          padSynthetic: !!(inp && inp.pad && inp.pad._synthetic),
          lastDevice: inp ? inp.lastDevice : null,
          locked: inp ? !!inp.locked : null,
          // player.js side
          rigYaw: rig ? +rig.yaw.toFixed(4) : null,
          rigPitch: rig ? +rig.pitch.toFixed(4) : null,
          aimYaw: a ? +a.aimYaw.toFixed(4) : null,
          aimPitch: a ? +a.aimPitch.toFixed(4) : null,
          // actor side
          intent: it ? {
            move: [+it.move.x.toFixed(3), +it.move.y.toFixed(3), +it.move.z.toFixed(3)],
            jump: !!it.jump, squid: !!it.squid, fire: !!it.fire, sub: !!it.sub, special: !!it.special
          } : null,
          alive: a ? !!a.alive : null,
          pos: a ? [+a.pos.x.toFixed(2), +a.pos.y.toFixed(2), +a.pos.z.toFixed(2)] : null,
          vel: a ? [+a.vel.x.toFixed(2), +a.vel.y.toFixed(2), +a.vel.z.toFixed(2)] : null,
          form: a && a.anim ? a.anim.form : (a ? a.form : null),
          hp: a ? a.hp : null,
          ink: a ? +(+a.ink).toFixed(1) : null,
          matchState: G.match ? G.match.state : null
        };
      } catch (err) {
        return { error: String(err && err.message) };
      }
    },
    /** Reports both views to logcat through the Android bridge. */
    dump: function (tag) {
      var payload = { tag: tag || '', touch: window.__cbProbe.touchState(), game: window.__cbProbe.gameState() };
      var text = 'PROBE ' + JSON.stringify(payload);
      try { window.ColorBrawl && window.ColorBrawl.log('info', text); } catch (e) { /* ignore */ }
      return text;
    },
    /**
     * Reports what hit-testing actually returns at the coordinates the scenario drives.
     * Without this, a mis-targeted pointer is indistinguishable from a broken handler.
     */
    layoutDump: function (tag) {
      var vw = window.innerWidth, vh = window.innerHeight;
      var probe = function (x, y) {
        var el = document.elementFromPoint(x, y);
        var chain = [];
        var n = el;
        while (n && chain.length < 4) { chain.push(n.id || n.className || n.tagName); n = n.parentElement; }
        return { at: [Math.round(x), Math.round(y)], id: el ? (el.id || null) : null, chain: chain };
      };
      var sp = stickPad.getBoundingClientRect();
      var out = {
        tag: tag || '',
        vw: vw, vh: vh,
        rootDisplay: root.style.display || '(unset)',
        rootInDom: !!(root.parentElement),
        rootParent: root.parentElement ? (root.parentElement.tagName) : null,
        stickPadRect: [Math.round(sp.left), Math.round(sp.top), Math.round(sp.width), Math.round(sp.height)],
        geom: { cx: Math.round(geom.cx), cy: Math.round(geom.cy), R: Math.round(geom.R) },
        hitStickCentre: probe(geom.cx, geom.cy),
        hitScenarioStick: probe(Math.round(vw * 0.06), Math.round(vh * 0.87)),
        hitFire: (function () { var r = byId['fire'].getBoundingClientRect(); return probe(r.left + r.width / 2, r.top + r.height / 2); })(),
        hasG: hasCtx(),
        gMode: (cbCtx() && cbCtx().mode) || null,
        stack: (cbCtx() && cbCtx().game && cbCtx().game.menus && cbCtx().game.menus._stack) || null
      };
      var text = 'LAYOUT ' + JSON.stringify(out);
      try { window.ColorBrawl && window.ColorBrawl.log('info', text); } catch (e) { /* ignore */ }
      return text;
    }
  };

  // ---------------------------------------------------------------------------
  // Frame hand-off 鈥?called by the patched src/core/input.js at the end of each frame
  // ---------------------------------------------------------------------------

  window.__cbTouchEndFrame = function () {
    // NOTE: lookX/lookY are deliberately NOT cleared here.
    //
    // They are consumed by src/game/player.js at the point of use, in the same frame the drag
    // happened. Clearing them on a frame boundary instead meant the value could be wiped
    // between the write and the read, which silently dropped every camera drag: the
    // accumulator held 102 while the controller saw 0 on every frame. Only the edge-triggered
    // flags are cleared here.
    state.pause = false;
    state.cheer = false;
  };

  // ---------------------------------------------------------------------------
  // Host lifecycle + back handling (invoked from MainActivity)
  // ---------------------------------------------------------------------------

  window.__colorbrawl = window.__colorbrawl || {};

  /** Opens/closes the layout editor. Wired to Settings > 'Custom button layout'. */
  window.__colorbrawl.openLayoutEditor = function () {
    setEditMode(!editMode);
    return editMode;
  };
  window.__colorbrawl.isEditingLayout = function () { return editMode; };

  window.__colorbrawl.onHostPause = function () {
    state.pausedByHost = true;
    releaseAll();
  };

  window.__colorbrawl.onHostResume = function () {
    state.pausedByHost = false;
    setTimeout(layout, 80);
  };

  window.__colorbrawl.onBackPressed = function () {
    var m = cbCtx() && cbCtx().game && cbCtx().game.menus;
    if (!m) return false;
    var stack = m._stack;
    // `_stack` holds plain screen-name STRINGS (menus.js: `this._stack = name ? [name] : []`),
    // not objects. Reading `.name` off one yielded undefined, so this always fell through to
    // "not consumed" and the Android back button exited the app instead of closing the screen.
    var top = stack && stack.length ? stack[stack.length - 1] : null;
    if (!top || top === 'title' || top === 'main') return false;
    try { m.show('main'); } catch (err) { /* ignore */ }
    return true;
  };

  // Tell Android whether the back press should be consumed. Cheap, and only on change.
  var lastReported = null;
  (function reportBack() {
    var consumed = false;
    try {
      var m = cbCtx() && cbCtx().game && cbCtx().game.menus;
      var stack = m && m._stack;
      var top = stack && stack.length ? stack[stack.length - 1] : null;
      consumed = !!top && top !== 'title' && top !== 'main';
    } catch (err) { consumed = false; }
    if (consumed !== lastReported) {
      lastReported = consumed;
      try { window.ColorBrawl && window.ColorBrawl.setBackConsumed(consumed); } catch (err) { /* ignore */ }
    }
    requestAnimationFrame(reportBack);
  })();

  // The game's own audio unlock listens for a real user gesture; the pointer events we
  // deliberately let through to the canvas already provide one.

  // ---------------------------------------------------------------------------
  // Automated multi-touch scenario (?mttest=1)
  //
  // Placed at the END of the module on purpose: it assigns module state (forceVisible,
  // diagVisibility), so every `var` above it must already have initialised. Declaring it
  // earlier let `var` hoisting shadow the assignment and the flag silently read false.
  // ---------------------------------------------------------------------------
  var params = new URLSearchParams(location.search);
  if (params.has('mttest')) {
    diagVisibility = true;
    // Force the overlay visible for the whole scenario. The gate depends on G.mode, and an
    // earlier run had the gate read false during boot, which sent every synthetic pointer into
    // the camera path instead of the joystick 鈥?an artefact of the harness, not of the layer.
    // Forcing it removes that confound so the test measures input handling, not boot timing.
    forceVisible = true;
    applyVisibility();
    log('info', 'MTTEST armed; overlay forced visible, waiting for G.mode === "match"');
    var MT_DEADLINE_MS = 240000;
    var mtWaited = 0;
    (function waitForMatch() {
      var G = cbCtx();
      var ready = !!(G && G.mode === 'match' && G.match && !G.match.attract);
      if (ready) {
        log('info', 'MTTEST starting on a live match after ' + Math.round(mtWaited / 1000) + 's');
        runMultiTouchScenario();
      } else if (mtWaited >= MT_DEADLINE_MS) {
        log('warn', 'MTTEST deadline hit; running anyway. gate=' + JSON.stringify(gateState()));
        runMultiTouchScenario();
      } else {
        if (mtWaited % 10000 === 0) log('info', 'MTTEST waiting ' + Math.round(mtWaited / 1000) + 's gate=' + JSON.stringify(gateState()));
        mtWaited += 1000;
        setTimeout(waitForMatch, 1000);
      }
    })();
  }
  log('info', 'touch layer ready instance=' + INSTANCE + ' (' + window.innerWidth + 'x' + window.innerHeight + ')');
})();

