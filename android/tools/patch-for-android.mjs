#!/usr/bin/env node
/*
 * Color Brawl — Android compatibility patch for the vendored INKWAVE source.
 * =============================================================================
 * The game under `app/src/main/assets/game/` is the original INKWAVE source plus a small,
 * surgical, idempotent set of edits. This script is the single source of truth for those
 * edits: running it against a fresh copy of the upstream repo reproduces the exact state
 * shipped in the APK.
 *
 *   node tools/patch-for-android.mjs            # apply
 *   node tools/patch-for-android.mjs --verify   # check only, exit 1 if unpatched
 *   node tools/patch-for-android.mjs --revert   # remove the patches
 *
 * The upstream files are a mix of LF (player.js) and CRLF (input.js) line endings, so all
 * matching is done on an LF-normalised copy and the original ending style is restored on
 * write. Every patch is detected by a stable signature, so re-running is safe and partial
 * application is impossible without a loud failure.
 *
 * WHAT IS PATCHED AND WHY
 * -----------------------
 * A1  src/core/input.js — add `pollTouch()`, a third input source beside keyboard/mouse and
 *     gamepad. Android WebView has no Pointer Lock, so `mousemove`/`mousedown` early-return
 *     (input.js:45,50) and the game would be completely unplayable without this.
 * A2  src/core/input.js — announce the touch joystick as a gamepad-shaped device so the
 *     original analog look path, aim assist and `_padMenus()` navigation keep working.
 * A3  src/core/input.js — make `requestLock()` a no-op when the Pointer Lock API is absent.
 * A4  src/core/input.js — poll the touch layer at the end of each frame.
 * B1  src/game/player.js — read the synthetic touch gamepad (analog MOVE + LOOK) on the same
 *     lines that already read a real gamepad, using the same response curve.
 * B2  src/game/player.js — let the analog stick reach a genuine full-speed run (the existing
 *     clamp assumed a stick and a keyboard can only sum to 1.0).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const GAME = join(here, '..', 'app', 'src', 'main', 'assets', 'game');
const MARK = '/* COLORBRAWL-ANDROID */';

/** @type {{id:string,file:string,sig:string,find:string,replace:string}[]} */
const patches = [
  // ---------------------------------------------------------------- input.js
  {
    id: 'A1',
    file: 'src/core/input.js',
    sig: 'pollTouch()',
    find: `  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];`,
    replace: `  ${MARK}
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
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];`
  },
  {
    id: 'A2',
    file: 'src/core/input.js',
    sig: '__cbTouchPad && window.__cbTouch',
    find: `    if (!pad) for (const p of pads) if (p && p.connected) { pad = p; break; }
    this.pad = pad;`,
    replace: `    if (!pad) for (const p of pads) if (p && p.connected) { pad = p; break; }
    // Color Brawl: expose the touch joystick as a gamepad-shaped device so the original
    // analog look path, aim assist and menu navigation work unchanged.
    if (!pad && window.__cbTouchPad && window.__cbTouch && window.__cbTouch.active) {
      pad = window.__cbTouchPad;
      if (window.__cbTouch.moveX || window.__cbTouch.moveY || window.__cbTouch.lookX || window.__cbTouch.lookY) this.lastDevice = 'touch';
    }
    this.pad = pad;`
  },
  {
    id: 'A3',
    file: 'src/core/input.js',
    sig: 'if (!this.canvas.requestPointerLock) return;',
    find: `  requestLock() {
    if (this.locked) return;`,
    replace: `  requestLock() {
    // Color Brawl: Android WebView has no Pointer Lock API. The touch layer replaces the
    // mouse entirely, so requesting a lock is meaningless — and must not throw.
    if (!this.canvas.requestPointerLock) return;
    if (this.locked) return;`
  },
  {
    id: 'A4',
    file: 'src/core/input.js',
    sig: 'if (this.pollTouch) this.pollTouch();',
    find: `  endFrame() {
    this.pressed.clear();`,
    replace: `  endFrame() {
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
    this.pressed.clear();`
  },
  {
    id: 'A5',
    file: 'src/core/input.js',
    sig: '_touchKeys = new Set();',
    // Tracks which key codes the touch layer is holding, so they can be released as a group
    // when touch input stops. Declared at construction, before pollTouch can run.
    find: `    this.lastDevice = 'kbm';
    this.onKey = null;`,
    replace: `    this.lastDevice = 'kbm';
    // Which key codes the touch layer currently holds down. Needed so they can be released
    // as a group when touch input stops (app backgrounded, overlay hidden), and so a
    // synthesized key is never confused with a real keyboard press of the same code.
    this._touchKeys = new Set();
    this.onKey = null;`
  },

  // --------------------------------------------------------------- player.js
  {
    id: 'B1a',
    file: 'src/game/player.js',
    sig: 'const touchCtl =',
    find: `    const usingPad = !!inp.pad && inp.lastDevice === 'pad';`,
    replace: `    ${MARK}
    // Color Brawl: on touch the analog MOVE stick drives the walk speed. The stick is
    // stretched to full deflection so a full-slider push is a genuine full-speed run.
    const touchCtl = (window.__cbTouch && window.__cbTouch.active) ? window.__cbTouch : null;
    const usingPad = !!inp.pad && (inp.lastDevice === 'pad' || inp.lastDevice === 'touch');`
  },
  {
    id: 'B1b',
    file: 'src/game/player.js',
    sig: "|| !!touchCtl?.map;",
    find: `    const mapUp = (G.rig?.mapK ?? 0) > 0.05 || inp.down('Tab') || inp.down('KeyM') || inp.padButton(8);`,
    replace: `    const mapUp = (G.rig?.mapK ?? 0) > 0.05 || inp.down('Tab') || inp.down('KeyM') || inp.padButton(8) || !!touchCtl?.map;`
  },
  {
    id: 'B1c',
    file: 'src/game/player.js',
    sig: 'if (touchNorm !== 1)',
    find: `    if (inp.pad) { inp.padStick(0, 1, _stick, 0.14, 0.95); mx += _stick.x; mz -= _stick.y; }
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }`,
    replace: `    if (inp.pad) { inp.padStick(0, 1, _stick, 0.14, 0.95); mx += _stick.x; mz -= _stick.y; }
    const ml = Math.hypot(mx, mz);
    // Color Brawl: direction is preserved and the walk-speed clamp in actor.js decides the
    // magnitude. Touch alone is scaled to ANDROID_MOVE_MAX so full deflection = full speed.
    if (ml > 1) {
      mx /= ml; mz /= ml;
      touchNorm = (touchCtl && ml <= ANDROID_MOVE_MAX + 1e-3) ? ANDROID_MOVE_MAX : 1;
    }
    if (touchNorm !== 1) { mx *= touchNorm; mz *= touchNorm; }`
  },
  {
    id: 'B2a',
    file: 'src/game/player.js',
    sig: '&& !inp.pad._synthetic) {',
    // The touch layer feeds the camera through inp.mouse (raw dx/dy, exactly the pointer-lock
    // path), so the gamepad-axis look block must not also run for the synthetic device. It is
    // SKIPPED rather than early-returned: a return here would leave a.aimYaw/a.aimPitch stale,
    // and those drive aimDir, weapon ballistics, subs, specials and the character animation.
    find: `    if (inp.pad && !mapUp) {
      inp.padStick(2, 3, _stick, 0.11, 0.96);`,
    replace: `    if (inp.pad && !mapUp && !inp.pad._synthetic) {
      inp.padStick(2, 3, _stick, 0.11, 0.96);`
  },
  {
    id: 'B2b',
    file: 'src/game/player.js',
    sig: 'let touchNorm = 1;',
    find: `    // ---- move (camera relative)
    let mx = 0, mz = 0;`,
    replace: `    // ---- move (camera relative)
    let mx = 0, mz = 0;
    let touchNorm = 1;`
  },
  {
    id: 'B2c',
    file: 'src/game/player.js',
    sig: 'const ANDROID_MOVE_MAX',
    find: `const _stick = { x: 0, y: 0, mag: 0 };`,
    replace: `const _stick = { x: 0, y: 0, mag: 0 };
// Color Brawl: a touch slider pushed to its rim is full deflection, so the stick is
// stretched to this magnitude before actor.js clamps it to the walk speed.
const ANDROID_MOVE_MAX = 1.25;`
  },

  // ----------------------------------------------------- branding (product name)
  {
    id: 'C1',
    file: 'src/config.js',
    sig: "export const GAME_TITLE = 'Color Brawl';",
    // The wordmark is data-driven: ui-icons.js logoMarkup(title) splits this string into one
    // <span> per character, so changing this single constant rebrands the title screen, the
    // main-menu logo, the credits logo and the corner caption together.
    find: `export const GAME_TITLE = 'INKWAVE';`,
    replace: `export const GAME_TITLE = 'Color Brawl';`
  },

  // ------------------------------------------------- Android default quality
  {
    id: 'C2',
    file: 'src/config.js',
    sig: 'ANDROID_DEFAULT_QUALITY',
    // Upstream ships quality:'high' (4096 paint atlas, 4096 shadows, MSAA x4, GTAO, bloom).
    // On Android that is far too heavy: measured on the emulator the median frame was ~61 ms
    // against a 4 ms GPU time, i.e. the game is bound long before the GPU is.
    //
    // This adds an Android-only migration that runs on FIRST LAUNCH only. It never overrides
    // a setting the player has changed: the stored settings object is inspected, and the
    // default is rewritten only when quality is still exactly the shipped 'high'. All four
    // presets remain available in Settings > quality.
    find: `export const QUALITY = {`,
    replace: `// Color Brawl: the preset a fresh Android install starts on. Overridable in Settings.
export const ANDROID_DEFAULT_QUALITY = 'medium';
// One-shot migration applied in main.js boot when no settings have been saved yet, or when
// the saved quality is still the untouched upstream default.
export function androidQualityMigration(settings) {
  if (!settings) return settings;
  // "ultra" is retired from the Android UI (only SD/HD/UHD are offered). A device that has it
  // stored is folded UP into "high" and kept there. The __qualityMigrated flag is set so the
  // next step cannot treat this as an untouched default and demote it — that was a real bug:
  // ultra -> high, then high -> ANDROID_DEFAULT_QUALITY, i.e. down two tiers.
  if (settings.quality === 'ultra') {
    settings.quality = 'high';
    settings.__qualityMigrated = true;
    return settings;
  }
  // A device still on the untouched shipped default gets the mobile default exactly once.
  // __qualityMigrated is written by this function, so its presence means a previous build
  // already applied the default and any "high" now is a deliberate later choice.
  if (settings.quality === 'high' && !settings.__qualityMigrated) {
    settings.quality = ANDROID_DEFAULT_QUALITY;
  }
  settings.__qualityMigrated = true;
  return settings;
}

export const QUALITY = {`
  },
  {
    id: 'C3',
    file: 'src/main.js',
    sig: 'androidQualityMigration',
    // Apply the migration right after settings are loaded and before the renderer is built.
    find: `    this.settings = G.settings = loadJSON('inkwave.settings', DEFAULT_SETTINGS);`,
    replace: `    this.settings = G.settings = loadJSON('inkwave.settings', DEFAULT_SETTINGS);
    // Color Brawl: first-run Android quality migration (see config.js). Runs before the
    // renderer is constructed, so the preset is in effect for the very first frame.
    androidQualityMigration(this.settings);`
  },
  {
    id: 'C4',
    file: 'src/main.js',
    sig: 'ANDROID_DEFAULT_QUALITY, androidQualityMigration',
    find: `  MAPS, DIFFICULTY, PLAYER, PROGRESSION, VERSION, MATCH, OFFLINE_MAPS, mapOfflineOk, mapNoBots, mapBossOk,
} from './config.js';`,
    replace: `  MAPS, DIFFICULTY, PLAYER, PROGRESSION, VERSION, MATCH, OFFLINE_MAPS, mapOfflineOk, mapNoBots, mapBossOk,
  ANDROID_DEFAULT_QUALITY, androidQualityMigration,
} from './config.js';`
  },

  // ------------------------------------------- page-world diagnostics (test only)
  {
    id: 'C5',
    file: 'src/main.js',
    sig: "android/page-observer.js",
    // Static import, so the observer is part of the PAGE's module graph and therefore runs in
    // the page's own JavaScript world. That is the whole point: an earlier probe injected with
    // WebView.evaluateJavascript could not see window.G even while a match ran to completion,
    // which left it unclear whether the game had really booted. A page-world observer settles
    // it by construction rather than by inference.
    //
    // It is inert in production: the file returns immediately unless ?mttest=1 is present.
    // Imported first so it is evaluated before main.js's own body runs.
    find: `import * as THREE from 'three';`,
    replace: `// Color Brawl: page-world test observer. No-op unless ?mttest=1 (see the file's header).
// Path is relative to this file (src/), so ../android/ — not ./android/.
import '../android/page-observer.js';
import * as THREE from 'three';`
  },
  {
    id: 'C8',
    file: 'src/game/player.js',
    sig: 'let cbLookX = 0, cbLookY = 0;',
    // Take the accumulated camera-drag delta directly from the touch layer and clear it.
    //
    // The Input.mouse.dx hand-off was measured not to deliver this value (accumulator 102,
    // input.js read 0 every frame, its look branch never ran, mdx 0 on all 568 playing
    // samples, rig.yaw never moved). player.js consumes it where it is needed instead.
    find: `    const touchCtl = (window.__cbTouch && window.__cbTouch.active) ? window.__cbTouch : null;`,
    replace: `    const touchCtl = (window.__cbTouch && window.__cbTouch.active) ? window.__cbTouch : null;
    /* COLORBRAWL-ANDROID */
    // Consume the touch camera-drag here. Reading it at the point of use means the value cannot
    // be cleared by a frame boundary before it is applied — which is what silently dropped it
    // when the hand-off went through Input.mouse.dx.
    let cbLookX = 0, cbLookY = 0;
    if (touchCtl) {
      cbLookX = touchCtl.lookX || 0;
      cbLookY = touchCtl.lookY || 0;
      touchCtl.lookX = 0; touchCtl.lookY = 0;
    }`
  },
  {
    id: 'C9',
    file: 'src/game/player.js',
    // Signature must be unique to THIS edit: it previously shared 'cbLookX' with C8, so once
    // C8 was applied the verifier considered C9 applied too while its edit had never landed.
    sig: 'inp.mouse.dx + cbLookX',
    // Fold the delta into the same locals the mouse path uses, right before the look block.
    // The anchor is the line as C7 leaves it (C7 must run first — it changes const to let and
    // adds the updateTop trace), which is why this matched nothing before.
    find: `    const mdx = inp.mouse.dx, mdy = inp.mouse.dy;`,
    replace: `    const mdx = inp.mouse.dx + cbLookX, mdy = inp.mouse.dy + cbLookY;`
  },
  {
    id: 'D1',
    file: 'src/ui/ui-icons.js',
    sig: 'COLORBRAWL_NO_PC_HINTS',
    // Android has no keyboard and no mouse, so every keycap and mouse glyph is noise on a touch
    // device. Both renderers are neutralised here rather than at ~20 call sites, which also
    // covers richText's "[SHIFT]" / "[LMB]" expansion since it delegates to them.
    find: `export function keycap(k) {
  const s = String(k);
  const wide = s.length > 2 ? ' iw-key--wide' : '';
  return \`<kbd class="iw-key\${wide}">\${esc(s === ' ' ? 'SPACE' : s)}</kbd>\`;
}`,
    replace: `/* COLORBRAWL_NO_PC_HINTS */
// Android: no keyboard, no mouse. Keycaps are suppressed, so captions that read "TAB MAP" or
// "READY! F" become just "MAP" and "READY!". Returning '' (not an empty <kbd>) lets the parent
// collapse, and styles/ui.css also hides the wrappers this leaves behind.
export function keycap(k) {
  return '';
}`
  },
  {
    id: 'D2',
    file: 'src/ui/ui-icons.js',
    sig: 'COLORBRAWL_NO_MOUSE_GLYPH',
    // Same reasoning: the mouse drawing is a desktop affordance with no touch equivalent.
    find: `export function mouseGlyph(which = 'L') {`,
    replace: `/* COLORBRAWL_NO_MOUSE_GLYPH */
export function mouseGlyph(which = 'L') {
  return '';
}
function mouseGlyphSuppressed(which = 'L') {`
  },
  {
    id: 'D3',
    file: 'styles/ui.css',
    sig: 'COLORBRAWL-NO-PC-HINTS',
    // With the glyphs suppressed, their wrappers and the separators that sat between two
    // keycaps would remain as gaps — a stray "or" or "/" with nothing either side.
    find: `.iw-hint .iw-kbm, .iw-hint .iw-padg { display: inline-flex; align-items: center; }`,
    replace: `/* COLORBRAWL-NO-PC-HINTS — Android: hide every keyboard/mouse affordance rather than
   switching between them, and collapse the empty wrappers so no blank gaps remain. */
.iw-kbm, .iw-mouse, .iw-key { display: none !important; }
.iw-lob__emotekeys, .iw-code__arr { display: none !important; }
.iw-hint .iw-kbm, .iw-hint .iw-padg { display: inline-flex; align-items: center; }
.iw-hint em { display: none !important; }
.iw-hint:empty, .iw-prompts:empty { display: none !important; }`
  },
  {
    id: 'D4',
    file: 'src/ui/menus.js',
    sig: 'TAP TO START',
    // The title screen is the first thing a player sees and it advertised a keyboard and a
    // cursor. Both branches are replaced with a touch instruction, and the onInputMode handler
    // keeps writing the same text so a controller being plugged in cannot reintroduce "PRESS
    // ANY KEY".
    find: `      h('span', { class: 'iw-title__presstext' }, this._input === 'pad' ? 'PRESS ANY BUTTON' : 'PRESS ANY KEY'),
      h('span', { class: 'iw-title__presssub' }, this._input === 'pad' ? '' : 'or click to start'));`,
    replace: `      h('span', { class: 'iw-title__presstext' }, 'TAP TO START'),
      h('span', { class: 'iw-title__presssub' }, ''));`
  },
  {
    id: 'D5',
    file: 'src/ui/menus.js',
    sig: "'TAP TO START';",
    // Same screen, the handler that used to rewrite the text per input device.
    find: `        press.firstChild.textContent = m === 'pad' ? 'PRESS ANY BUTTON' : 'PRESS ANY KEY';
        press.lastChild.textContent = m === 'pad' ? '' : 'or click to start';`,
    replace: `        press.firstChild.textContent = 'TAP TO START';
        press.lastChild.textContent = '';`
  },
  {
    id: 'D6',
    file: 'styles/ui.css',
    sig: 'COLORBRAWL-NO-PC-SETTINGS',
    // Hide the two mouse-only settings rows on Android.
    //
    // Each row is a direct child of .iw-rows (menus.js:2108/2114), so :nth-child targets
    // them. The order comes from SETTINGS_TABS.controls.rows (menus.js:171-178):
    //   1 sensitivity (mouse-only), 2 padSensitivity, 3 invertY, 4 aimAssist,
    //   5 aimAssistMouse (mouse-only), 6 _howto
    // This is POSITIONAL and will need revisiting if upstream reorders that list. A
    // data-key selector would be better, but rows carry no such attribute — they are
    // keyed by the row._key JS property (menus.js:2111).
    find: `.iw-rows { min-height: calc(var(--u) * 14); }`,
    replace: `.iw-rows { min-height: calc(var(--u) * 14); }
/* COLORBRAWL-NO-PC-SETTINGS — Android: the two mouse-only settings rows are hidden.
   Positional, matching SETTINGS_TABS.controls.rows order in src/ui/menus.js. */
.iw-rows > .iw-row:nth-child(1),
.iw-rows > .iw-row:nth-child(5) { display: none !important; }`
  },
  {
    id: 'E1',
    file: 'styles/ui.css',
    sig: 'COLORBRAWL-NO-PROMPT-HINTS',
    // The bottom-right input-hint row ("Skip · Select", "Adjust", "Tabs", "Back",
    // "Move", "Wear", ...) lists keys the player does not have on a touch device,
    // and touching the controls is self-explanatory. The whole row goes.
    //
    // Hiding .iw-prompts and .iw-hint together also covers the per-widget hints that reuse
    // the same builders: the back button's, the tab strip's, the ready button's, the room
    // code copy chip, and the loadout shuffle key.
    find: `.iw-prompts {
  position: absolute; right: calc(var(--u) * 2.6); bottom: calc(var(--u) * 1.9);`,
    replace: `/* COLORBRAWL-NO-PROMPT-HINTS — Android: no keyboard rows.
   Covers the bottom-right prompt row and every per-widget hint built by menus.js _hint(). */
.iw-prompts, .iw-hint, .iw-tabs__hint, .iw-lbtn__key, .iw-btn__key { display: none !important; }
.iw-prompts {
  position: absolute; right: calc(var(--u) * 2.6); bottom: calc(var(--u) * 1.9);`
  },
  {
    id: 'E2',
    file: 'styles/ui.css',
    sig: 'COLORBRAWL-NO-MENU-BLURB',
    // The bottom-left blurb ("Turf War or Zone Control 4 v 4 - or team up with the bots
    // against HULLBREAKER ..."). It is position:absolute and only FADED when nothing is
    // focused (ui.css:766), which is why it stayed faintly readable instead of vanishing.
    find: `.iw-main__desc { position: absolute; left: calc(var(--u) * 4.3); top: calc(52% + var(--u) * 16.9); display: flex; align-items`,
    replace: `/* COLORBRAWL-NO-MENU-BLURB — Android: the per-item description blurb is removed. */
.iw-main__desc { display: none !important; }
.iw-main__desc-superseded { position: absolute; left: calc(var(--u) * 4.3); top: calc(52% + var(--u) * 16.9); display: flex; align-items`
  },
  {
    id: 'E3',
    file: 'styles/ui.css',
    sig: 'COLORBRAWL-NEXT-RANK-FIT',
    // Keep the NEXT RANK badge inside the profile panel. The panel is a two-column grid
    // (ui.css:326) and every other full-width child sets grid-column: 1 / -1; this one did
    // not, so it was laid into a single narrow column and overflowed the panel.
    find: `.iw-profile__stats div { flex: 1; display: flex; align-items: baseline; gap: .45em; padding: calc(var(--u) * .55) c`,
    replace: `/* COLORBRAWL-NEXT-RANK-FIT — span the badge across the panel and let it wrap rather
   than push past the panel padding. */
.iw-profile__next { grid-column: 1 / -1; min-width: 0; flex-wrap: wrap; }
.iw-profile__next b, .iw-profile__next span { white-space: nowrap; }
.iw-profile__stats div { flex: 1; display: flex; align-items: baseline; gap: .45em; padding: calc(var(--u) * .55) c`
  },
  {
    id: 'E4',
    file: 'src/ui/menus.js',
    sig: 'Custom button layout',
    // A Settings row that opens the touch-control layout editor. The editor itself lives in
    // android/touch.js, which owns the controls; this only adds the entry point, reusing
    // the existing link-row machinery so the settings schema is untouched.
    find: `    { key: '_howto', label: 'Controls reference', type: 'link', help: 'Every keyboard, mouse and controller binding in one place.' },`,
    replace: `    { key: '_howto', label: 'Controls reference', type: 'link', help: 'Every keyboard, mouse and controller binding in one place.' },
    { key: '_layout', label: 'Custom button layout', type: 'link', help: 'Drag the on-screen buttons to where your thumbs want them.' },`
  },
  {
    id: 'E5',
    file: 'src/ui/menus.js',
    sig: 'openLayoutEditor',
    // Dispatch the new row. Every link row funnels through one builder that hard-codes
    // `_go('howto')` (menus.js:2099), so 'Custom button layout' needs its own branch or it
    // would open the controls reference instead. The editor lives in android/touch.js, which
    // owns the controls; this only calls into it, and does nothing if the hook is absent.
    find: `        if (r.type === 'link') ctrl = { el: h('span', { class: 'iw-row__link' }, 'VIEW', h('i', { html: GLYPHS.next })), accept: () => { this._sfx('ui_click'); this._go('howto'); } };`,
    replace: `        if (r.type === 'link' && r.key === '_layout') {
          // Color Brawl: opens the on-screen button layout editor (android/touch.js).
          ctrl = {
            el: h('span', { class: 'iw-row__link' }, 'EDIT', h('i', { html: GLYPHS.next })),
            accept: () => {
              this._sfx('ui_click');
              const api = window.__colorbrawl;
              if (api && api.openLayoutEditor) { this.show('main'); api.openLayoutEditor(); }
            },
          };
        } else if (r.type === 'link') ctrl = { el: h('span', { class: 'iw-row__link' }, 'VIEW', h('i', { html: GLYPHS.next })), accept: () => { this._sfx('ui_click'); this._go('howto'); } };`
  },
  {
    id: 'E6',
    file: 'src/ui/menus.js',
    sig: "'[data-nav]')",
    // Enter the settings screen on the first *visible* row. querySelector('[data-nav]')
    // returns the first row in DOM order even when CSS hides it, so the help panel described
    // a control the player cannot see. The visibility filter matches the one the menus
    // already use for navigation (menus.js:652).
    find: `initial: () => rowsEl.querySelector('[data-nav]'),`,
    replace: `initial: () => [...rowsEl.querySelectorAll('[data-nav]')].find((e) => e.offsetParent !== null) || rowsEl.querySelector('[data-nav]'),`
  },
  {
    id: 'F1',
    file: 'src/ui/menus.js',
    sig: "options: [['low', 'SD'], ['medium', 'HD'], ['high', 'UHD']]",
    // Three graphics tiers instead of four. Labels stay short because they sit inside a
    // segmented control: SD / HD / UHD == 标清 / 高清 / 超清.
    find: `{ key: 'quality', label: 'Graphics quality', type: 'seg', options: [['low', 'Low'], ['medium', 'Med'], ['high', 'High'], ['ultra', 'Ultra']], help: 'R`,
    replace: `{ key: 'quality', label: 'Graphics quality', type: 'seg', options: [['low', 'SD'], ['medium', 'HD'], ['high', 'UHD']], help: 'R`
  },
  {
    id: 'F2',
    file: 'src/ui/menus.js',
    sig: "options: [[60, '60 Hz'], [120, '120 Hz']]",
    // Two frame-rate tiers. The limiter accepts any numeric cap (main.js:1052-1053 is
    // `ts - _lastTs < 1000 / cap - 2`), so 120 needs no engine change. The row previously
    // offered Max / 60 / 30; "Max" follows the display and is redundant once the player states
    // an explicit target.
    find: `{ key: 'fpsCap', label: 'Frame rate limit', type: 'seg', options: [[0, 'Max'], [60, '60'], [30, '30']], help: 'Max follows your display (up to 120 Hz `,
    replace: `{ key: 'fpsCap', label: 'Frame rate', type: 'seg', options: [[60, '60 Hz'], [120, '120 Hz']], help: 'Target refresh rate. 60 Hz is lighter on the battery and steadier on weaker devices; 120 Hz is smoother on panels that support it. `
  },
  {
    id: 'F3',
    file: 'src/config.js',
    sig: "settings.quality === 'ultra'",
    // 'ultra' is no longer selectable, so a device that has it stored must not keep reading a
    // preset the UI can neither show nor change. Folded into 'high' inside the existing Android
    // quality migration, which already runs before the renderer is constructed.
    find: `  if (settings.quality === 'high' && !settings.__qualityMigrated) {`,
    replace: `  if (settings.quality === 'ultra') settings.quality = 'high';
  if (settings.quality === 'high' && !settings.__qualityMigrated) {`
  },
  {
    id: 'F4',
    file: 'src/ui/menus.js',
    sig: "const mode = 'pad';   // Color Brawl",
    // HOW TO PLAY always shows the pad scheme. The touch layer presents itself to the game as a
    // gamepad, so that list is the accurate one, and the keyboard column is the TAB/ESC/SHIFT
    // reference this build removes. Leaving the scheme switchable would reintroduce it.
    find: `    let mode = this._input;`,
    replace: `    const mode = 'pad';   // Color Brawl: Android has no keyboard; see the touch layer.`
  },
  {
    id: 'G1',
    file: 'src/world/inkShading.js',
    sig: 'MOBILE_INK_RIPPLES',
    // The ink shader runs one loop over every ripple per INKED FRAGMENT:
    //     for (int i = 0; i < 24; i++) { ...length(D)... }
    // with dynamic indexing into two uniform vec4 arrays (uRip / uRipP). On a tile-based mobile
    // GPU that is the most expensive thing in the frame — a Redmi-class Mali/Immortalis part
    // charges a lot for 24 dynamic-indexed iterations, and the `continue` guards do not save it
    // because the loop still executes.
    //
    // 24 -> 12 on Android. Ripples are a cosmetic wake effect; 12 still reads as a spreading
    // wake while halving the loop. INK_RIPPLES is also the array length in inkUniforms(), so
    // both stay consistent automatically.
    find: `export const INK_RIPPLES = 24;`,
    replace: `// Color Brawl: fewer ripple iterations on mobile. This loop runs per INKED FRAGMENT with
// dynamic indexing into two uniform arrays, which is the single most expensive shader cost on a
// tile-based mobile GPU. 12 keeps the wake readable at half the loop.
const MOBILE_INK_RIPPLES = typeof navigator !== 'undefined' && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '');
export const INK_RIPPLES = MOBILE_INK_RIPPLES ? 12 : 24;`
  },
  {
    id: 'G2',
    file: 'src/config.js',
    sig: 'Color Brawl: Android mid tier',
    // The Android default is 'medium', and every splat is drawn as a quad into the atlas render
    // target — bloom and MSAA are then paid on top. These are the two cheapest large wins on a
    // phone panel, where the density cap (pixelRatio) is already binding and MSAA on a tiled GPU
    // forces a resolve of the whole framebuffer every frame.
    //
    //   msaa 2 -> 0        removes the per-frame resolve
    //   shadowSize 2048 -> 1024   quarters the shadow-map raster work
    //   paintAtlas 2048 -> 1024   halves the atlas edge, quartering ink-fill cost
    //
    // 'high' (UHD) is left alone so the top tier still looks like the top tier.
    find: `medium: { pixelRatio: 1.0,  shadowSize: 2048, msaa: 2, bloom: true,  ao: false, paintAtlas: 2048, particles: 0.7 },`,
    replace: `// Color Brawl: Android mid tier. MSAA off, smaller shadow map and paint atlas — see G2.
  medium: { pixelRatio: 1.0,  shadowSize: 1024, msaa: 0, bloom: true,  ao: false, paintAtlas: 1024, particles: 0.7 },`
  },
  {
    id: 'G3',
    file: 'src/config.js',
    sig: 'Color Brawl: Android low tier',
    // The low tier is the escape hatch for weak devices; drop the atlas here too so "SD" is a
    // real difference and not just a resolution cut.
    find: `low:    { pixelRatio: 0.75, shadowSize: 1024, msaa: 0, bloom: false, ao: false, paintAtlas: 2048, particles: 0.4 },`,
    replace: `// Color Brawl: Android low tier — smallest atlas, no shadows-heavy work.
  low:    { pixelRatio: 0.75, shadowSize: 512,  msaa: 0, bloom: false, ao: false, paintAtlas: 1024, particles: 0.4 },`
  },
  {
    id: 'G4',
    file: 'src/config.js',
    sig: 'Color Brawl: Android defaults to a 60 Hz target',
    // Default the frame-rate target to 60 Hz rather than "follow the display".
    //
    // main.js:1080 _frameTarget() returns the DISPLAY's refresh unless the user caps lower, and
    // _dynRes() shrinks the render scale whenever a 4 s window averages over ~112% of that. On a
    // 120 Hz phone the target was 8.3 ms, which a mid-range device will not hold — so the game
    // spent the whole match fighting its own dynamic-resolution loop and sat at the floor. 60 Hz
    // is a target the hardware can actually meet, and the player can pick 120 Hz in Settings.
    find: `fpsCap: 0,                // frame rate limit: 0 = match the display (120 on ProMotion Macs), else 60 / 30`,
    replace: `fpsCap: 60,               // Color Brawl: Android defaults to a 60 Hz target; Settings offers 120 Hz.
                            // (upstream: 0 = match the display, else 60 / 30)`
  },
  {
    id: 'H1',
    file: 'src/game/player.js',
    sig: 'COLORBRAWL_LOOK_BUDGET',
    // Spend at most a fixed budget of the banked touch drag per frame, and carry the rest.
    //
    // WHY: touch.js onMove ADDS every pointermove to a running total (line ~683) and the render
    // frame subtracts the whole total at once. A phone digitiser emits pointermove at 120-240 Hz
    // and often in coalesced bursts, while the renderer runs at 30-60 fps under load. Every event
    // between two frames was banked and then applied in a single frame, so a steady swipe read as
    // one instantaneous rotation — the reported "I swipe once and the view flashes across".
    //
    // The clamp is on the MAGNITUDE of the (x, y) vector, not per axis, so a diagonal drag keeps
    // its direction. The remainder stays in the accumulator, so the total rotation over a gesture
    // is unchanged; it is only spread over ~2-3 frames instead of one.
    //
    // This was first written as a one-off edit to the working tree and was then silently reverted
    // by the next restore-from-pristine + reapply cycle. It belongs in this script.
    find: `      touchCtl.lookX = 0; touchCtl.lookY = 0;
    }`,
    replace: `      /* COLORBRAWL_LOOK_BUDGET */
      // Spend at most a fixed budget of the banked drag per frame and leave the rest for the
      // following frames. Pointer events arrive far faster than frames on a phone, so applying
      // the whole bank at once turned a steady swipe into one instant turn.
      const bankX = touchCtl.lookX || 0, bankY = touchCtl.lookY || 0;
      const mag = Math.hypot(bankX, bankY);
      const budget = 34;   // CSS px of drag per frame; mirrors LOOK_PER_FRAME in android/touch.js
      if (mag > budget) {
        const k = budget / mag;
        cbLookX = bankX * k; cbLookY = bankY * k;
        touchCtl.lookX = bankX - cbLookX; touchCtl.lookY = bankY - cbLookY;
      } else {
        cbLookX = bankX; cbLookY = bankY;
        touchCtl.lookX = 0; touchCtl.lookY = 0;
      }
    }`
  },
];
const mode = process.argv.includes('--verify') ? 'verify'
  : process.argv.includes('--revert') ? 'revert' : 'apply';

/** Read a file and report its dominant line ending. */
function readFile(file) {
  const raw = readFileSync(join(GAME, file), 'utf8');
  const crlf = (raw.match(/\r\n/g) || []).length;
  const lf = (raw.match(/\n/g) || []).length;
  return { raw, eol: crlf > lf / 2 ? '\r\n' : '\n' };
}
function writeFile(file, text, eol) {
  writeFileSync(join(GAME, file), eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text, 'utf8');
}

let failures = 0;
const changed = new Set();
const perFile = new Map();   // file -> { eol, text }

for (const p of patches) {
  const path = join(GAME, p.file);
  if (!existsSync(path)) {
    console.error(`[MISSING FILE] ${p.id}: ${p.file}`);
    failures++;
    continue;
  }
  if (!perFile.has(p.file)) {
    const { raw, eol } = readFile(p.file);
    perFile.set(p.file, { eol, text: raw.replace(/\r\n/g, '\n') });
  }
  const entry = perFile.get(p.file);

  const isApplied = entry.text.includes(p.sig);
  const anchorCount = entry.text.split(p.find).length - 1;

  if (mode === 'verify') {
    if (!isApplied) { console.error(`[NOT APPLIED] ${p.id} (${p.file})`); failures++; }
    continue;
  }

  if (mode === 'revert') {
    if (isApplied && anchorCount === 0 && entry.text.includes(p.replace)) {
      entry.text = entry.text.replace(p.replace, p.find);
      changed.add(p.file);
      console.log(`[reverted] ${p.id} (${p.file})`);
    } else if (!isApplied) {
      console.log(`[skip, not applied] ${p.id}`);
    } else {
      console.warn(`[revert not exact] ${p.id} — signature present but block not found verbatim`);
      failures++;
    }
    continue;
  }

  // apply
  if (isApplied) { console.log(`[ok, already applied] ${p.id}`); continue; }
  if (anchorCount === 0) {
    console.error(`[ANCHOR MISSING] ${p.id} (${p.file}) — upstream source changed; patch NOT applied`);
    failures++;
    continue;
  }
  if (anchorCount > 1) {
    console.error(`[AMBIGUOUS] ${p.id} (${p.file}) — anchor matches ${anchorCount} times`);
    failures++;
    continue;
  }
  entry.text = entry.text.replace(p.find, p.replace);
  changed.add(p.file);
  console.log(`[applied] ${p.id} (${p.file})`);
}

if (mode !== 'verify' && failures === 0) {
  for (const file of changed) {
    const entry = perFile.get(file);
    writeFile(file, entry.text, entry.eol);
  }
}

if (mode === 'verify') {
  console.log(failures === 0 ? '\nResult: all Android patches are applied.' : `\nResult: ${failures} patch(es) missing.`);
  process.exit(failures === 0 ? 0 : 1);
}

if (failures > 0) {
  console.error(`\nResult: ${failures} patch(es) failed. No file was written.`);
  process.exit(1);
}

console.log(`\nResult: ok. Files written: ${changed.size ? [...changed].join(', ') : '(none — already applied)'}`);
