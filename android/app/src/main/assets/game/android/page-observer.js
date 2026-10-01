/*
 * Color Brawl — page-world test observer  (?mttest=1)
 * =============================================================================
 * Loaded by a static `import` from src/main.js, so it is part of the PAGE's module graph and
 * runs in the page's own JavaScript world. That property is the reason this file exists:
 * code injected with WebView.evaluateJavascript() could mount DOM and see `console`, but it
 * read `window.G` — a name nothing in the game assigns — and so could not observe the game at
 * all. Reading the real globals (`window.__G` / `window.__inkwave`) plus living inside the
 * module graph removes every ambiguity about what is being measured.
 *
 * It is INERT in production: everything below returns immediately unless ?mttest=1 is present.
 *
 * It answers three questions, each from the game's own state rather than from the harness:
 *   1. Is the game up, and what does its Input hold?          -> gameInput()
 *   2. Does dragging actually turn the camera?                -> driveLook(), reporting rig.yaw
 *   3. Are four concurrent pointers routed to four actions?   -> driveMultiTouch()
 */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  if (!params.has('mttest')) return;

  function report(tag, extra) {
    var G = window.__G || window.__inkwave || null;
    var out = {
      tag: tag,
      pageWorld: true,
      hasCtx: !!G,
      mode: (G && G.mode) || null,
      instance: window.__cbTouchInstance || 0,
      touchLayerSeen: !!(window.__cbTouch && window.__cbTouch.active)
    };
    if (extra) { for (var k in extra) out[k] = extra[k]; }
    try { window.ColorBrawl && window.ColorBrawl.log('info', 'PAGE ' + JSON.stringify(out)); } catch (e) { /* ignore */ }
    return out;
  }

  /** The game's live input state — the only thing that proves the wiring works. */
  function gameInput() {
    var G = window.__G || window.__inkwave;
    if (!G) return { error: 'game context not published yet' };
    var inp = G.input || null;
    var m = G.match || null;
    var a = m && m.local ? m.local : null;
    var it = a && a.intent ? a.intent : null;
    return {
      mode: G.mode || null,
      matchState: m ? m.state : null,
      yaw: G.rig ? +G.rig.yaw.toFixed(4) : null,
      pitch: G.rig ? +G.rig.pitch.toFixed(4) : null,
      keysHeld: inp ? Array.prototype.slice.call(inp.keys || []).sort() : null,
      mouse: inp ? { left: !!inp.mouse.left, right: !!inp.mouse.right, dx: +(inp.mouse.dx || 0).toFixed(2), dy: +(inp.mouse.dy || 0).toFixed(2) } : null,
      lastDevice: inp ? inp.lastDevice : null,
      padIsTouch: !!(inp && inp.pad && inp.pad._synthetic),
      intent: it ? {
        move: [+it.move.x.toFixed(3), +it.move.y.toFixed(3), +it.move.z.toFixed(3)],
        jump: !!it.jump, squid: !!it.squid, fire: !!it.fire, sub: !!it.sub, special: !!it.special
      } : null,
      form: a ? (a.form || (a.anim && a.anim.form) || null) : null,
      vel: a ? [+a.vel.x.toFixed(2), +a.vel.y.toFixed(2), +a.vel.z.toFixed(2)] : null
    };
  }

  // ---------------------------------------------------------------------------
  // Real pointer dispatch at the touch layer's OWN controls
  // ---------------------------------------------------------------------------

  function firePointer(type, id, x, y) {
    var el = document.elementFromPoint(x, y) || document.body;
    var opts = {
      bubbles: true, cancelable: true, composed: true,
      pointerId: id, pointerType: 'touch', isPrimary: id === 101,
      clientX: x, clientY: y, button: 0,
      buttons: type === 'pointerup' ? 0 : 1
    };
    var ev;
    try { ev = new PointerEvent(type, opts); }
    catch (e) {
      ev = new MouseEvent(type.replace('pointer', 'mouse'), opts);
      try { Object.defineProperty(ev, 'pointerId', { value: id }); } catch (e2) { /* ignore */ }
    }
    el.dispatchEvent(ev);
    return el.id || el.tagName;
  }

  function centreOf(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }

  function hitTest() {
    var pad = document.getElementById('cb-stick-pad');
    if (!pad) return null;
    var r = pad.getBoundingClientRect();
    var el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    return el ? (el.id || el.tagName) : null;
  }

  var live = {};
  window.addEventListener('pointerdown', function (e) { live[e.pointerId] = 1; }, true);
  window.addEventListener('pointerup', function (e) { delete live[e.pointerId]; }, true);
  window.addEventListener('pointercancel', function (e) { delete live[e.pointerId]; }, true);

  function probe(extra) {
    var o = { livePointers: Object.keys(live).length, game: gameInput() };
    if (extra) { for (var k in extra) o[k] = extra[k]; }
    return o;
  }

  // ---------------------------------------------------------------------------
  // Test 1 — does dragging turn the camera? Then again with FIRE held.
  // ---------------------------------------------------------------------------

  function dragLook(id, done) {
    var rx = Math.round(window.innerWidth * 0.55);
    var ry = Math.round(window.innerHeight * 0.5);
    firePointer('pointerdown', id, rx, ry);
    var i = 0;
    var step = setInterval(function () {
      i++;
      firePointer('pointermove', id, rx + i * 34, ry + i * 7);
      if (i >= 8) {
        clearInterval(step);
        firePointer('pointerup', id, rx + 272, ry + 56);
        done();
      }
    }, 40);
  }

  /** Raw state of the two seams, read synchronously right after the events are dispatched. */
  function seams(tag) {
    var T = window.__cbTouch || {};
    var G = window.__G || window.__inkwave;
    var inp = G && G.input;
    return report(tag, {
      // the touch layer's accumulator, BEFORE any frame boundary can clear it
      touchLookX: +(T.lookX || 0).toFixed(1),
      touchLookY: +(T.lookY || 0).toFixed(1),
      // which touch flags the game is currently seeing
      touchFlags: { map: !!T.map, fire: !!T.fire, jump: !!T.jump, active: !!T.active },
      padAxes: inp && inp.pad ? [+(inp.pad.axes[0] || 0).toFixed(3), +(inp.pad.axes[1] || 0).toFixed(3)] : null,
      padSynthetic: !!(inp && inp.pad && inp.pad._synthetic),
      rigMapK: G && G.rig && G.rig.mapK !== undefined ? +G.rig.mapK.toFixed(3) : null,
      yaw: G && G.rig ? +G.rig.yaw.toFixed(4) : null
    });
  }

  function driveLook() {
    var before = gameInput();
    report('look-0-before', { yaw: before.yaw, pitch: before.pitch });
    if (before.yaw === null) return;

    dragLook(201, function () {
      seams('seams-right-after-drag');
      setTimeout(function () {
        var a = gameInput();
        report('look-1-bare-drag', { yaw: a.yaw, dYaw: +(a.yaw - before.yaw).toFixed(4), lastDevice: a.lastDevice });

        var fire = centreOf('cb-fire');
        firePointer('pointerdown', 202, fire.x, fire.y);
        setTimeout(function () {
          report('look-2-fire-held', { fire: gameInput().intent && gameInput().intent.fire });
          dragLook(203, function () {
            setTimeout(function () {
              var b = gameInput();
              report('look-3-drag-while-firing', {
                yaw: b.yaw, dYaw: +(b.yaw - a.yaw).toFixed(4),
                fireStillHeld: b.intent && b.intent.fire
              });
              firePointer('pointerup', 202, fire.x, fire.y);
              setTimeout(function () {
                var c = gameInput();
                report('look-4-released', { fire: c.intent && c.intent.fire, yaw: c.yaw });
              }, 250);
            }, 350);
          });
        }, 250);
      }, 350);
    });
  }

  // ---------------------------------------------------------------------------
  // Test 2 — four concurrent pointers routed to four different actions.
  // ---------------------------------------------------------------------------

  function driveMultiTouch() {
    var pad = centreOf('cb-stick-pad');
    var fire = centreOf('cb-fire');
    var jump = centreOf('cb-jump');
    if (!pad || !fire) return report('mt-ABORT', { reason: 'controls missing' });

    report('mt-1-stick-down', { hit: firePointer('pointerdown', 101, pad.x, pad.y) });
    firePointer('pointermove', 101, pad.x, pad.y - 45);          // push forward = move

    var rx = Math.round(window.innerWidth * 0.55), ry = Math.round(window.innerHeight * 0.5);
    firePointer('pointerdown', 102, rx, ry);                     // camera, first finger still down
    firePointer('pointermove', 102, rx + 60, ry - 25);
    report('mt-2-plus-camera');

    firePointer('pointerdown', 103, fire.x, fire.y);             // fire, two fingers still down
    report('mt-3-plus-fire');

    if (jump) { firePointer('pointerdown', 104, jump.x, jump.y); report('mt-4-plus-jump'); }

    var n = 0;
    var hold = setInterval(function () {
      report('HOLD-' + n, probe());
      if (++n > 12) {
        clearInterval(hold);
        if (jump) firePointer('pointerup', 104, jump.x, jump.y);
        firePointer('pointerup', 103, fire.x, fire.y);
        firePointer('pointerup', 102, rx + 60, ry - 25);
        firePointer('pointerup', 101, pad.x, pad.y - 45);
        report('RELEASED-ALL', probe());
        var s = 0;
        var settle = setInterval(function () {
          report('SETTLE-' + s, probe());
          if (++s > 6) clearInterval(settle);
        }, 250);
      }
    }, 250);
  }

  window.__cbPage = {
    report: report, gameInput: gameInput, probe: probe,
    driveLook: driveLook, driveMultiTouch: driveMultiTouch
  };

  // ---------------------------------------------------------------------------
  // Boot reporting + continuous camera sampling
  // ---------------------------------------------------------------------------

  report('boot-0s');
  [3000, 10000, 30000].forEach(function (d) {
    setTimeout(function () {
      report('boot-' + Math.round(d / 1000) + 's', probe({ hitStickCentre: hitTest() }));
    }, d);
  });

  // yaw only matters while it is CHANGING, and sampling on pointer transitions alone can miss
  // it entirely — so print one line per distinct yaw value.
  var lastYaw = null;
  setInterval(function () {
    var G = window.__G || window.__inkwave;
    if (!G || !G.rig) return;
    var y = +G.rig.yaw.toFixed(4);
    if (y !== lastYaw) {
      lastYaw = y;
      report('YAW', { yaw: y, pitch: +G.rig.pitch.toFixed(4), lastDevice: G.input && G.input.lastDevice });
    }
  }, 200);

  // ---------------------------------------------------------------------------
  // Arm once the match is genuinely up and the controls are the topmost elements
  // ---------------------------------------------------------------------------

  var armed = false;
  setInterval(function () {
    if (armed) return;
    var G = window.__G || window.__inkwave;
    if (!G || !G.match || G.mode !== 'match' || G.match.state !== 'playing') return;
    if (hitTest() !== 'cb-stick-pad') return;     // the fade overlay is still on top
    armed = true;
    report('armed', { mode: G.mode, matchState: G.match.state });
    driveLook();
    setTimeout(driveMultiTouch, 5000);
  }, 400);
})();
