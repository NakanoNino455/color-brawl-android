# Source Feature Inventory — INKWAVE → Color Brawl

Every row was established by reading the actual source at commit
`3e9b5505ea900cb41851b4d75f16d488552b1794` (see `SOURCE_COMMIT.md`). Nothing here is
inferred from the README — where the README and the code disagree, the code wins and the
disagreement is recorded at the bottom.

**Status vocabulary**

| Status | Meaning |
|---|---|
| `NATIVE` | Works unmodified in the Android WebView. No change needed. |
| `PATCHED` | Required a change to the vendored game source. Each one is listed in `tools/patch-for-android.mjs`. |
| `SHIM` | Adapted from outside the game source, through the touch layer or the Android host. |
| `OFFLINE-SCOPE` | Present and shipped, but reachable only in the offline configuration. |
| `BLOCKED` | Cannot work from an APK for a documented external reason. |
| `NOT TESTED` | Implemented and built, but not yet exercised on a device. |

---

## 1. Game core

| Feature | Source file | Function / symbol | Dependencies | Browser API | Android compatibility | Required modification | Status | Test status |
|---|---|---|---|---|---|---|---|---|
| Boot sequence | `src/main.js` | `Game.boot()` L55-205 | all modules | ES modules, import map | **Fails on `file://`** | Serve via `WebViewAssetLoader` https origin | SHIM | NOT TESTED |
| Frame loop | `src/main.js` | `_frame(dt)` L1104-1205 | renderer, input | rAF | Fine | none | NATIVE | NOT TESTED |
| Scene + camera | `src/main.js` | `THREE.Scene`, `PerspectiveCamera` L86-91 | three r186 | WebGL2 | Requires WebGL2 | none | NATIVE | NOT TESTED |
| Renderer + post stack | `src/core/renderer.js` | `class Renderer` L111-153 | EffectComposer, GTAO, Bloom, SMAA | WebGL2, HalfFloat, MSAA RT | Works; default preset too heavy | Force quality preset down | SHIM | NOT TESTED |
| Shadow filter monkey-patch | `src/core/renderer.js` | `patchShadowFilter()` L66-74 | `THREE.ShaderChunk` | none | Safe — regex-guarded with warn-and-keep-stock | none | NATIVE | NOT TESTED |
| Global context + event bus | `src/core/ctx.js` | `G`, `on`, `emit` | none | none | Fine | none | NATIVE | NOT TESTED |
| Match rules + lifecycle | `src/game/match.js` | `class Match` | actor, bots | none | Fine | none | NATIVE | NOT TESTED |
| Physics | `src/game/physics.js` | `class Physics`, `Hit`, `WALKABLE` | three | none | Fine | none | NATIVE | NOT TESTED |
| Nav graph + A* | `src/game/nav.js` | `class NavGraph` | level | none | Fine | none | NATIVE | NOT TESTED |
| Camera rig | `src/game/cameraRig.js` | `class CameraRig` | three | none | Fine | none | NATIVE | NOT TESTED |
| Minimap | `src/game/minimap.js` | `class Minimap` | 2D canvas | Canvas2D | Fine | none | NATIVE | NOT TESTED |
| World swap / stage build | `src/main.js` | `_buildWorld()` L210-265 | level, paint, props | none | Fine | none | NATIVE | NOT TESTED |
| Deterministic debug API | `src/main.js` | `window.__inkwave.debug` L188-204 | — | none | Fine | none — **used for automated verification** | NATIVE | NOT TESTED |

## 2. Input

| Feature | Source file | Function / symbol | Dependencies | Browser API | Android compatibility | Required modification | Status | Test status |
|---|---|---|---|---|---|---|---|---|
| Keyboard input | `src/core/input.js` | `keydown`/`keyup` L22-42 | none | Keyboard | Not present on a phone | Touch layer supplies equivalents | PATCHED | NOT TESTED |
| Mouse look | `src/core/input.js` | `mousemove` L44-48 | **Pointer Lock** | Pointer Lock | **Android WebView has no Pointer Lock** | Touch camera drag feeds `mouse.dx/dy` | PATCHED | NOT TESTED |
| Mouse fire | `src/core/input.js` | `mousedown` L49-53 | **Pointer Lock** | Pointer Lock | Same as above | `pollTouch()` sets `mouse.left` | PATCHED | NOT TESTED |
| Pointer lock request | `src/core/input.js` | `requestLock()` L65-72 | Pointer Lock | Pointer Lock | **No API** → would throw | Guarded to a no-op when absent | PATCHED | NOT TESTED |
| Gamepad | `src/core/input.js` | `pollPad()` L78-93, `padStick`, `rumble` | Gamepad API | Gamepad | Works; **reused as the touch transport** | Touch announced as a pad-shaped device | PATCHED | NOT TESTED |
| Input abstraction | `src/core/input.js` | `class Input` (142 lines) | none | none | The seam that made this port cheap | none | NATIVE | NOT TESTED |
| Intent translation | `src/game/player.js` | `PlayerController.update()` L38-137 | Input | none | Only file that maps device → intent | Reads the synthetic touch pad | PATCHED | NOT TESTED |
| Actor intent contract | `src/game/actor.js` | `intent` L49, consumed L251-259, L370 | none | none | Fine | none | NATIVE | NOT TESTED |
| Aim point + magnetism | `src/game/player.js` | `computeAim()` L244-287 | physics, camera | none | Fine — derives from camera direction | none | NATIVE | NOT TESTED |
| Aim assist | `src/game/player.js` | `_assistTarget()` L213-242 | settings | none | Fine; engages via the synthetic pad | none | NATIVE | NOT TESTED |
| **Touch controls** | `android/touch.js` (new) | joystick, camera drag, 7 buttons | pointer events | Pointer Events | **Written for this port** | new file, no game edit | SHIM | NOT TESTED |
| **Multi-touch** | `android/touch.js` (new) | pointerId tracking, `releaseAll()` | pointer events | Pointer Events | **Written for this port** | new file | SHIM | NOT TESTED |
| Menu keyboard/gamepad nav | `src/main.js` | `_padMenus()` L1263-1283 | Input | none | Works through the synthetic pad | none | NATIVE | NOT TESTED |
| Back button | `android/touch.js` + `MainActivity.kt` | `onBackPressed`, `setBackConsumed` | Android | none | New | new code | SHIM | NOT TESTED |

## 3. Ink, paint and turf — the core system

| Feature | Source file | Function / symbol | Dependencies | Browser API | Android compatibility | Required modification | Status | Test status |
|---|---|---|---|---|---|---|---|---|
| Ink paint atlas | `src/world/paint.js` | `class PaintSystem` L351-357 | WebGL2 | **4096² RGBA8 redrawn every frame** | Highest GPU cost of the port | Quality preset reduces to 2048 | SHIM | NOT TESTED |
| Splat shader | `src/world/paint.js` | `PAINT_VS`/`PAINT_FS` L52-214 | GLSL | per-texel loops | Works, expensive | none (preset-controlled) | NATIVE | NOT TESTED |
| Slat quads + dry pass | `src/world/paint.js` | `_drawQuads` L844-865, dry L693-701 | GLSL | mip rebuild per frame | Works | none | NATIVE | NOT TESTED |
| Region flood | `src/world/paint.js` | `FLOOD_VS`/`FLOOD_FS`, `flood()` | GLSL | — | Works | none | NATIVE | NOT TESTED |
| Turf coverage scoring | `src/world/paint.js` | `coverage()` L886-889, `regionStats` | CPU grid | none | Works | none | NATIVE | NOT TESTED |
| Wet ink surface shading | `src/world/inkShading.js` | `INK_*` markers, `inkUniforms()` | level material | GLSL | Works | none | NATIVE | NOT TESTED |
| Level material | `src/world/levelMaterial.js` | `createLevelMaterial()` | texlib, ink | `sampler2DArray` | **WebGL2 required** | none | NATIVE | NOT TESTED |
| Procedural texture library | `src/world/texlib.js` | `createTextureLibrary()` L1332+ | MRT | **`WebGLArrayRenderTarget`, `count: 3`, GLSL3** | **WebGL2 + MRT required** | none | NATIVE | NOT TESTED |
| Swim wake | `src/fx/swimWake.js` | `class SwimWake` | level uniforms | none | Works | none | NATIVE | NOT TESTED |
| Ink ripples | `src/world/inkShading.js` | `INK_SLOPE` L221-253 | GLSL | 24-iteration loop | Works, expensive | none | NATIVE | NOT TESTED |
| Zone markings | `src/fx/zoneMarks.js` | `class ZoneMarks` | level | none | Works | none | NATIVE | NOT TESTED |

## 4. Character, combat and abilities

| Feature | Source file | Function / symbol | Dependencies | Browser API | Android compatibility | Required modification | Status | Test status |
|---|---|---|---|---|---|---|---|---|
| Squid form / dive / surface | `src/game/actor.js` | form switch L279-289, `submerged` L293 | intent | none | Works | none | NATIVE | NOT TESTED |
| Swimming + ink refill | `src/game/actor.js` L356, `config.js` L29-40 | — | none | none | Works | none | NATIVE | NOT TESTED |
| Wall climb | `src/game/actor.js` | `_updateClimb()` L298-299 | none | none | Works | none | NATIVE | NOT TESTED |
| Dolphin / swim jump | `src/game/actor.js` L319-327 | — | none | none | Works | none | NATIVE | NOT TESTED |
| Enemy ink: slow + damage | `src/game/actor.js` L294-346 | — | paint | none | Works | none | NATIVE | NOT TESTED |
| Squidkid character + rig | `src/game/character*.js` (11 files, ~15k lines) | `class Character` | three | none | Works | none | NATIVE | NOT TESTED |
| LOD system | `src/game/character-lod.js` | hero/game/far tiers | none | none | Works | none | NATIVE | NOT TESTED |
| 12 weapons | `src/config.js` L94-303 | `WEAPONS`, `WEAPON_ORDER` | weapons.js, kits | none | Works | none | NATIVE | NOT TESTED |
| Weapon firing logic | `src/game/weapons.js` | `class WeaponRunner` | projectiles | none | Works | none | NATIVE | NOT TESTED |
| Projectiles | `src/game/weapons.js` | `class Projectiles` | three | none | Works | none | NATIVE | NOT TESTED |
| 15 subs | `src/config.js` L318-407 | `SUBS`, `SUB_ORDER` | subs.js, kits | none | Works | none | NATIVE | NOT TESTED |
| Sub devices | `src/game/subs.js` | `class SubSystem` | physics | none | Works | none | NATIVE | NOT TESTED |
| 19 specials | `src/config.js` L411-469 | `SPECIALS`, `SPECIAL_ORDER` | specials.js, actor | none | Works | none | NATIVE | NOT TESTED |
| Special system | `src/game/specials.js` | `class SpecialSystem` | props | none | Works | none | NATIVE | NOT TESTED |
| 9 kits | `src/game/kits/*.js` (18 files) | self-registering via `registry.js` | — | none | Works | none | NATIVE | NOT TESTED |
| Super jump (+ queue, beacons) | `src/game/player.js` L141-211, `subs.js` | `_mapKeys`, `queueJump` | map UI | none | Works, but map targeting needs tap | Touch `map` flag wired | PATCHED | NOT TESTED |
| Dodge / roll | `src/game/actor.js` L310-313 | — | intent | none | Works | none | NATIVE | NOT TESTED |
| Killcam / spectate | `src/main.js` L499-521 | `rig.spectate` | cameraRig | none | Works | none | NATIVE | NOT TESTED |
| Cheers / "Yeah!" | `src/game/player.js` L129 | `intent.cheer` | none | none | Works | keyboard C only; no touch button yet | NATIVE | NOT TESTED |

## 5. Bots, modes and progression

| Feature | Source file | Function / symbol | Dependencies | Browser API | Android compatibility | Required modification | Status | Test status |
|---|---|---|---|---|---|---|---|---|
| Bot AI | `src/game/bots.js` (2088 lines) | `class BotBrain` | nav, physics | none | Works; writes `a.intent` directly | none | NATIVE | NOT TESTED |
| 3 bot difficulties | `src/config.js` L503-508 | Chill / Fresh / Fierce | — | none | Works | none | NATIVE | NOT TESTED |
| Turf War | `src/game/match.js` + `paint.js` | — | — | none | Works | none | NATIVE | NOT TESTED |
| Zone Control | `src/game/zones.js` (425 lines) | `class ZoneControl` | zones-data, zoneMarks | none | Works | none | NATIVE | NOT TESTED |
| Boss Battle (HULLBREAKER) | `src/boss/*.js` (10 files, ~3900 lines) | `class Boss`, `BossBrain`, `BossHazards` | bossModel, bossAnim | none | Works | none | NATIVE | NOT TESTED |
| Boss HUD | `src/ui/hud-boss.js` | `class BossHud` | hud | none | Works | none | NATIVE | NOT TESTED |
| Practice mode | `src/main.js` L712-766 | `practiceReset`, live loadout | — | none | Works | `L` key needs a touch equivalent | NATIVE | NOT TESTED |
| Attract mode | `src/main.js` L604-644 | `_startAttract()` | showcase | none | Works | none | NATIVE | NOT TESTED |
| XP / progression | `src/config.js` L553-559, `main.js` L996-1013 | `PROGRESSION`, `_judge()` | localStorage | localStorage | Works — DOM storage enabled | none | NATIVE | NOT TESTED |
| Profile persistence | `src/main.js` L41-43 | `loadJSON('inkwave.profile')` | localStorage | localStorage | Works | none | NATIVE | NOT TESTED |
| Locker (appearance) | `src/ui/menus.js` L1508 | `_scr_locker()` | character-style | none | Works | none | NATIVE | NOT TESTED |
| Awards / medals | `src/ui/menu-art.js` | `computeAwards`, `rankEmblem` | canvas | Canvas2D | Works | none | NATIVE | NOT TESTED |

## 6. Stages

| Feature | Source file | Browser API | Android compatibility | Status | Test status |
|---|---|---|---|---|---|
| 8 stages × day/dusk | `src/world/maps.js`, `src/world/stages/*` (40 files) | none | All statically imported — no dynamic stage loader to break | NATIVE | NOT TESTED |
| Halyard | `src/world/maps.js` (121 lines, inline) | none | Works | NATIVE | NOT TESTED |
| Tidewater Plaza | `src/world/stages/tidewater/` | none | Works | NATIVE | NOT TESTED |
| Kelpline Terminal | `src/world/stages/kelpline/` | none | Works | NATIVE | NOT TESTED |
| Saltpan Basin | `src/world/stages/saltpan/` | none | Works | NATIVE | NOT TESTED |
| Terrace Heights | `src/world/stages/terraces/` | none | Works | NATIVE | NOT TESTED |
| Lockgate Canals | `src/world/stages/lockgate/` | none | Works | NATIVE | NOT TESTED |
| Crossroads Market | `src/world/stages/crossmarket/` | none | Works | NATIVE | NOT TESTED |
| Cargo Terminal | `src/world/stages/cargo/` | none | `onlineOnly` + `noBots` + `noBoss` — **not reachable offline** | OFFLINE-SCOPE | NOT TESTED |
| Zone Control variants | `src/world/variants.js`, `zones-data.js` | none | Works | NATIVE | NOT TESTED |
| Lightmaps | `assets/lightmaps/` (13 json+png) | `fetch`, `TextureLoader` | **Blocked on `file://`**; document-relative paths work on the asset-loader origin | SHIM | NOT TESTED |
| Stage card art | `assets/stages/` (28 webp) | `new URL(..., import.meta.url)` | Works on an https origin | SHIM | NOT TESTED |

## 7. Audio

| Feature | Source file | Function / symbol | Browser API | Android compatibility | Required modification | Status | Test status |
|---|---|---|---|---|---|---|---|
| Procedural SFX | `src/audio/audio.js` (2505 lines) | `class AudioEngine`, `SFX` table | Web Audio | Works | none | NATIVE | NOT TESTED |
| Procedural soundtrack | `src/audio/music.js` (1490 lines) | `class MusicEngine`, `SONGS` | Web Audio | Works | none | NATIVE | NOT TESTED |
| Audio unlock on gesture | `src/audio/audio.js` L151-156 | `_installUnlock()` | `pointerdown`, `touchend` | **`touchend` already handled** | none | NATIVE | NOT TESTED |
| File-backed tracks | `src/audio/music.js` L1248-1274 | `class FileTrack` | `fetch`, `<audio>` | `songs/manifest.json` **does not exist upstream** | none — already `.catch`ed, falls back to synth | NATIVE | NOT TESTED |
| Music metronome worker | `src/audio/music.js` L1353-1359 | `new Worker(blobURL)` | Worker | May be blocked | none — has an `onerror` → `setInterval` fallback | NATIVE | NOT TESTED |
| Background/foreground audio | `MainActivity.kt` | `onPause`/`onResume` | Android lifecycle | **New** | WebView `pauseTimers` on pause | SHIM | NOT TESTED |
| Boss audio | `src/audio/bossAudio.js` | `installBossAudio()` | Web Audio | Works | none | NATIVE | NOT TESTED |

## 8. UI

| Feature | Source file | Function / symbol | Android compatibility | Required modification | Status | Test status |
|---|---|---|---|---|---|---|
| 14 menu screens | `src/ui/menus.js` (4308 lines) | `SCREENS` L29, `show()` L265-292 | Works; hover-only affordances degrade gracefully | none | NATIVE | NOT TESTED |
| In-match HUD | `src/ui/hud.js` (2073 lines) | `class HUD` | Works | none | NATIVE | NOT TESTED |
| Map diorama + pins | `src/ui/diorama.js` | `class DioramaOverlay` | Reads `G.input` directly for map pan | Touch `map` flag wired | PATCHED | NOT TESTED |
| Expanded map cursor | `src/ui/hud.js` L1806-1823 | virtual cursor | Mouse-driven | `map` flag + drag | PATCHED | NOT TESTED |
| What's New cards | `src/ui/news.js` | `class WhatsNew` | Works | none | NATIVE | NOT TESTED |
| Showcase (3D menus) | `src/game/showcase.js` (3109 lines) | `class Showcase` | Works | none | NATIVE | NOT TESTED |
| Online lobby set | `src/game/lobbySet*.js` | `class LobbySet` | Lazily imported; only in online flow | none | OFFLINE-SCOPE | NOT TESTED |
| Safe-area insets | `styles/ui.css` L1174 | `env(safe-area-inset-*)` | Already present | none | NATIVE | NOT TESTED |
| Landscape orientation | `AndroidManifest.xml` | `sensorLandscape` | **New** — camera FOV and `--u` are 16:9 derived | Forced landscape | SHIM | NOT TESTED |

## 9. Networking

| Feature | Source file | Function / symbol | Android compatibility | Required modification | Status | Test status |
|---|---|---|---|---|---|---|
| WebSocket transport | `src/net/transport.js` | `class Transport`, `PROTO=1` | Works | Relay URL auto-detection picks the wrong host in a WebView | PATCHED (via `?relay=`) | NOT TESTED |
| Relay URL resolution | `src/net/transport.js` L10-16 | `relayURL()` | `appassets.androidplatform.net` → resolves to the prod relay | `?relay=` override available | NATIVE | NOT TESTED |
| Cloudflare relay server | `server/src/index.js` | Worker + Durable Object | **`ORIGIN_OK` L22-23 returns 403 for an unknown Origin** | Requires a server-side change — **not done** | BLOCKED | NOT TESTED |
| Room codes + lobby | `src/net/session.js` | `class NetSession` | Logic works; blocked by the 403 above | — | BLOCKED | NOT TESTED |
| Match replication | `src/net/netmatch.js` (825 lines) | `class NetMatch` | Works | — | NATIVE | NOT TESTED |
| Offline mock of online UI | `src/net/mock.js` | `installMockNet()`, `?netmock=1` | Works entirely offline | none | NATIVE | NOT TESTED |
| Bot takeover of leavers | `src/net/netmatch.js` L671-707 | `onLeave`/`_adopt` | Works | none | NATIVE | NOT TESTED |

## 10. Android host (all new — no upstream equivalent)

| Feature | Source file | Purpose | Status | Test status |
|---|---|---|---|---|
| WebView host | `MainActivity.kt` | Owns the WebView, fullscreen, lifecycle | SHIM | NOT TESTED |
| Asset serving | `MainActivity.kt` | `WebViewAssetLoader` → `https://appassets.androidplatform.net/game/` | SHIM | NOT TESTED |
| WebGL2 requirement | `AndroidManifest.xml` | `uses-feature glEsVersion=0x00030000 required=true` | SHIM | NOT TESTED |
| Console → logcat | `MainActivity.kt` | `WebChromeClient.onConsoleMessage` | SHIM | NOT TESTED |
| JS error surfacing | `android/errorhook.js` | `window.onerror`, `onunhandledrejection`, resource errors | SHIM | NOT TESTED |
| Bridge | `MainActivity.kt` | `log`, `setBackConsumed`, `exitApp`, `platform`, `deviceInfo` | SHIM | NOT TESTED |
| Lifecycle freeze | `MainActivity.kt` | `onPause`/`onResume` → `pauseTimers`, touch release | SHIM | NOT TESTED |
| Build-time source patch | `tools/patch-for-android.mjs` | The 10 documented, idempotent source edits | SHIM | verified (apply/verify/idempotent) |
| Gradle project | `app/build.gradle.kts` | AGP 9.4.1, Kotlin 2.2.10, compileSdk 36, minSdk 24 | SHIM | NOT TESTED |

---

## README vs. code — recorded disagreements

The README was **not** used as a specification. These are the places where it diverges
from the source, checked directly:

| README claim | Reality in code |
|---|---|
| "no downloaded assets except two fonts" | Ships 13 lightmap PNG+JSON pairs (~2.4 MB), 28 stage WebPs (~4.4 MB), 2 news WebPs (~314 KB). The claim is false. |
| "on a plain `http://` LAN address browsers block the Gamepad API" | `src/core/input.js:79` is a bare `navigator.getGamepads ? … : []` with no secure-context detection. |
| Version 1.1.0 | `package.json` says 1.1.0 but `src/config.js:5` still exports `VERSION = '1.0.0'`, which is what the credits screen renders. |
| "Seven stages" | `MAPS` has **eight**; the eighth (`cargo`) is `onlineOnly` + `noBots` + `noBoss` and the README never mentions it. |
| Boss Battle mentioned only in passing | A full ~3,900-line feature (`src/boss/`, `docs/BOSS.md`) reachable from mode select. |
| — | **Present but undocumented:** the `?netmock=1` offline online-UI simulator, the shooter-decides/victim-applies hit model, `window.__inkwave.debug` (`freeze`/`step`), `?shadercheck`, `paint.flood()`, the 12 in-shader dusk lamps, the Apple-GPU branch, the shadow-chunk monkey-patch, `_dynRes`, full practice mode, the three retired weapons + `WEAPON_SUCCESSOR`, the `OFFLINE_MAPS` stage-rule system, and `src/dev/stubs.js`. |

## Features explicitly NOT ported

| Feature | Why | Consequence |
|---|---|---|
| Online multiplayer over the public relay | `server/src/index.js:22-23,40` returns **HTTP 403** for any `Origin` that is not `inkwave-aah.pages.dev` or a localhost/LAN address. An APK page origin is `https://appassets.androidplatform.net`, which is neither. Fixing this needs a change to the deployed Cloudflare Worker, which is outside this repository. | The Online screen will not be able to create or join a real room from the APK. Offline play against bots — the game's default path — is unaffected. This is recorded, not hidden. |
| `cargo` stage | Upstream marks it `onlineOnly` + `noBots`. | Unreachable in the offline configuration, exactly as upstream intends. |
| Electron desktop shell | Irrelevant to Android. | `electron/` was not copied into the APK. |
