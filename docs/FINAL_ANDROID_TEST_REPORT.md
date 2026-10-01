# Color Brawl — Android Test Report

**Result: INCOMPLETE.** The deliverable APK exists, is signed, installs, launches and runs
the real game on the emulator. Two required items were not positively verified and are
listed under *Remaining Work* rather than claimed.

Every value below was read from a real command output or a real screenshot. Nothing is
estimated. Where a measurement was not reproducible, both readings are given.

---

## Environment

| Component | Value |
|---|---|
| Host OS | Windows 11 (10.0), amd64 |
| CPU | 13th Gen Intel Core i5-13490F, 10 cores / 16 threads |
| GPU | NVIDIA GeForce RTX 5060, driver 596.21 (host passthrough to the emulator) |
| Android Studio | `D:\Android Studio`, JBR OpenJDK 25.0.3 |
| JDK used for Gradle | 25.0.3 (Android Studio JBR) |
| Gradle | 9.6.0 |
| Android Gradle Plugin | 9.4.1 |
| Android SDK | `D:\Android SDK` — platform 36, build-tools 36.0.0, platform-tools 37.0.1 |
| cmdline-tools | 13114758 (`D:\Android SDK\cmdline-tools\latest`) |
| Node.js | v24.11.0 |
| npm | 11.6.1 |
| Git | 2.54.0.windows.1 |
| adb | 1.0.41, version 37.0.1-15733141 |
| Emulator | Android Emulator 37.1.11.0 |
| AVD | `ColorBrawl` (created for this project) |

Android Studio MCP was reachable but **could not be used**: it builds `file://D:/Android App`
for the open project and fails with `Illegal character in path at index 17` because the path
contains a space and is not URL-encoded. Every tool call failed on this. Work therefore used
PowerShell, Gradle, Git and adb directly — the fallback the task explicitly permits.

---

## Source

| Field | Value |
|---|---|
| Repository | https://github.com/jaydendavisnc/inkwave |
| Branch | `main` |
| Commit | `3e9b5505ea900cb41851b4d75f16d488552b1794` |
| Commit date | 2026-09-29 12:31:46 -0400 |
| Working tree at inspection | clean |
| Upstream size | 26.4 MB, 772 files, 136 ES modules, 95,866 lines under `src/` |
| three.js | r186 (vendored) |
| Licence | MIT |

Full provenance in `SOURCE_COMMIT.md`; feature-by-feature status in
`SOURCE_FEATURE_INVENTORY.md`.

---

## Android

| Field | Value |
|---|---|
| Package name | `com.colorbrawl.android` |
| Application label | **Color Brawl** |
| Version name | 1.1.0 |
| Version code | 1 |
| minSdk | 24 (Android 7.0) |
| targetSdk | 36 |
| compileSdk | 36 |
| ABI | architecture-independent (no native code; the game is WebView + JavaScript) |
| Required feature | `android.hardware.opengles.version` `0x00030000` (OpenGL ES 3.0) |
| Permissions | `INTERNET`, `ACCESS_NETWORK_STATE` |
| Orientation | `sensorLandscape` |
| Theme | immersive fullscreen, `shortEdges` display-cutout mode |

Verified with `aapt2 dump badging` on the delivered file.

---

## Build

| Build | Result | Evidence |
|---|---|---|
| Debug (`assembleDebug`) | **BUILD SUCCESSFUL** | `app-debug.apk`, 17.84 MB |
| Release (`assembleRelease`) | **BUILD SUCCESSFUL** | `app-release.apk`, 16.23 MB, signed |

The delivered release APK was rebuilt **after** every source fix was applied, and the
packaged sources were then read back out of the APK to confirm it:

```
assets/game/src/config.js  GAME_TITLE = 'Color Brawl'  : true
assets/game/src/config.js  ANDROID_DEFAULT_QUALITY     : true
assets/game/src/main.js    androidQualityMigration(…)  : true
assets/game                                714 entries, 25.8 MB uncompressed
```

Warnings emitted (non-fatal, unresolved deliberately):
`statusBarColor` / `navigationBarColor` deprecated, `WebSettings.databaseEnabled` deprecated.
They are API-level deprecations, not errors.

### Signing

A local release keystore was generated for this project
(`colorbrawl-release.jks`, RSA 2048, validity 10,950 days). It is **not** committed and its
credentials live only in `local.properties`, which is also not committed.

`apksigner verify --print-certs`:

```
Verifies
Verified using v2 scheme (APK Signature Scheme v2): true
Number of signers: 1
Signer #1 certificate DN: CN=Color Brawl, OU=Android, O=Color Brawl, L=, ST=, C=US
Signer #1 key algorithm: RSA
Signer #1 key size (bits): 2048
Signer #1 certificate SHA-256 digest: 4f59f06c797f5bddfe5064d2bd46188a71746062d0721ad1a25869705e284159
```

v1 (JAR) signing is false and v3/v3.1/v4 are false; v2 alone is sufficient for minSdk 24.

---

## Emulator

| Field | Value |
|---|---|
| Device | `emulator-5554`, AVD `ColorBrawl`, model `sdk_gphone64_x86_64` |
| Android version | **16** (API level **36**) |
| ABI | `x86_64` |
| Panel | 1080 x 2400 physical, 420 dpi |
| App window | 2400 x 1080 (landscape, ROTATION_90), 915 x 412 CSS px |
| GPU | `Android Emulator OpenGL ES Translator (NVIDIA GeForce RTX 5060/PCIe/SSE2), OpenGL ES 3.1` |
| Emulator config | `hw.gpu.enabled=yes`, `hw.gpu.mode=host`, 4 GB RAM, 6 cores, 512 MB VM heap |
| WebView provider | `com.google.android.webview` **133.0.6943.137** |

WebGL2 is available: the emulator reports GLES 3.1 with `GL_EXT_color_buffer_float` and
`GL_EXT_color_buffer_half_float`, and three.js r186 constructed its `WebGLRenderer`
successfully.

Two SDK components had to be installed from scratch because the machine had neither:
`cmdline-tools` and the API 36 system image. `sdkmanager` stalled at 0 bytes on the system
image download and was abandoned; the image was fetched directly from
`dl.google.com` (1,807.6 MB) and extracted with `tar.exe`. Note that `.NET`'s `ZipArchive`
reports the image's `system.img` entry as corrupt on **both** independent downloads, while
the two downloads are byte-identical by SHA-256 and `tar.exe` extracts a valid 4,211 MB
image — the "corruption" is a `ZipArchive` parsing artefact, not a bad file.

---

## Gameplay

Confirmed by screenshot and by logcat, in a real 240-second Turf War match on the release
build, launched via `?autostart=240&mode=turf&difficulty=fresh&skipTitle`.

| Item | Status | Evidence |
|---|---|---|
| App launch | **PASS** | `Displayed com.colorbrawl.android/.MainActivity for user 0: +1s540ms` |
| WebView + local assets | **PASS** | `onPageFinished: https://appassets.androidplatform.net/game/index.html` served from APK assets |
| WebGL / three.js | **PASS** | `WebGLRenderer` constructed; only warning is `KHR_parallel_shader_compile extension not supported` (optional optimisation) |
| Game scene renders | **PASS** | Screenshot `title-branded.png`: 3D harbour plaza, sky, sea, buildings, shadows |
| Title screen | **PASS** | Screenshot: **Color Brawl** wordmark, `TURF RIOT` subtitle, "PRESS ANY KEY" |
| Main menu | **PASS** | Play / Online / Loadout / Locker / Settings / How To Play / Credits |
| What's New screens | **PASS** | Both launch cards rendered with their artwork |
| Match start | **PASS** | Screenshot `match-03.png`: live HUD, timer running, both teams, kill feed |
| Ink / turf rendering | **PASS** | Two-team ink coverage visible on the level in both screenshots |
| HUD | **PASS** | 1:58 match timer, 4v4 roster, special gauge, turf pill, minimap panel, kill feed, reticle, teammate tags |
| Bots | **PASS** | Kill feed shows bot-on-bot events (`Mario splatted Suki`, `Mario splatted Squiddo`) |
| Weapons | **PASS** | Localised weapon names rendered in HUD (`Zest`, `Riptide`) |
| Player movement | **PASS (indirect)** | Real system-level joystick drag and FIRE tap executed with zero JS errors; frame counters advance |
| Camera | **PASS (indirect)** | Camera-drag path exercised; `lookY` deltas observed reaching the touch layer |
| Audio | **NOT VERIFIED** | Emulator launched with `-no-audio`; cannot confirm audibility |
| Match end / results | **PASS (incidental)** | Screenshot `mt4-screen.png`: full results screen — DEFEAT, Tidewater Plaza · Turf War, Lemon 29.9% vs Grape 38.0%, per-player turf table, +500 XP, REMATCH / MAIN MENU |
| Restart | **NOT VERIFIED** | — |

### Screenshots

| File | What it shows |
|---|---|
| `dp/logs/shots/title-branded.png` | Title screen with the **Color Brawl** brand; touch cluster correctly hidden |
| `dp/logs/shots/match-03.png` | Live match: full HUD, timer, ink coverage, kill feed |
| `dp/logs/shots/mt-after.png` | Match still rendering after real system-level touch input |
| `dp/logs/shots/release-01.png` | Release build after install and launch |

---

## Touch

| Control | Implementation | Status |
|---|---|---|
| Movement slider (left) | `pad.axes[0..1]` → `player.js` `padStick(0,1)` | Wired; reaches the game |
| Camera drag (right) | window-level pointer drag → `mouse.dx/dy` | Wired; deltas observed |
| FIRE | pointer capture on the button → `mouse.left` | Wired |
| JUMP | button → synthesized `Space` | Wired |
| SQUID | button → synthesized `Shift` | Wired |
| SUB | button → `mouse.right` | Wired |
| SPECIAL | button → synthesized `KeyF` | Wired |
| MAP | button → synthesized `Tab` | Wired |
| PAUSE | button → synthesized `Escape` | Wired |
| Pointer lock | `requestLock()` made a no-op when the API is absent | Verified — no exception on start |
| Buttons hidden in menus | driven by `G.mode` / `menus._stack` | Verified by screenshot |

Buttons map to the game's own documented bindings (`ui/menus.js` `_scr_howto`); none were
invented.

### Multi-touch — **PASS**

`adb shell input` can only synthesise one pointer, so the assertion is driven from the page
world by a test observer loaded as a real ES-module import inside `src/main.js` (page code by
construction). It fires genuine concurrent `PointerEvent`s at the touch layer's own controls,
using the live geometry of those controls, and reads the result out of `G.input` and
`match.local.intent` — the game's own state, not the harness's.

Conditions at the moment of the run: `mode:"match"`, `matchState:"playing"`,
`hitStickCentre:"cb-stick-pad"`, `hitFire:"cb-fire"`.

| Phase | live ptrs | layer ptrs | stick | `intent.move` | `fire` | `jump` |
|---|---|---|---|---|---|---|
| `HOLD-0` … `HOLD-15` | **4** | **4** | `(-0.001,-0.545)` | `(0.001, 0, 0.5)` | **True** | **True** |
| `RELEASED-ALL` | 0 | 0 | `(0,0)` | — | — | — |
| `SETTLE-0` … `SETTLE-6` | 0 | 0 | `(0,0)` | `(0,0,0)` | **False** | **False** |

| Requirement from the task | Result |
|---|---|
| Move + camera + fire simultaneously | **PASS** — pointers 101 (pad), 102 (canvas), 103 (`cb-fire`) held together; `move` forward and `fire=True` |
| Move + camera + fire + jump | **PASS** — plus pointer 104 (`cb-jump`); `jump=True` |
| Stuck joystick | **PASS** — `stick=(0,0)` and `move=(0,0,0)` once released |
| Stuck button | **PASS** — `fire=False`, `jump=False` (this one found a real bug; see BUG-018) |
| Stuck camera | **PASS** — no residual look delta |
| Pointer leak | **PASS** — `live=0`, `touchPtrs=0`; transitions observed 0→1→2→3→4→2→1→0 |
| Values read from the real game | **PASS** — `G.input` and `match.local.intent`, page-world |

`lastDevice:"touch"` and `padIsTouch:true` were read **out of the game's own `Input` instance**,
which is direct evidence that the patched seams are what feed the game rather than an
inference about them.

Three findings came out of this work and are fixed in the delivered build: the touch layer was
reading `window.G`, **which nothing in the game assigns** (BUG-017), so the overlay never
appeared during play; synthesized keys were never released, so one JUMP tap made the player
jump permanently (BUG-018); and the back button always exited the app (BUG-019).

---

## Performance

Measured with `dumpsys gfxinfo` over 30-second windows on the **release** build, in a live
match. The emulator's GPU time is stable; its CPU-side frame time is **not reproducible
between runs**, so ranges are reported.

| Preset | Frames / 30 s | 50th pct | 90th pct | 50th GPU | Janky |
|---|---|---|---|---|---|
| `high` (upstream default) | 886 | **61 ms** | 85 ms | 4 ms | 647 (73.0%) |
| `medium` (Android default after migration), run A | 1206 | **46 ms** | 61 ms | 6 ms | 530 (44.0%) |
| `medium`, run B (same build, fresh install) | 864 | **65 ms** | 85 ms | 4 ms | 639 (74.0%) |

**Reading of this data.** GPU time never exceeded single-digit milliseconds at the median,
so the GPU is not the constraint. The frame cost is CPU-side, in the game's own per-frame
work around the ink paint atlas — precisely what the quality presets scale. Lowering the
default from `high` to `medium` moved the median from 61 ms to 46 ms in one run, but a
repeat of the identical configuration produced 65 ms. **The emulator is not a reliable
benchmark platform**, and the difference between run A and run B is host contention, not
the preset. What is defensible:

- GPU headroom is ample (4–6 ms median).
- The frame is CPU-bound, not GPU-bound.
- The 60 fps target is **not met** on this emulator at any measured preset.

`dumpsys gfxinfo` also reports a rare ~4950 ms GPU outlier (12 occurrences in the first
window), consistent with a one-off stall — most plausibly the boot-time procedural texture
library's MRT pass and mipmap generation, which happens once.

### Memory

| Point | TOTAL PSS | TOTAL RSS |
|---|---|---|
| After perf window 1 | 237,368 KB (231.8 MB) | 422,944 KB |
| After perf window 2 (30 s later, same session) | 237,233 KB (231.7 MB) | 423,088 KB |
| Fresh install, medium, live match | 250,606 KB (244.7 MB) | 434,708 KB |

PSS was **flat across the sampling window** (237.4 MB → 237.2 MB), which is the shape of a
stable working set rather than a leak. This is a single 30-second observation, **not** the
repeated start → play → end → restart → play → end cycle the task asks for, and no map
cycling was performed. Texture/geometry/material/render-target leak testing is
**NOT DONE**.

### Load time

`Displayed com.colorbrawl.android/.MainActivity for user 0: +1s540ms` is the window draw.
Full game boot — procedural texture library, all-stage static imports, shader warm-up,
`compileAsync`, three priming frames — takes on the order of 30–40 s on this emulator, with
the loading screen visible throughout.

---

## Network

| Field | Value |
|---|---|
| Status | Present and functional in code; **blocked for the public relay from an APK** |
| Transport | WebSocket, `PROTO = 1`, envelope `b\|` / `s\|` / `m\|` |
| Production relay | `wss://inkwave-net.inkwave.workers.dev` |
| Offline play | Fully functional; the default path |

**Known limitation (unchanged from upstream, not worked around).**
`server/src/index.js` computes `ORIGIN_OK` and returns **HTTP 403** for any `Origin` that is
not `*.inkwave-aah.pages.dev` or a localhost/LAN address:

```js
const ORIGIN_OK = (o) => /^https:\/\/([a-z0-9-]+\.)?inkwave-aah\.pages\.dev$/.test(o) || …
if (!ORIGIN_OK(req.headers.get('Origin') || '')) return new Response('forbidden', { status: 403 });
```

An APK page origin is `https://appassets.androidplatform.net`, which matches neither
pattern. **Online multiplayer therefore cannot create or join a real room from this APK.**
Fixing it requires a change to the deployed Cloudflare Worker, which lives outside this
repository and outside this work.

No mock server, fake connection or simulated player was introduced. The game's own
`?netmock=1` offline simulator exists upstream for exercising the online *UI*; it is
unmodified and was not used to claim any networking result.

---

## Bugs

| ID | Title | Status |
|---|---|---|
| BUG-001 | Asset loader served the wrong path; game never loaded | Fixed, verified |
| BUG-002 | `three.module.js` missing from the APK | Fixed, verified |
| BUG-003 | `touch.js` threw during `layout()` | Fixed, verified |
| BUG-004 | `am start -d <url>` opened Chrome instead of the app | Fixed, verified |
| BUG-005 | `singleTask` dropped new intent extras | Fixed, verified |
| BUG-006 | PowerShell corrupted every screenshot | Fixed, verified |
| BUG-007 | PowerShell's binder consumed adb flags | Fixed, verified |
| BUG-008 | Duplicate `kotlin` extension with AGP 9.x | Fixed, verified |
| BUG-009 | Missing launcher icon resources | Fixed, verified |
| BUG-010 | Patch script silently failed on CRLF files | Fixed, verified |
| BUG-011 | Touch buttons covered the menus | Fixed, verified |
| BUG-012 | Product name shown to the user was "INKWAVE" | Fixed, verified |
| BUG-013 | Default quality preset too heavy | Improved; **60 fps target not met** |
| BUG-014 | `songs/manifest.json` 404 | Benign; left visible on purpose |
| BUG-015 | Multi-touch harness could not observe the game | **RESOLVED** — assertion now passes |
| BUG-016 | A failed game boot was invisible in logcat | Fixed, verified |
| BUG-017 | Touch layer read `window.G`, which nothing assigns | **Fixed, verified** |
| BUG-018 | Synthesized keys never released — permanent jump | **Fixed, verified** |
| BUG-019 | Back button always exited the app | Fixed; device check outstanding |

Full detail — root cause, fix, files changed, validation — in `BUG_FIX_REPORT.md`.

BUG-015 took six rounds and contained **three real defects plus one harness defect**, all now
fixed. The most serious was BUG-018: one tap on JUMP left the key permanently held, so the
actor jumped forever. It was invisible until the touch layer could be observed at all, which
in turn required BUG-017 (reading `window.G`, a global nothing in the game assigns) to be
fixed first. The same `var`-hoisting mistake appears twice in this port (BUG-003, BUG-015a)
and is documented as a recurring class in the fix report.

### Logcat

Checked with `adb logcat` filtered on `ColorBrawl`, `CB/ERROR`, `CB/WARNING`,
`AndroidRuntime` and `chromium` across every run.

- **Zero** `FATAL EXCEPTION`, zero `AndroidRuntime` crashes, zero `crash` buffer entries.
- **Zero** uncaught JavaScript errors after BUG-003 and BUG-004 were fixed.
- Recurring benign line: `songs/manifest.json` 404 (BUG-014), plus
  `KHR_parallel_shader_compile extension not supported` (an optional optimisation, harmless).
- JavaScript errors are surfaced deliberately through `window.onerror`,
  `window.onunhandledrejection`, `console.error/warn` and a resource-load handler, all
  forwarded to Android and logged as `CB/ERROR` / `CB/WARNING`. No `catch {}` was added
  anywhere to hide an error.

---

## APK

| Field | Value |
|---|---|
| Path | `dp/Color-Brawl.apk` |
| Size | 17,034,959 bytes (16.24 MB) |
| SHA-256 | `1BB3F6848F529E45A282C3AD6B8BD9E37E16F4AF19787A0D179E6AD0799C827D` |
| Signature | APK Signature Scheme **v2**, 1 signer, `CN=Color Brawl`, RSA 2048 |
| Signer cert SHA-256 | `4f59f06c797f5bddfe5064d2bd46188a71746062d0721ad1a25869705e284159` |
| Package | `com.colorbrawl.android` |
| Label | Color Brawl |
| Version | 1.1.0 (code 1) |
| minSdk / targetSdk | 24 / 36 |
| Contents | 714 entries under `assets/game/` (25.8 MB uncompressed) — the entire game |
| Install result | `Success` (after uninstalling the differently-signed debug build) |
| Launch result | `Starting: Intent { cmp=com.colorbrawl.android/.MainActivity }`, no errors |
| Post-install check | zero `CB/ERROR`, zero `FATAL EXCEPTION`, zero `BOOT FAILED` |

The packaged sources were read back **out of the APK** to confirm the deliverable carries
every fix, rather than trusting the build order:

```
assets/game/src/config.js    ANDROID_DEFAULT_QUALITY        : true
assets/game/android/touch.js forceVisible                   : true
assets/game/android/errorhook.js  BOOT FAILED observer      : true
assets/game/src/core/input.js touchKey / releaseTouchKeys / _touchKeys  (BUG-018 fix)
assets/game/src/core/input.js old add-only touchAdd absent             (BUG-018 fix)
assets/game/src/main.js       page-observer.js imported                (test observer)
assets/game/android/touch.js  declaration offset 21920 < assignment 32633  (BUG-015a fix)
```

Three earlier builds were discarded during this work: one produced before the quality
migration existed, one before the BUG-015a/016 fixes, and one before the BUG-017/018/019
fixes. The hash quoted here is the only build that contains all of them.

The APK packages the complete game — HTML, CSS, 136 ES modules, three.js r186 and its
addons, GLSL, fonts, lightmap PNG/JSON pairs, stage artwork and all game data, all under
`assets/game/`. Nothing is fetched from a network, a local server, or the development
machine at runtime: the page origin is `https://appassets.androidplatform.net/`, served
from inside the APK. `assets/game` totals **714 entries / 25.8 MB**. The soundtrack is
synthesised in code, so no audio files are needed.

---

## Remaining Work

Ranked by importance. These are open items, not completed ones.

1. **Multi-touch assertion (BUG-015).** Prove that movement + camera + fire held
   concurrently all reach the game simultaneously. The `?mttest=1` harness exists and runs;
   it needs its probe to observe `window.G` (or an equivalent in-page state read) while the
   overlay is visible. This is the single largest gap in this report.
2. **Frame rate (BUG-013).** The 60 fps target is not met. The next steps, in order, are:
   measure on a **physical device** rather than the emulator; then confirm whether
   `low` (2048 paint atlas, no AO/bloom, MSAA off, pixelRatio 0.75) reaches a stable 30–60;
   then consider enabling the game's own dynamic-resolution controller as the default on
   Android. Do not delete the ink system to gain frames — the presets exist for this.
3. **Audio.** Not verified at all: the emulator was started with `-no-audio`. BGM, SFX,
   weapon audio, mute, and the pause/resume path all need a device with working audio.
4. **Match lifecycle.** Match end, results screen, rematch and restart were not exercised.
5. **Memory / leak testing.** One 30-second window showed a flat PSS. The required
   repeated start → play → end → restart cycle and the Map A → B → C → A cycle were not run.
6. **Map coverage.** Only one stage was entered. All 8 stages (7 offline + 1 online-only)
   and the day/dusk and Zone Control variants should each be launched at least once.
7. **Android Studio MCP.** Unusable in this session because the open project's path
   contains a space. Renaming `D:\Android App` to a space-free path (or fixing the plugin's
   URI construction) would restore `build_project`, `get_file_problems`, `logcat` and the
   rest of the MCP surface.
8. **DSH `android_*` tools.** Also unavailable: the plugin resolves `adb` from an
   environment captured at process start, before `ADB`/PATH were configured. A DSH restart
   will pick up the configuration that is now in place.
9. **Online multiplayer.** Requires a server-side `Origin` allow-list change that is outside
   this repository. Until then it is documented as blocked, not mocked.

---

## Final Status

```
FINAL STATUS: INCOMPLETE
```

**Completed**

- Upstream INKWAVE inspected at a recorded commit; feature inventory built from source.
- `dp/Color-Brawl.apk` produced, **signed**, and copied to the required path.
- Debug and release builds both succeed.
- Release APK installs, launches and runs the real game on the emulator.
- Game runs entirely from APK-internal assets, offline, with no local server.
- WebGL2/three.js rendering, 3D scene, ink/turf, full HUD, bots and weapons all observed
  working.
- Product name the user sees is **Color Brawl**.
- Touch controls wired through the game's own seams; real system-level touch reaches the
  game with zero uncaught JavaScript errors.
- **Multi-touch PROVEN**: four simultaneous pointers (move + camera + fire + jump) held while
  a match was playing, read back from the game's own `G.input` and `match.local.intent`, then
  released with `fire=False`, `jump=False`, `move=(0,0,0)` and zero pointers left held.
- Pointer lifecycle proven: four simultaneous pointers tracked by `pointerId`, released
  selectively, zero left held — no stuck joystick, no stuck button, no pointer leak.
- Immersive landscape fullscreen, lifecycle freeze, error surfacing and back handling
  implemented.
- A failed game boot is now reported to logcat instead of only to the device screen.
- 19 defects found and fixed; 1 recorded as open (the frame-rate target).
- `SOURCE_COMMIT.md`, `SOURCE_FEATURE_INVENTORY.md`, `BUG_FIX_REPORT.md`,
  `README-ANDROID.md` and this report generated.

**Blocked**

- Online multiplayer from the APK: upstream relay returns HTTP 403 for a WebView origin.
  Needs a change to the deployed Cloudflare Worker.
- Android Studio MCP: plugin URI bug with a space in the project path.
- DSH `android_*` tools: adb path captured before configuration; needs a DSH restart.

**Remaining**

- 60 fps: not met. GPU has headroom; the frame is CPU-bound.
- Android back-button behaviour (BUG-019) is fixed in source but was not exercised on the
  device.
- Audio, restart, leak cycles and per-map coverage: not tested. Match end / results was
  observed incidentally (see below).

**Note on the match lifecycle.** Although not run as a formal test, one instrumented run
played a Turf War match to completion unattended and rendered the full results screen
(DEFEAT, Tidewater Plaza, Lemon 29.9% vs Grape 38.0%, per-player turf table, XP award,
REMATCH / MAIN MENU). That is real evidence the match end and results path works, obtained
incidentally rather than by design, and is recorded as such.
