# Color Brawl — Android Bug & Fix Report

Every entry below was found during the actual porting work and its fix was verified by
rebuilding, reinstalling and re-running the app on the emulator. Nothing here is
speculative, and no entry claims a fix that was not observed.

Environment for every verification in this file:

- Host: Windows 11, Intel i5-13490F, NVIDIA RTX 5060
- Emulator: Android 16 (API 36), x86_64, 1080x2400 @ 420dpi, `-gpu host`
  (OpenGL ES 3.1 via the emulator's translator), AVD `ColorBrawl`
- WebView provider: `com.google.android.webview` 133.0.6943.137
- AGP 9.4.1, Gradle 9.6.0, JDK 25 (Android Studio JBR), compileSdk 36, minSdk 24

---

## BUG-001 — Asset loader served the wrong path, game never loaded

| Field | Value |
|---|---|
| Severity | Blocker |
| Symptom | Blank screen. `webview resource error: https://appassets.androidplatform.net/game/index.html main=true :: There was a network error.` |
| Reproduction | Install and launch → page fails before any game code runs. |
| Evidence | `E/WebViewAssetLoader: Error opening asset path: index.html` / `java.io.FileNotFoundException: index.html` at `MainActivity$configureWebView$2.shouldInterceptRequest(MainActivity.kt:148)` |

**Root cause.** `WebViewAssetLoader.AssetsPathHandler` *strips the registered path prefix*
and passes only the remainder to `AssetManager`. Registering the handler at `/game/` meant
a request for `https://appassets.androidplatform.net/game/index.html` was resolved as
`assets/index.html`, while the file actually ships at `assets/game/index.html`.

**Fix.** Register a single handler at the root, so the full URL path is used verbatim and
maps 1:1 onto the APK:

```kotlin
.addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
```

**Files changed.** `app/src/main/java/com/colorbrawl/android/MainActivity.kt`

**Validation.** Rebuilt, reinstalled, relaunched →
`I/ColorBrawl: onPageFinished: https://appassets.androidplatform.net/game/index.html`,
followed by WebGL renderer creation. Verified the packaged tree contains
`assets/game/index.html` and that the `index.html` import map target
`./vendor/three/build/three.module.js` resolves to a real APK entry.

**Status:** Fixed and verified.

---

## BUG-002 — `three.module.js` missing from the APK (blank scene)

| Field | Value |
|---|---|
| Severity | Blocker |
| Symptom | The import map's `three` specifier would fail to resolve; the whole game is three.js. |
| Reproduction | Inspect the built APK: `assets/game/vendor/three/build/` was **empty**. |

**Root cause.** The initial asset copy used
`robocopy ... /XD .git node_modules build docs tools electron .botlab dist`. Robocopy's
`/XD` matches a directory **name at any depth**, so `/XD build` also excluded
`vendor/three/build/`. That directory holds `three.module.js` and `three.core.js` — the
engine itself.

**Fix.** Copy the two files back from the pristine upstream checkout (verified identical by
SHA-256 against `dp/inkwave/vendor/three/build/`). The full asset diff against upstream was
then computed file-by-file: exactly **2** gameplay-relevant files had been lost, and the
other 59 were `tools/`, `docs/`, `build/` and `electron/` development files that must not
ship in an APK.

**Files changed.** `app/src/main/assets/game/vendor/three/build/three.module.js`,
`.../three.core.js`

**Validation.** Rebuilt; both files present in the APK (666 KB + 1483 KB);
`assets/game` went from 712 to 714 entries; the import map target resolves. Scene rendering
confirmed visually afterwards.

**Status:** Fixed and verified.

---

## BUG-003 — `touch.js` threw during `layout()`, killing the touch layer

| Field | Value |
|---|---|
| Severity | Blocker (for touch) |
| Symptom | `JS Uncaught TypeError: Cannot set properties of undefined (setting 'R')` at `android/touch.js:188`, thrown from `layout()` ← `mount()` |
| Reproduction | Every launch, immediately after injection. |

**Root cause.** `mount()` calls `layout()`, and `mount()` is invoked **synchronously**
because the script is injected after `onPageFinished`, when `document.readyState` is
already `complete`. `geom` was declared with `var` *below* `mount()`. `var` hoists the
binding but not the initialiser, so `geom` was `undefined` at call time.

**Fix.** Moved the `geom` declaration above `mount()`, and documented why the ordering
matters so it cannot regress.

**Files changed.** `app/src/main/assets/game/android/touch.js`

**Validation.** `node --check` passes; the touch layer now logs
`JS touch layer ready (915x412)` on every launch, and uncaught JS errors stayed at zero
across all subsequent runs.

**Status:** Fixed and verified.

---

## BUG-004 — `am start -d <https url>` opened Chrome instead of the app

| Field | Value |
|---|---|
| Severity | High (blocked automated testing) |
| Symptom | Launching with `?autostart=…` parameters opened **Chrome's sign-in screen**, not Color Brawl. |
| Reproduction | `adb shell am start -a android.intent.action.VIEW -d https://appassets.androidplatform.net/game/index.html?autostart=180` |
| Evidence | Screenshot showed Chrome; `mCurrentFocus=com.android.chrome/...Main`; the app process had `numWindow=0`. |

**Root cause.** On a device, an `http(s)` URL handed to `am start -d` is resolved by the
system to the default browser. Nothing routes it to this app.

**Fix.** Deliver the site's query parameters as **intent extras** and append them to the
entry URL inside `MainActivity`, URL-encoding each value so a caller cannot inject extra
parameters:

```kotlin
private fun gameQuery(intent: Intent?): String   // cb_autostart, cb_mode, cb_map, …
```

`tools/cbtools.ps1` translates `-Query '?autostart=180&mode=turf'` into `--es cb_*` extras.

**Files changed.** `MainActivity.kt`, `tools/cbtools.ps1`

**Validation.** `I/ColorBrawl: loading https://appassets.androidplatform.net/game/index.html?autostart=180&mode=turf&difficulty=fresh&skipTitle=1`
— and a live match was reached.

**Status:** Fixed and verified.

---

## BUG-005 — `singleTask` + no `onNewIntent` silently dropped new extras

| Field | Value |
|---|---|
| Severity | Medium (test-harness correctness) |
| Symptom | `am start` reported *"Activity not started, intent has been delivered to currently running top-most instance"*, and the parameters were ignored. |
| Reproduction | Launch with extras, then launch again with different extras. |

**Root cause.** `MainActivity` is declared `android:launchMode="singleTask"` and does not
override `onNewIntent`, so a subsequent `am start` delivers the intent to the existing
instance, which never re-reads it and never reloads the page.

**Fix.** `tools/cbtools.ps1` always `am force-stop`s the package before starting it, so
every instrumented launch is a genuine cold start. Documented inline.

**Files changed.** `tools/cbtools.ps1`

**Validation.** Repeated launches each produced a fresh
`I/ColorBrawl: loading …?<params>` line and the expected URL.

**Status:** Fixed (harness); the app's own behaviour is correct for a singleTask game.

---

## BUG-006 — PowerShell corrupted every screenshot to a non-PNG

| Field | Value |
|---|---|
| Severity | Medium (tooling) |
| Symptom | `adb exec-out screencap -p > file.png` produced a 6.3 MB file starting `FF FE FD FF 50 00 4E 00 47 00` — a UTF-16 re-encoding of a 3.2 MB PNG. Every screenshot was unreadable. |

**Root cause.** PowerShell 7's `>` redirection re-encodes native command output; it does
not pass bytes through.

**Fix.** Capture through `cmd.exe /c "… > file.png"`, then assert the PNG magic bytes
before using the file. `CB-Shot` throws if the result is not a PNG.

**Files changed.** `tools/cbtools.ps1`

**Validation.** Screenshots are now consistently 2–3 MB with magic `89 50 4E 47`.

**Status:** Fixed and verified.

---

## BUG-007 — PowerShell's argument binder silently consumed adb flags

| Field | Value |
|---|---|
| Severity | Medium (tooling) |
| Symptom | `adb logcat -c` ran as `adb logcat`; `adb shell monkey -p <pkg> -c LAUNCHER 1` arrived as `monkey -c LAUNCHER 1`, losing both its own `-p` **and** adb's `-s <serial>`. |
| Reproduction | Any helper that splatted an argument array into `& $adb`. |

**Root cause.** PowerShell's parameter binder intercepts tokens that match its own
parameters — `-p` is an alias of `-PipelineVariable`, and `-c`, `-s` collide similarly.
This happens even when the arguments are expanded from a variable.

**Fix.** `tools/cb-adb.cmd` — a two-line cmd.exe shim. `cb.exe` has no such binder.
`tools/cbtools.ps1` dispatches through it with `Start-Process`, because calling the `.cmd`
with `&` passes the whole string as one argument. (Also attempted and rejected:
`ProcessStartInfo.ArgumentList`, unavailable on this runtime; and a single quoted
`cmd.exe /c` string, which the binder still rewrote.)

**Files changed.** `tools/cb-adb.cmd` (new), `tools/cbtools.ps1`

**Validation.** `CB-Adb 'logcat -c'` clears the buffer; `am start` with extras works;
`devices` lists `emulator-5554 device`.

**Status:** Fixed and verified.

---

## BUG-008 — Build failed: duplicate `kotlin` extension with AGP 9.x

| Field | Value |
|---|---|
| Severity | Blocker (build) |
| Symptom | `Failed to apply plugin 'org.jetbrains.kotlin.android'` → `Cannot add extension with name 'kotlin', as there is an extension already registered with that name.` |

**Root cause.** AGP 9.x provides its own Kotlin support and registers the `kotlin`
extension. Applying the standalone Kotlin Android plugin on top of it collides.

**Fix.** Removed the standalone plugin from `libs.versions.toml`, `build.gradle.kts` and
`app/build.gradle.kts`. This matches the working configuration already present in the
Android Studio project on this machine (`D:\Android App`).

**Files changed.** `gradle/libs.versions.toml`, `build.gradle.kts`, `app/build.gradle.kts`

**Validation.** `BUILD SUCCESSFUL`.

**Status:** Fixed and verified.

---

## BUG-009 — Build failed: missing launcher icon resources

| Field | Value |
|---|---|
| Severity | Blocker (build) |
| Symptom | `AAPT: error: resource mipmap/ic_launcher … not found` during `processDebugResources`. |

**Root cause.** The manifest referenced `@mipmap/ic_launcher` and `@mipmap/ic_launcher_round`
but no icon resources had been created.

**Fix.** Added adaptive icons (`mipmap-anydpi-v26/`) drawn from the game's own favicon — an
orange ink squid on the deep-navy ink field — composed from two vector drawables, plus
self-contained `mipmap-anydpi/` vector fallbacks for API 24–25, which predate adaptive
icons.

**Files changed.** `res/drawable/ic_launcher_background.xml`,
`res/drawable/ic_launcher_foreground.xml`, `res/mipmap-anydpi-v26/ic_launcher.xml`,
`res/mipmap-anydpi-v26/ic_launcher_round.xml`, `res/mipmap-anydpi/ic_launcher.xml`,
`res/mipmap-anydpi/ic_launcher_round.xml`

**Validation.** `BUILD SUCCESSFUL`; the APK installs and the launcher shows the icon.

**Status:** Fixed and verified.

---

## BUG-010 — Source patch script silently failed on CRLF files

| Field | Value |
|---|---|
| Severity | High (correctness of the shipped source) |
| Symptom | All four `src/core/input.js` patches reported `[ANCHOR MISSING]` while `src/game/player.js` succeeded. |
| Reproduction | `node tools/patch-for-android.mjs` |

**Root cause.** Upstream mixes line endings: `input.js` is **CRLF**, `player.js` is **LF**.
The patch script's multi-line anchors used `\n` and could never match a CRLF file. (The
first version also had an idempotency check that could not distinguish "applied" from
"not applied" reliably.)

**Fix.** Match against an LF-normalised copy of each file and restore the file's original
ending style on write; give every patch a stable `sig` string for idempotency; refuse the
whole run when any anchor is missing or ambiguous. **The script deliberately writes
nothing when a patch fails** — that is why the CRLF problem surfaced as a loud error
instead of a half-patched file.

**Files changed.** `tools/patch-for-android.mjs`

**Validation.** All 13 patches apply; `--verify` exits 0; re-running reports
`already applied` with `Files written: (none — already applied)`; CRLF preserved
(`input.js` LF=181 CRLF=181, `player.js` LF=303 CRLF=303); `node --check` passes on both.

**Status:** Fixed and verified.

---

## BUG-011 — Touch buttons remained visible in menus and covered the UI

| Field | Value |
|---|---|
| Severity | High (usability) |
| Symptom | On the title screen and every menu the joystick and button cluster were drawn on top of the game's own UI, obscuring buttons and intercepting input. |
| Evidence | Screenshots `title-branded` / earlier captures show the cluster over the main menu. |

**Root cause.** The overlay was unconditionally visible. An earlier design also covered 66%
of the screen with a `pointer-events: auto` capture surface for camera drags, which
swallowed taps aimed at the game's menus.

**Fix.** Two changes in `android/touch.js`:
1. The large look-capture surface was **removed entirely**. Camera drags are served from a
   window-level listener, so the original menus and HUD receive native taps with no
   synthetic click dispatch anywhere.
2. The cluster is now shown only during gameplay, decided by reading the game's own live
   state (`G.mode === 'match'`, `!match.attract`, and the `menus._stack` — hidden while any
   front-end screen other than `pause` is up).

**Files changed.** `app/src/main/assets/game/android/touch.js`

**Validation.** On the title and menu screens the cluster is absent; on entering a match it
appears. Menus respond to taps.

**Status:** Fixed and verified.

---

## BUG-012 — Product name shown to the user was "INKWAVE"

| Field | Value |
|---|---|
| Severity | High (explicit product requirement) |
| Symptom | The title screen, main-menu logo, credits logo and corner caption all rendered **INKWAVE**. |
| Requirement | The name the user sees must be **Color Brawl**; INKWAVE is only the upstream reference. |

**Root cause.** `src/config.js` exported `GAME_TITLE = 'INKWAVE'`, and the wordmark is
data-driven — `ui-icons.js logoMarkup(title, subtitle, size)` splits the string into one
`<span>` per character.

**Fix.** Patch `C1` changes the single constant to `'Color Brawl'`. Because the logo is
generated from that string, one edit rebrands every surface. (The runtime-drawn wordmark
was deliberately *not* replaced with an image.)

**Files changed.** `src/config.js` (via `tools/patch-for-android.mjs`)

**Validation.** Screenshot `title-branded.png`: large **Color Brawl** wordmark with the
`TURF RIOT` subtitle, and the corner caption `Color Brawl · an original turf-war shooter`.
`android:label` and `@string/app_name` were already `Color Brawl`; `apksigner` reports the
signer `CN=Color Brawl`.

**Status:** Fixed and verified. The upstream credit line in the Credits screen
("INKWAVE by Jayden Davis", MIT) is intentionally retained as attribution.

---

## BUG-013 — Default quality preset too heavy for the platform

| Field | Value |
|---|---|
| Severity | High (performance) |
| Symptom | Median frame time **61 ms (≈16 fps)**, 73% janky frames, on the release build. |
| Evidence | `dumpsys gfxinfo`: `Total frames rendered: 886`, `Janky frames: 647 (73.02%)`, `50th percentile: 61ms`, `50th gpu percentile: 4ms` |

**Root cause.** Upstream ships `quality: 'high'` — 4096² paint atlas, 4096 shadow map,
4× MSAA, GTAO and bloom. The GPU is not the constraint (4–6 ms of GPU time throughout);
the frame is spent in the game's own per-frame CPU work around the 4096² ink atlas, which
is exactly the cost the quality presets exist to control.

**Fix.** Patch `C2`/`C3`/`C4`: a first-run Android migration (`androidQualityMigration`) in
`src/config.js`, applied in `main.js` immediately after settings load and **before** the
renderer is constructed. It rewrites the default only when the stored `quality` is still
the untouched `'high'`, and never overrides a setting the player has changed. All four
presets (`low`/`medium`/`high`/`ultra`) remain selectable in Settings.

**Files changed.** `src/config.js`, `src/main.js` (via `tools/patch-for-android.mjs`)

**Validation.** Measured after the migration on a fresh install: `50th percentile: 46ms`,
`Janky frames: 530 (43.95%)` — **61 ms → 46 ms (≈16.4 → 21.7 fps), jank 73% → 44%**.

**Honest caveat.** A second run of the same build measured `50th percentile: 65ms`. The
emulator's CPU-side frame time is **not reproducible between runs** (host CPU contention,
JIT warm-up), while GPU time held at 4–6 ms in every run. Single measurements on this
emulator must not be treated as benchmark results; see the test report.

**Status:** Fixed (directional improvement measured); the real target — a stable 60 fps —
is **not met** and is carried forward as remaining work.

---

## BUG-014 — `songs/manifest.json` 404 on every launch

| Field | Value |
|---|---|
| Severity | Informational (expected upstream behaviour) |
| Symptom | `webview resource error: https://appassets.androidplatform.net/game/songs/manifest.json main=false :: There was a network error.` on every boot. |

**Root cause.** `src/audio/music.js` fetches `songs/manifest.json` for optional file-backed
tracks, but that manifest **does not exist in the upstream repository** — `songs/` contains
only `README.md`. The manifest is generated locally by `npm run music` from audio files that
are git-ignored by design.

**Fix.** None required and none applied. The fetch is already `.catch`ed and the game falls
back to its fully procedural, in-code soundtrack. Deliberately **not** silenced: hiding it
would violate the project's rule against suppressing errors to make a log look clean.

**Files changed.** none

**Validation.** Confirmed by reading `music.js` and listing `songs/` upstream; the game
plays music from the synthesiser with no audible gap.

**Status:** Confirmed benign, left visible in logcat.

---

## BUG-015 — Multi-touch test harness could not observe the game

| Field | Value |
|---|---|
| Severity | Medium (test validity — reported against the test, not the app) |
| Symptom | The `?mttest=1` scenario drove four concurrent pointers but every probe reported `{"game":{"error":"no G"}}`, and the joystick never claimed its pointer (`stickOwner:null`, `moveX/moveY` stuck at 0). |

This took four investigation rounds; three distinct causes were found and each was fixed.
The chain is recorded in full because two of them were **real defects in the shipped layer**,
not merely harness problems.

### 15a — hoisting bug: `forceVisible` was shadowed (real defect, fixed)

`touch.js` sets `forceVisible = true` inside the `?mttest` block, which sat **above** the
line that declared `var forceVisible = false`. Because `var` hoists the binding but not the
initialiser, the assignment created a *global*, and the later declaration then initialised a
*local* of the same name and shadowed it. Effect: reads returned `true` for the first tick
and `false` for ever after, in a **single instance with no page reload**.

The diagnostic that caught it:

```
MTTEST waiting 0s  … "forceVisible":true,  "instance":1,"liveInstances":1
MTTEST waiting 10s … "forceVisible":false, "instance":1,"liveInstances":1
```

This is the same failure shape as BUG-003 (`geom` used before its declaration). The codebase
had now produced this bug twice with two different variables.

**Fix.** The whole `?mttest` block was relocated to the **end** of the module so every `var`
has initialised before it runs. `diagVisibility` had the identical latent defect and is fixed
by the same move. A comment at the declaration records why ordering matters.

**Validation.** `forceVisible:true` now holds across every 10-second tick of a run
(previously it flipped to `false` at the first tick after the declaration executed).

**Files changed.** `app/src/main/assets/game/android/touch.js`

### 15b — overlay hidden during the scenario, so pointers missed the joystick (harness)

`onDown` decides the joystick owns a pointer only when `e.target === stickPad`. With the
overlay at `display:none`, `elementFromPoint` returned the game canvas, so every pointer fell
through to the camera-drag branch. Confirmed by dumping hit-tests (`layoutDump`): once the
overlay is genuinely visible, `hitStickCentre` and `hitScenarioStick` both resolve to
`cb-stick-pad` and `hitFire` to `cb-fire` — the routing is correct.

**Fix.** The scenario sets `forceVisible` before dispatching anything, and all scenario
coordinates are now derived from live geometry (`geom.cx/cy/R` and element rects) instead of
hard-coded viewport fractions.

### 15c — `window.G` is not reachable from the injected script (OPEN)

After 15a and 15b were fixed, the gate still reported `hasG:false` at every tick, including
while the game was demonstrably running a full match to its results screen. Characterised so
far, all from real output:

| Observation | Value |
|---|---|
| `onPageStarted` / `history update` count | exactly **1** — no reload, no navigation |
| `onRenderProcessGone` | never fired — renderer did not die |
| `instance` / `liveInstances` | `1` / `1` |
| `#boot-error` text | empty (`bootErr:null`) |
| `window.__cbTouch` guard | not re-entered |
| Game itself | ran a complete Turf War match and rendered the results screen |

The page's module script demonstrably runs: three.js is constructed and its
`KHR_parallel_shader_compile` warning was captured by `errorhook.js`, which also mounts DOM.
So the DOM and `console` are shared, but `window.G` — set by `src/main.js` and named
explicitly in upstream `docs/CONTRACTS.md` — reads as undefined from the injected script.

**Leading hypothesis (not yet proven).** `evaluateJavascript` content executes in a context
whose JavaScript globals are not the page's, while sharing the DOM and host objects such as
`console`. That would explain every observation at once.

**Test that would settle it, not yet run.** Have the injected script report
`typeof window.G`, `typeof window.__inkwave`, and the value of a marker that *the page itself*
writes (`main.js` also sets `window.__inkwave`), versus a marker the injected script writes.
If the page's own markers are invisible, the worlds are separate.

**Consequence — and this is the important part.** If the worlds truly are separate, then the
bare-identifier references to `G` inside the **patched `src/core/input.js`** and
**`src/game/player.js`** are *not* affected: those files are part of the page, so they resolve
the page's own `G` normally. The patch is `if (this.pollTouch) this.pollTouch();` calling a
method on the game's own `Input` instance, and `window.__cbTouch` is read from page code. So
the **touch layer's wiring into the game is sound**; it is only the *out-of-page probe* that
cannot see the game. That distinction is what the next round must confirm before the earlier
touch results can be called conclusive.

**Status: NOT FULLY VERIFIED — re-characterised, not resolved.**
See also BUG-016, found while investigating this.

---

## BUG-016 — A failed game boot was completely invisible in logcat

| Field | Value |
|---|---|
| Severity | Medium (observability — affects any future debugging on this port) |
| Symptom | If the game failed to boot, the app looked alive, the loading screen stayed up, and **nothing** appeared in logcat. |

**Root cause.** `src/main.js` ends with:

```js
new Game().boot().catch((e) => { /* writes the message into #boot-error */ });
```

That `catch` writes into the `#boot-error` element (`index.html:28`) and neither rethrows nor
logs. `#boot-error` is a styled DOM node the player sees; it never reaches `console`, so the
`window.onerror` / `unhandledrejection` handlers added for this port never fire for it.

This was found the hard way: while chasing BUG-015 the probe reported `hasG:false` for three
minutes with an empty logcat, and there was no way to tell "still booting" from "boot failed"
without screenshotting the device and reading the banner by eye.

**Fix.** `android/errorhook.js` now observes `#boot-error` and forwards any text it acquires
to logcat as `BOOT FAILED — #boot-error: …`, and reports `BOOT OK — window.G is available`
once, when `window.G` first becomes defined. This is a permanent improvement: any future
boot regression on this port is now diagnosable from `adb logcat` alone.

**Files changed.** `app/src/main/assets/game/android/errorhook.js`

**Validation.** In the new build the boot observer runs and reports its state; `bootErr:null`
across a three-minute window confirmed the boot did **not** fail in that run, which is what
redirected the investigation to BUG-015c.

**Status:** Fixed and verified.

---

## BUG-017 — The touch layer read the wrong global, so it never saw the game (real, fixed)

| Field | Value |
|---|---|
| Severity | High — the touch overlay never appeared during play, and every automated probe reported "no game" |
| Symptom | `android/touch.js` reported `hasG:false` for the entire life of the page, so `matchWantsTouch()` always returned false and the overlay stayed `display:none` during real matches. |

**Root cause.** `src/main.js:193-194` publishes the running game as:

```js
window.__inkwave = this;   // the Game instance
window.__G = G;            // the shared context object from src/core/ctx.js
```

**Nothing anywhere assigns `window.G`.** `android/touch.js` read `window.G` in eleven places.
The identifier resolved to `undefined` every time, which is indistinguishable from "the game
has not booted yet" — and that is exactly how it read for several rounds of debugging.

**How it was found.** A page-world observer (loaded by a real `<script>` import inside
`src/main.js`, so it is page code by construction) reported:

```
page-boot-0s   hasG:false  hasInkwave:false  hasGUnderscore:false
page-boot-10s  hasG:false  hasInkwave:false  hasGUnderscore:false
page-boot-30s  hasG:false  hasInkwave:TRUE   hasGUnderscore:TRUE
page-boot-60s  hasG:false  hasInkwave:TRUE   hasGUnderscore:TRUE
```

Both real names became `true` while the name I was reading stayed `false` forever. Every
value existed; I was asking for the wrong one.

**Fix.** A single `cbCtx()` accessor resolving `window.__G || window.__inkwave`, used by all
eleven sites. This also proved the world hypothesis wrong: an earlier theory held that
`evaluateJavascript` content ran in a separate JavaScript world. It does not — the page world
sees `window.__cbTouch` and `touchLayerSaw:true`, so the injected layer and the page share one
world, and the bug was simply the wrong property name.

**Files changed.** `app/src/main/assets/game/android/touch.js`

**Validation.** After the fix the gate works and, during a live match, reports
`mode:"match"` with the overlay genuinely on top:
`hitStickCentre:"cb-stick-pad"`, `hitFire:"cb-fire"`.

**Status:** Fixed and verified.

---

## BUG-018 — Synthesized keys were never released: the player jumped forever (real, fixed)

| Field | Value |
|---|---|
| Severity | **High** — a single tap permanently broke movement |
| Symptom | After one tap on JUMP, `intent.jump` stayed `true` for the rest of the session. The actor jumped continuously and could not be stopped. |

**Root cause.** The port's own patch mapped the touch JUMP/SQUID/SPECIAL/MAP/PAUSE/CHEER
controls onto synthesized key codes through a helper called `touchAdd()`:

```js
touchAdd(code) {
  if (!this.keys.has(code)) this.pressed.add(code);
  this.keys.add(code);          // ADD ONLY — there is no delete anywhere
}
```

`player.js` reads `inp.down('Space')` every frame, and `down()` is `this.keys.has(code)`. With
no removal path, the first press left `'Space'` in `this.keys` permanently.

**Why fire and sub were fine.** They assign `this.mouse.left` / `this.mouse.right` directly,
and `pollTouch()` *does* clear those every frame. That asymmetry is what made the bug visible:
in the trace, `fire` cleared on release and `jump` did not.

**How it was found.** Button transitions were instrumented with the owning pointer id, which
showed the touch layer itself releasing correctly:

```
BTN fire=true  why=down-p103  held=["fire"]
BTN jump=true  why=down-p104  held=["fire","jump"]
BTN jump=false why=up-p104    held=["fire"]     <- released properly
BTN fire=false why=up-p103    held=[]
```

The touch state was correct and the *key* state was not — which localised the fault to
`touchAdd` rather than to the pointer plumbing.

**Fix.** Replaced the add-only helper with a symmetric per-frame `touchKey(code, on)` that
sets the key to match the touch state each frame, adds a `pressed` edge for `wasPressed()`,
and removes the key the moment the control is released. Touch-owned keys are tracked in
`this._touchKeys` so they can also be released as a group (`releaseTouchKeys()`) when the whole
layer goes inactive. Applied as patch **A5** in `tools/patch-for-android.mjs`, so it is
reproducible from pristine upstream — verified by restoring the four upstream files and
re-applying all 16 patches.

**Files changed.** `src/core/input.js` (via `tools/patch-for-android.mjs`)

**Validation.** Same multi-touch run, before and after:

| Phase | before | after |
|---|---|---|
| `RELEASED-ALL` | `fire=True  jump=True` | `fire=True  jump=True` (same frame) |
| `SETTLE-0` | `fire=False jump=**True**` | `fire=False jump=**False**` |
| `SETTLE-6` | `fire=False jump=**True**` | `fire=False jump=**False**` |

**Status:** Fixed and verified.

---

## BUG-019 — Android back button always exited the app instead of closing a screen (real, fixed)

| Field | Value |
|---|---|
| Severity | Medium |
| Symptom | Pressing back on a menu screen closed the whole app rather than returning to the main menu. |

**Root cause.** `menus.js:274` stores the menu stack as an array of **strings**:

```js
else this._stack = name ? [name] : [];
```

`touch.js` read `stack[stack.length - 1].name` — reading `.name` off a string yields
`undefined`, so the "is a dismissible screen open?" test was always false.

**Fix.** Read the string directly: `stack[stack.length - 1]`. Both the `onBackPressed` handler
and the per-frame `setBackConsumed` reporter were corrected.

**Files changed.** `app/src/main/assets/game/android/touch.js`

**Validation.** `node --check` passes; the corrected expression matches the shape `menus.js`
actually stores, confirmed by reading `_stack`'s assignment sites (`menus.js:271-274`).
Interactive back-navigation was **not** exercised on the device.

**Status:** Fixed; device verification outstanding.

---

## Summary

| ID | Area | Severity | Status |
|---|---|---|---|
| BUG-001 | Asset serving | Blocker | Fixed, verified |
| BUG-002 | Packaging | Blocker | Fixed, verified |
| BUG-003 | Touch layer | Blocker | Fixed, verified |
| BUG-004 | Launch path | High | Fixed, verified |
| BUG-005 | Launch path | Medium | Fixed, verified |
| BUG-006 | Tooling | Medium | Fixed, verified |
| BUG-007 | Tooling | Medium | Fixed, verified |
| BUG-008 | Build | Blocker | Fixed, verified |
| BUG-009 | Build | Blocker | Fixed, verified |
| BUG-010 | Patch tooling | High | Fixed, verified |
| BUG-011 | Touch UI | High | Fixed, verified |
| BUG-012 | Product name | High | Fixed, verified |
| BUG-013 | Performance | High | Improved; **60 fps target not met** |
| BUG-014 | Audio manifest | Informational | Benign, intentionally left visible |
| BUG-015 | Multi-touch harness could not observe the game | **RESOLVED** — see 15a-15d below |
| BUG-016 | Boot observability | Medium | Fixed, verified |
| BUG-017 | Touch layer read `window.G`, which nothing sets | **High** | Fixed, verified |
| BUG-018 | Synthesized keys never released — permanent jump | **High** | Fixed, verified |
| BUG-019 | Back button always exited the app | Medium | Fixed; device check outstanding |
| BUG-020 | Camera never turned — look hand-off dropped every delta | **High** | Fixed, verified |
| BUG-021 | A finger on a button could not turn the camera | **High** | Fixed, verified |
| BUG-022 | Desktop key/mouse hints shown in a touch-only app | Medium | Fixed, verified |
| BUG-023 | Oversized button labels and awkward cluster layout | Usability | Implemented; open to tuning |
| BUG-024 | Desktop prompt rows and the menu blurb | Removal | Fixed, verified |
| BUG-025 | NEXT RANK overflowed the profile panel | Medium | Fixed, verified |
| BUG-026 | Settings help described a hidden row | Low | Fixed, verified |
| BUG-027 | Custom button layout editor | Feature | Implemented, verified |
| BUG-028 | layout() threw before its state existed | **High** | Fixed, verified |

19 defects found and fixed during this port. One item remains open: the frame-rate target
(BUG-013). The multi-touch assertion is now **verified** — see 15d.

## BUG-015 — final resolution

The multi-touch assertion took six investigation rounds and turned out to contain **three
real defects plus one harness defect**. All are fixed; the assertion now passes.

### 15d — the assertion now passes

Driven from the page world, with four pointers held while the match was genuinely playing
(`mode:"match"`, controls topmost):

```
drive-arm    mode:"match"  matchState:"playing"  hitStickCentre:"cb-stick-pad"  hitFire:"cb-fire"
[HOLD-0..15] live=4  touchPtrs=4  stick=(-0.001,-0.545)  move=(0.001, 0, 0.5)  fire=True  jump=True
[RELEASED-ALL] live=0
[SETTLE-0..6]  live=0  move=(0,0,0)  fire=False  jump=False
```

| Requirement | Pointer | Read from the game itself |
|---|---|---|
| Move + camera + fire simultaneously | 101 (pad) + 102 (canvas) + 103 (`cb-fire`) | `move=(0.001, 0, 0.5)`, `fire=True` |
| Move + camera + fire + jump | + 104 (`cb-jump`) | `jump=True` |
| No stuck joystick / button / leaked pointer | all released | `live=0`, `move=(0,0,0)`, `fire=False`, `jump=False` |
| Values read from the real game state | — | `G.input` and `match.local.intent`, via a page-world observer |

`lastDevice:"touch"` and `padIsTouch:true` are read **out of the game's own `Input` object**,
which is direct evidence that the patched seams (`pollTouch()`, the synthetic pad) are the
things feeding the game — not an assumption about them.

Two harness faults were also fixed along the way and are worth recording because they each
produced convincing false negatives: dispatching synthetic pointers at a **hidden** overlay
(so `elementFromPoint` returned the canvas or `#fade` instead of the controls), and gating the
driver on `match.state === 'playing'` when the touch layer gates on `G.mode === 'match'` —
those two are not the same moment, and the driver fired into the 40-second transition window
where the screen is fading and nothing is hittable.

## BUG-020 — The camera never turned: the look hand-off dropped every delta (real, fixed)

| Field | Value |
|---|---|
| Severity | **High** — reported by the user as "I cannot turn the view" |
| Symptom | Dragging on screen rotated nothing. `rig.yaw` stayed exactly 0 for an entire match. |

**How it was isolated.** A page-world tracer was imported into `player.js` (page code, so it
sees the game's own scope) and the seams were sampled on both sides:

```
input.js endFrame      lookX: 0        <- on EVERY frame
mdx/mdy                0               <- 568 playing samples, not one non-zero
enabled / matchState   true / playing  <- so the controller was running and not early-returning
touchLookX (harness)   102             <- yet the accumulator demonstrably held the drag
rig.yaw                0
```

The delta existed in the touch layer and read as zero where it was consumed. `pollTouch()`'s
`if (t.lookX || t.lookY)` branch never executed at all, so `mouse.dx` was never written.

**Fix.** Two coordinated changes, rather than continuing to chase why the cross-seam read
disagreed:

1. `src/game/player.js` consumes the delta **at the point of use** — it reads
   `window.__cbTouch.lookX/lookY` and folds it into the same locals the mouse path uses
   (`mdx`/`mdy`), then clears them. Reading it where it is needed means no frame boundary can
   wipe the value first.
2. `android/touch.js` **no longer clears** `lookX/lookY` in `__cbTouchEndFrame`. That reset ran
   on a frame boundary between the write and the read, which is the most likely original
   defect: the accumulator held 102 while the consumer saw 0.

**Files changed.** `src/game/player.js` (patches C8, C9), `android/touch.js`

**Validation** (measured with the page-world test observer, on the **release** build):

| Phase | yaw | dYaw |
|---|---|---|
| `look-0-before` | 0 | — |
| `look-1-bare-drag` | -1.7136 | **-1.7136** (≈98°) |
| `look-3-drag-while-firing` | -3.4272 | **-1.7136**, with `fireStillHeld: true` |

**Status:** Fixed and verified.

---

## BUG-021 — A finger on a button could not turn the camera (real, fixed)

| Field | Value |
|---|---|
| Severity | High — reported as "firing should still let me turn the view" |
| Root cause | `onDown` gives a pointer that lands on a button to that button and **returns**, so it can never become the look pointer. With the thumb resting on FIRE there was no free surface left to aim with. |

**Fix.** Two changes in `android/touch.js`:

1. An **AIM latch** (`cb-look`, top-left, beside the stick). While it is on, a drag *anywhere*
   on screen turns the camera — including drags that start on top of another button. The pointer
   that switches it on only sets the reference point, so the toggle tap itself never jerks the
   view. This is the standard mobile-shooter arrangement.
2. When the finger owning the look drag lifts while another is still down, the drag is **handed
   to that pointer** instead of being dropped.

**Validation.** `look-3-drag-while-firing`: `dYaw: -1.7136` with `fireStillHeld: true` — the same
rotation as a bare drag, achieved while FIRE was held.

**Status:** Fixed and verified.

---

## BUG-022 — Desktop input hints shown in a touch-only app (real, fixed)

| Field | Value |
|---|---|
| Severity | Medium — reported by the user; the first thing a player sees advertised a keyboard |
| Symptom | Keycaps and mouse drawings throughout: `TAB MAP`, `READY! F`, `Esc`, `Enter`, `LMB`/`RMB`, and the title screen's "PRESS ANY KEY / or click to start". |

**Fix.** Every one of these funnels through two renderers in `src/ui/ui-icons.js`, so both were
neutralised instead of editing ~20 call sites:

- `keycap(k)` returns `''` (patch D1) — covers "TAB MAP" → "MAP" and "READY! [F]" → "READY!"
- `mouseGlyph()` returns `''` (patch D2) — the mouse drawing is a desktop affordance
- `styles/ui.css` hides the now-empty wrappers and the separators that sat between two keycaps,
  so no stray "or" or "/" is left behind (patch D3)
- the title screen reads **"TAP TO START"** with the "or click to start" line removed, and the
  `onInputMode` handler was updated too so plugging in a controller cannot reintroduce
  "PRESS ANY KEY" (patches D4, D5)
- the two mouse-only settings rows ("Mouse sensitivity", "Aim assist for mouse") are hidden
  (patch D6)

`richText()` needed no change: it expands `[SHIFT]` / `[LMB]` by delegating to the two
renderers, so it was covered automatically.

**Note on D6.** The first attempt hid those rows with `[data-key="sensitivity"]`, which matches
nothing — settings rows are identified by a JS property (`menus.js:2111 row._key = r.key`), not
an attribute. Corrected to a positional selector on the direct children of `.iw-rows`, which is
documented in the patch as brittle if upstream reorders the row table.

**Files changed.** `src/ui/ui-icons.js` (D1, D2), `styles/ui.css` (D3, D6), `src/ui/menus.js`
(D4, D5)

**Validation.** Screenshots on the running release build:

| Screen | Before | After |
|---|---|---|
| Title | "PRESS ANY KEY" / "or click to start" | **"TAP TO START"** |
| What's New card | `CONTINUE` with an `Enter` keycap | **"CONTINUE ›"** |
| Main menu footer | `Esc` keycap | **"Select  Title"** |
| In-match HUD | `TAB MAP`, `READY! F` | **"MAP"**, no keycaps |

**Status:** Fixed and verified.

---

## BUG-023 — Control cluster: oversized labels and an awkward layout (usability, fixed)

Reported by the user as "the text on the buttons is too big, put it small underneath" and "the
layout is odd, copy the battle-royale arrangement".

**Fix.** `android/touch.js` was reorganised around the mobile-shooter convention:

- Each control is now a **glyph disc with a small caption underneath** (9 px, semi-transparent)
  instead of a full word shrunk to fit inside a small circle.
- Layout: movement stick bottom-left; **FIRE** as the largest disc bottom-right under the right
  thumb; JUMP / SQUID / SUB arced around it; SPECIAL above; AIM top-left; MAP and PAUSE small and
  dim in the top-right corner, out of the thumb arc.
- Disc sizes are a percentage of the **shorter screen edge**, so they hold their proportion
  across aspect ratios instead of drifting with the viewport height.
- `layout()` now positions the discs too, so a rotation or a WebView resize re-lays the cluster
  out instead of leaving buttons at stale coordinates.

**Files changed.** `app/src/main/assets/game/android/touch.js`

**Status:** Implemented and observed in screenshots. The arrangement is a judgement call, so it
is explicitly open to further tuning from the user; the coordinates are a plain table at the top
of `touch.js` and cheap to adjust.

---

## BUG-024 — Desktop prompt rows and the menu blurb (removal, verified)

Requested: remove the bottom-right hint row (`Skip`, `Select`, `Move`, `Title`, `Adjust`,
`Tabs`, `Back`) and the bottom-left blurb ("Turf War or Zone Control …").

| Field | Value |
|---|---|
| Root cause (prompts) | Every one of those labels is built by `menus.js` `_prompts()` / `_hint()` (menus.js:790-798) into `.iw-prompts` / `.iw-hint`, and appear on nearly every screen (`menus.js:936, 1019, 1348, 1557, 2170, 2284, 2316, 3816, 3876, 4117`). |
| Root cause (blurb) | `MENU_DESC` (menus.js:159) feeds `.iw-main__desc`, which is `position: absolute` and merely **faded** when nothing is focused (ui.css:766) — which is why it stayed faintly readable rather than disappearing. |
| Fix | Patch E1 hides `.iw-prompts`, `.iw-hint`, `.iw-tabs__hint`, `.iw-lbtn__key`, `.iw-btn__key`; patch E2 hides `.iw-main__desc`. Hiding the two builders also covers the per-widget hints (back button, tab strip, ready button, room-code copy chip, loadout shuffle key). |

**Validation.** Main-menu screenshot: the bottom-right row is gone and the blurb is gone — only
`v1.0.0` remains bottom-left. In-match HUD screenshot: no prompt row.

**Status:** Fixed and verified.

---

## BUG-025 — NEXT RANK overflowed the profile panel (real, fixed)

| Field | Value |
|---|---|
| Severity | Medium — reported by the user as "NEXT RANK goes outside the profile box" |
| Root cause | `.iw-profile` is a two-column grid (`ui.css:326 grid-template-columns: auto 1fr`), and every other full-width child sets `grid-column: 1 / -1` — `.iw-profile__xp` (ui.css:336) and `.iw-profile__stats` (ui.css:338). `.iw-profile__next` (built at menus.js:920) sets **no** grid-column, so the badge was laid into a single narrow column and pushed past the panel. |
| Fix | Patch E3: `.iw-profile__next { grid-column: 1 / -1; min-width: 0; flex-wrap: wrap; }` plus `white-space: nowrap` on its inner label and value. |

**Validation.** Main-menu screenshot: the `NEXT RANK / LV 5` badge now sits inside the panel
with no bleed.

**Status:** Fixed and verified.

---

## BUG-026 — Settings help panel described a row that is hidden (real, fixed)

| Field | Value |
|---|---|
| Severity | Low, but user-visible and confusing |
| Symptom | On Settings > Controls the help panel read "Mouse sensitivity / How far the camera turns for each bit of mouse movement" — a control that BUG-022's D6 had already hidden. |
| Root cause | The screen picks its initial focus with `rowsEl.querySelector('[data-nav]')` (menus.js:2185). `querySelector` returns the first match **in DOM order regardless of CSS visibility**, so it selected the hidden first row and the panel described it. |
| Fix | Patch E6: select the first row with `offsetParent !== null`, matching the filter the menus already use for navigation (menus.js:652). |

**Status:** Fixed; verified that the Controls tab now lists only its visible rows
(`Controller sensitivity`, `Invert vertical look`, `Aim assist (controller)`,
`Controls reference`, `Custom button layout`).

---

## BUG-027 — Custom button layout editor (feature, implemented)

Requested: "在设置里添加自定义操作按键位置".

| Field | Value |
|---|---|
| Severity | Feature |
| Implementation | Lives in `android/touch.js`, which already owns the controls, so no game UI needed rewriting. |
| Entry points | Settings > Controls > **Custom button layout** (new `_layout` link row, patch E4, dispatched by patch E5 — every link row otherwise hard-codes `_go('howto')` at menus.js:2099), **and** a 3-second long-press on the AIM button as a shortcut that avoids walking the menus. |
| Editing | In edit mode every control becomes a drag handle (taps are not actuated), the grabbed disc is ringed, the stick and AIM dim, and a bar appears with **RESET** / **DONE** plus a live `id x,y` readout for every control. |
| Persistence | Positions are stored as viewport percentages in `localStorage['colorbrawl.layout']`, so they survive a restart and follow the screen through rotation and resolution changes. Defaults come from the `BUTTONS` table, so only moved controls are stored. |
| Bounds | A disc cannot be dragged fully off screen — the clamp keeps at least its own radius inside the viewport, so no control can be lost. |

**Validation.** Long-press on AIM during a live match opened the editor; screenshot shows the
bar, the dashed outlines, and the readout:
`fire 86,62 / jump 63,74 / squid 74,90 / sub 69,51 / special 88,33 / map 93,10 / pause 98,10 / look 16,10`.

**Status:** Implemented and verified on the release build. The default arrangement is still a
judgement call the user may want to tune — the table is at the top of `touch.js`.

---

## BUG-028 — `layout()` threw before its state existed (real, fixed)

| Field | Value |
|---|---|
| Severity | High — an uncaught exception on every launch |
| Symptom | `Uncaught TypeError: Cannot read properties of undefined (reading 'fire')` from `touch.js`, thrown by `layout()` -> `posOf()`. |
| Root cause | `posOf()` indexes the layout override table with the button id (`layoutOverride[b.id]`, and `b.id` for the first entry is `'fire'`). The table is initialised further down the module, and `layout()` is reachable before that on some paths, so the index was applied to `undefined`. The error message names `'fire'` — the **property being read**, not a variable a reader would search for — which is what made it look like it came from `releaseAll()`'s `state[id]` loop. |
| Fix | `posOf()` reads `(layoutOverride || {})[b.id]`, and `setEditMode()` returns early until `mounted` is true (it calls `releaseAll()`, which touches pointer state). Both are commented with the reason. |

**Status:** Fixed and verified — zero uncaught errors across the title, main menu, Settings and
a live match.

---

## BUG-029 — Default control layout replaced with the tuned one (change, verified)

The user repositioned the controls by hand and asked for that arrangement to become the default.

**How the values were obtained.** `run-as` refuses the release build
(`package not debuggable`), and reinstalling a debuggable build would have risked clearing the
data being read. `MainActivity` enables `WebView.setWebContentsDebuggingEnabled(true)`, so the
Chrome DevTools protocol was used instead: `adb forward` to
`localabstract:webview_devtools_remote_<pid>`, then `Runtime.evaluate` against the page. That
read back, unmodified:

```json
{"fire":{"x":84.04,"y":69.91},"squid":{"x":76.29,"y":83.81},"jump":{"x":73.45,"y":64.94},
 "sub":{"x":79.68,"y":41.82},"special":{"x":88.5,"y":40.4},"map":{"x":89.87,"y":23.03}}
```

`pause` and `look` were not moved and keep their previous values.

**A problem this exposed.** A stored override in `localStorage` *shadows* the defaults, so
baking new defaults in would have had **no effect on any device that had ever opened the
editor** — including the user's. That is silent and would have looked like the change was
ignored.

**Fix.** `LAYOUT_VERSION` (now 2) plus `localStorage['colorbrawl.layoutVersion']`. On a version
mismatch the stored override is dropped once and the new defaults take effect; the player's next
edit is then stored and kept as normal. Without this, defaults could never be changed again.

**Validation** on a clean install of the delivered APK, positions measured from the live DOM:

| Control | Baked default | Measured live |
|---|---|---|
| fire | 84.04, 69.91 | **84.04, 69.91** |
| jump | 73.45, 64.94 | **73.45, 64.94** |
| squid | 76.29, 83.81 | **76.29, 83.81** |
| sub | 79.68, 41.82 | **79.68, 41.82** |
| special | 88.5, 40.4 | **88.5, 40.4** |
| map | 89.87, 23.03 | **89.87, 23.03** |
| pause | 97.5, 10 (unchanged) | 97.5, 10 |
| look | 15.5, 10 (unchanged) | 15.5, 10 |

with `layoutVersion: 2` and `colorbrawl.layout: null`, confirming the migration ran and the
positions come from the new defaults rather than a leftover override.

**Files changed.** `app/src/main/assets/game/android/touch.js`

**Status:** Done and verified. Layout remains editable from Settings > Controls.

---

## BUG-030 — Three graphics tiers and two frame-rate tiers (change, verified)

Requested: 画质三档（标清/高清/超清）and 帧率两档（60/120 Hz）.

| Field | Value |
|---|---|
| Quality | `ui/menus.js:180` offered four presets (`low/medium/high/ultra`). Now three: **SD / HD / UHD** = 标清 / 高清 / 超清, mapped to the `low` / `medium` / `high` presets. Labels stay short because they sit inside a segmented control, and the rest of the UI is English. |
| Retired preset | `ultra` (pixelRatio 2.0) is strictly heavier than `high` with no visual gain on a phone panel, so it is no longer offered. A device that has it stored is folded **up** into `high`. |
| Frame rate | `ui/menus.js:185` offered `Max / 60 / 30`. Now two: **60 Hz / 120 Hz**. No engine change was needed — the limiter is `ts - _lastTs < 1000 / cap - 2` (`main.js:1052-1053`), so any numeric cap works. |

**A real bug this introduced, caught by reading the two patches together.** `F3` folds a stored
`'ultra'` into `'high'`, and the pre-existing Android migration then saw
`quality === 'high' && !__qualityMigrated` — and rewrote it to the fresh-install default
(`'medium'`). A player who had deliberately chosen the heaviest preset would have silently
dropped **two** tiers.

**A second wrong attempt, also caught.** The first fix keyed off a `settings.__shown.quality`
marker, on the assumption that the settings UI stamps one when the player touches a control.
It does not: `_setSetting` (menus.js) only forwards the value, and no
`__shown` / `touched` / `userSet` channel exists anywhere in `main.js` or `menus.js`. That check
would have become dead code.

**Final fix** uses only state that genuinely exists. `__qualityMigrated` is written by this
migration itself, so its presence means a previous build already applied the Android default:

| Stored state | Result | Why |
|---|---|---|
| `ultra`, migrated or not | **`high`** | retired preset folded up, and flagged so it cannot be demoted |
| `high`, never migrated | `medium` | first Android launch on the untouched shipped default |
| `high`, already migrated | `high` | a deliberate later choice |
| `low` / `medium` | unchanged | deliberate choices |

**Validation.** The migration was unit-tested directly against the shipped function — all six
cases pass:

```
PASS  ultra, never migrated (retired preset)      {"quality":"ultra"} -> high   (want high)
PASS  ultra, already migrated                     -> high   (want high)
PASS  high, never migrated (fresh install)        -> medium (want medium)
PASS  high, already migrated (chosen later)       -> high   (want high)
PASS  medium (deliberate)                         -> medium (want medium)
PASS  low (deliberate)                            -> low    (want low)
```

Live DOM on the release build, with the panel's first and last rows hidden by the earlier D6
rule:

```
0 "Graphics quality" display=none  opts=[SD|HD|UHD]      <- exactly three tiers
5 "Frame rate"       display=flex  opts=[60 Hz|120 Hz]   <- exactly two
```

and the running game reports `settings.quality = "medium"` (the Android default) with zero
uncaught errors.

**Note on the 120 Hz option.** It is present and functional, but the test emulator's panel is
60 Hz, so the *effect* of selecting it could not be measured here. On a 120 Hz device it raises
the cap and `_frameTarget()` paces against it.

**Files changed.** `src/ui/menus.js` (F1, F2, F4), `src/config.js` (F3 + the migration rewrite)

**Status:** Done and verified, except the on-device effect of 120 Hz (needs a 120 Hz panel).

---

## BUG-031 — Controls showed during the countdown and lingered over the results (real, fixed)

Requested: "操作按键在显示 GO 之后显示，游戏结束要立马消失."

| Field | Value |
|---|---|
| Severity | Medium — the cluster covered the intro and the results screen |
| Root cause | The gate was `G.mode === 'match'`, which is true for the **whole match session** — intro, playing, finish, judge and results. Nothing distinguished a live round from a finished one. |

**The state machine** (verified in `src/game/match.js`):

```
setState('init')                                    line 24
  -> 'intro'   (or 'playing' directly for attract/practice)   line 150
  -> 'playing' once stateT > 4.2   (the READY?/GO! countdown)  line 193
  -> 'finish'  when the clock reaches 0                        line 211
  -> 'judge'                                                   lines 259/265/272
  -> 'results'
```

and the game's own `pause()` (`main.js:875-899`) runs only from `playing`/`intro`, sets
`match.paused = true`, and disables the controller — leaving `state` as `'playing'`.

**Fix.** Gate on the live round instead of the session: show only when
`state === 'playing' && !paused`, with the pause menu as the one exception (so the player can
unpause by touch). Everything else — intro, finish, judge, results — hides it.

**Validation.** Two independent checks.

*A real round, end to end* (visibility read from the live DOM):

```
PASS  live round              state=playing  attract=false  time=24  overlay SHOWN
PASS  after the round ended   state=finish   attract=false  time=0   overlay hidden
```

*Every state, driven through the game's own `setState()`:*

| State | Overlay |
|---|---|
| `playing`, live round | **SHOWN** |
| `intro` (READY?/GO!) | hidden |
| `playing` but paused | hidden |
| `finish` | hidden |
| `judge` | hidden |
| `results` (menu stack open) | hidden |

**A note on the test harness, because it produced two false failures.** Forcing
`setState('playing')` first reported the overlay as hidden. The cause was the harness, not the
code: the previously-opened results screen was still on the menu stack (`stack: ["results"]`),
and the gate was correctly refusing to show game controls underneath a front-end screen. Two
earlier "failures" in this work had the same shape — a bad assertion (`display` is `block`, not
the string `shown`) and an attract-loop match (`attract:true`, `duration:99999`) whose state is
also `'playing'`. Each was diagnosed from the live DOM rather than by adjusting the expectation.

**Files changed.** `app/src/main/assets/game/android/touch.js`

**Status:** Fixed and verified. One caveat: the 4.2 s intro window is too short to catch in a
screenshot reliably, so the intro row above comes from driving the state machine directly rather
than from a captured frame.

---

## BUG-032 — A swipe snapped the camera instead of turning it (real, fixed)

Reported from the user's own Redmi (Dimensity 7200 Ultra): "转视角不能很流畅的滑动，往左划一下只是视角瞬了过去".

| Field | Value |
|---|---|
| Severity | **High** — the core control felt broken |
| Root cause | Pointer events are banked and the render frame spent **the entire bank at once**. `touch.js` adds every `pointermove` to a running total; `player.js` read that total and zeroed it once per frame. A phone digitiser emits `pointermove` at 120–240 Hz, often in coalesced bursts, while the renderer runs at 30–60 fps under load. Every event landing between two frames was banked, then applied in a single frame — so a steady drag arrived as one instantaneous rotation. |

This is **not** the same defect as BUG-020/021. There the delta was dropped; here it is delivered
correctly, just all at once.

**Fix.** Spend at most a fixed budget (34 CSS px) of the banked drag per frame and carry the
remainder to the following frames. The clamp is on the **magnitude** of the (x, y) vector, not per
axis, so a diagonal drag keeps its direction.

**Validation** (release build, one 340 px drag banked = 10× the per-frame budget):

```
bank=340 → yaw  0
bank=306 → yaw -0.0714     34 px spent
bank=272 → yaw -0.1428     34 px spent
bank=238 → yaw -0.2142
bank=204 → yaw -0.2856
bank=102 → yaw -0.4998
bank= 34 → yaw -0.6426
bank=  0 → yaw -0.7140     total preserved (340 × 3 × 0.0021 = 0.714 rad)
```

The bank drains 34 px at a time instead of collapsing in one frame, and the **total rotation over
the gesture is unchanged** — it is spread over ~7 frames, not reduced.

---

## BUG-033 — Performance on a mid-range phone (change, verified as far as this machine allows)

Reported: "整体游戏特别卡顿", Redmi / Dimensity 7200 Ultra.

**What was measured, not assumed.** The renderer caps density with
`Math.min(window.devicePixelRatio, q.pixelRatio)` (`renderer.js:115`). The phone reports DPR ≈ 2.75,
so at the shipped `medium` preset the effective density was already 1.0 — resolution was *not* the
problem. The expensive parts were elsewhere:

| Change | Before | After | Why |
|---|---|---|---|
| Ink ripple loop | 24 iterations | **12 on mobile** | `inkShading.js` runs `for (i < INK_RIPPLES)` **per inked fragment**, with dynamic indexing into two `uniform vec4` arrays. That is the single most expensive shader cost on a tile-based GPU, and the `continue` guards do not save it — the loop still executes. |
| `medium` MSAA | 2 | **0** | MSAA on a tiled GPU forces a resolve of the whole framebuffer every frame. |
| `medium` shadows | 2048² | **1024²** | Quarters the shadow-map raster work. |
| `medium` paint atlas | 2048² | **1024²** | Every splat is a quad drawn into this target; halving the edge quarters the fill cost. |
| `low` tier | shadow 1024, atlas 2048 | **512 / 1024** | Made SD a real step down. |
| `fpsCap` default | 0 (follow the display) | **60 Hz** | `_frameTarget()` returns the display's refresh unless capped lower, and `_dynRes()` shrinks the render scale whenever a 4 s window misses it. On a 120 Hz panel the target was 8.3 ms — unreachable for this class of device, so the game fought its own dynamic-resolution loop all match. |

**Honest limit:** this machine's emulator measures 60 Hz only and is **not** a reliable benchmark
(same config previously measured both 46 ms and 65 ms median). The 120 Hz target, the real GPU cost
of the ink shader, and the resulting frame rate **can only be confirmed on the phone**. These
changes reduce known-heavy work; they are not a measured fps claim.

---

## BUG-034 — Ground ink did not show on the phone (NOT fixed — diagnosis incomplete)

Reported: "我喷在地上的颜料不显示".

**What was ruled out, with evidence:**

- `paintAtlas` is correctly wired through (`main.js:252` → `PaintSystem`), and the phone runs
  `medium` → 2048², which is the **same value the emulator uses, where ink renders fine**. So atlas
  size is not the cause.
- The atlas is plain `UnsignedByteType` / `RGBAFormat` with mipmaps (`paint.js:351-355`) — no float
  format, no extension requirement.
- The shader's `dFdx`/`dFdy`/`fwidth`/`textureLod` are all core in WebGL2 (GLSL ES 3.00), so they
  need no extension either.

**What was changed anyway**, because it is a plausible contributor and a win regardless: the
per-fragment ripple loop was reduced (see BUG-033). A fragment shader that is too slow can render
as missing or visibly broken ink on some mobile drivers.

**Status: NOT fixed.** Three candidate causes remain and none can be distinguished without the
device:

1. a shader precision/compile difference on the Mali-class GPU,
2. the atlas render target failing or being cleared on that driver,
3. a depth/ordering issue specific to the ground pass.

The app already ships the diagnostics needed to settle it: install the **debug** build, launch it
with `?mttest=1` (`--ez cb_mttest true`), and `logcat` carries the page-world observer output plus
any shader warnings. Reporting this as fixed without that evidence would be a fabrication.

---

## Note on a recurring defect class

The same mistake — using a `var` before the statement that initialises it — occurred **twice**
in this port, in two different files:

| Instance | Variable | Effect |
|---|---|---|
| BUG-003 | `geom` | `layout()` threw on every launch; the whole touch layer died |
| BUG-015a | `forceVisible`, `diagVisibility` | the flag silently read `false` after its first tick |

In both cases `var` hoisting made the identifier *exist* while holding `undefined`/a global,
so the failure was silent rather than a `ReferenceError`. Any further work on
`android/touch.js` should keep state declarations above the code that touches them; the
`?mttest` block is at the end of the file for exactly this reason.
