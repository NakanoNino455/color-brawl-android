/*
 * Color Brawl — JavaScript error surfacing
 * =============================================================================
 * The original game already routes boot failures into `#boot-error` (index.html:28,
 * written from src/main.js). This hook adds what a WebView needs to make those failures
 * visible from `adb logcat` instead of only on the device screen:
 *
 *   - window.onerror / window.onunhandledrejection
 *   - console.error / console.warn passthrough (already captured by WebChromeClient,
 *     kept here so errors thrown before the console client attaches are not lost)
 *   - resource load failures (script/link/img), which is how a bad asset path shows up
 *
 * It never swallows or rewrites an error: every one is forwarded to Android and also
 * left on the console.
 */
(function () {
  'use strict';
  if (window.__cbErrorHook) return;
  window.__cbErrorHook = true;

  var post = function (level, text) {
    try { window.ColorBrawl && window.ColorBrawl.log(level, text); } catch (e) { /* ignore */ }
  };

  function describe(value) {
    if (value instanceof Error) return (value.stack || (value.name + ': ' + value.message));
    if (typeof value === 'object' && value !== null) {
      try { return JSON.stringify(value); } catch (e) { return String(value); }
    }
    return String(value);
  }

  window.addEventListener('error', function (ev) {
    // Resource errors have no `message` and arrive with a target that is not window.
    if (ev && ev.target && ev.target !== window && ev.target.tagName) {
      var t = ev.target;
      var url = t.src || t.href || '(unknown)';
      post('error', 'resource load failed: <' + t.tagName.toLowerCase() + '> ' + url);
      return;
    }
    var where = ev && ev.filename ? (' @ ' + ev.filename + ':' + ev.lineno + ':' + ev.colno) : '';
    post('error', 'Uncaught ' + (ev && ev.message ? ev.message : 'error') + where);
    if (ev && ev.error) post('error', describe(ev.error));
  }, true);

  window.addEventListener('unhandledrejection', function (ev) {
    post('error', 'Unhandled promise rejection: ' + describe(ev && ev.reason));
  });

  var origError = console.error, origWarn = console.warn;
  console.error = function () {
    post('error', Array.prototype.map.call(arguments, describe).join(' '));
    return origError.apply(console, arguments);
  };
  console.warn = function () {
    post('warn', Array.prototype.map.call(arguments, describe).join(' '));
    return origWarn.apply(console, arguments);
  };

  /*
   * Boot-failure surface.
   *
   * `src/main.js` ends with `new Game().boot().catch(...)`, and that catch writes the message
   * into `#boot-error` (index.html:28) — it does NOT rethrow and does NOT log. That makes a
   * failed boot completely invisible in logcat: the app looks alive, the loading screen stays
   * up, and nothing is reported. Observed exactly that during this port's multi-touch work.
   *
   * This observes the element and forwards its text, so a boot failure becomes a real
   * logcat line. It also reports the successful transition out of boot once, for symmetry.
   */
  var bootErr = document.getElementById('boot-error');
  if (bootErr) {
    var lastText = '';
    var check = function () {
      var t = (bootErr.textContent || '').trim();
      if (t && t !== lastText) {
        lastText = t;
        post('error', 'BOOT FAILED — #boot-error: ' + t);
      }
      // main.js sets window.G before boot() runs; report the first time it appears.
      if (!window.__cbBootSeen && typeof window.G !== 'undefined' && window.G) {
        window.__cbBootSeen = true;
        post('info', 'BOOT OK — window.G is available');
      }
      setTimeout(check, 500);
    };
    check();
  }
})();
