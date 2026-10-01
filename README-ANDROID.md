# Color Brawl — Android

**Color Brawl** is the Android release of [INKWAVE](https://github.com/jaydendavisnc/inkwave),
a 4v4 turf-war ink shooter built on three.js. The product name on the device is
**Color Brawl**; INKWAVE is the upstream project and the reference implementation.

The game is not reimplemented. The original ES-module source ships inside the APK and runs
unmodified in an Android WebView, on top of a small, documented compatibility layer and a
touch input layer.

## Original source

| | |
|---|---|
| Repository | https://github.com/jaydendavisnc/inkwave |
| Branch | `main` |
| Commit | `3e9b5505ea900cb41851b4d75f16d488552b1794` |
| Licence | MIT |
| Full provenance | `docs/SOURCE_COMMIT.md` |

## Android architecture

```
Color Brawl APK
  └── MainActivity (Kotlin)
        ├── WebViewAssetLoader  →  https://appassets.androidplatform.net/game/
        │                            │
        │                            └── assets/game/   (the whole game, offline)
        │                                   index.html → src/main.js → three.js → WebGL2
        ├── Immersive fullscreen, sensorLandscape, lifecycle freeze
        └── ColorBrawl JS bridge  ←→  android/touch.js   (touch input layer)
                                        android/errorhook.js
```

Why a real `https://` origin and not `file://`: the game is 136 ES modules plus an import
map and dynamic `import()`. Chrome refuses module scripts from a `file://` origin, and
`fetch()` / `TextureLoader` are blocked there too. `WebViewAssetLoader` serves the same
files from an https origin out of the APK, which fixes all of it without touching a single
asset path.

Native code owns only: the Activity, the WebView, fullscreen/orientation, the lifecycle,
and the bridge. Every line of game logic stays in the original JavaScript.

## Requirements

- Android 7.0 (API 24) or newer, **arm64 or x86_64**
- **WebGL2 is mandatory.** three.js r186 has no WebGL1 fallback, and the game additionally
  uses MRT (`WebGLArrayRenderTarget`, 3 attachments), `sampler2DArray` and GLSL ES 3.00.
  Essentially every Android 7+ device with a working GPU driver qualifies.
- Landscape orientation.

## Build

The Android SDK path is read from `local.properties` (not committed):

```properties
sdk.dir=D\:\\Android SDK
```

Then:

```bat
gradlew.bat assembleDebug
gradlew.bat assembleRelease
```

Toolchain used and verified for this build:

| Component | Version |
|---|---|
| Android Gradle Plugin | 9.4.1 (bundles its own Kotlin support) |
| Gradle | 9.6.0 |
| JDK | 17–25 (Android Studio JBR) |
| compileSdk / targetSdk | 36 |
| minSdk | 24 |
| Build tools | 36.0.0 |

Output APKs:

```
app/build/outputs/apk/debug/app-debug.apk
app/build/outputs/apk/release/app-release.apk
```

### Release signing

The release build reads a keystore from `local.properties` or the environment. If neither
is present it falls back to the debug key so the build always produces something
installable — replace it for any real distribution.

```properties
COLORBRAWL_STORE_FILE=../colorbrawl-release.jks
COLORBRAWL_STORE_PASSWORD=…
COLORBRAWL_KEY_ALIAS=…
COLORBRAWL_KEY_PASSWORD=…
```

`*.jks`, `*.keystore` and `local.properties` are gitignored. No key material is ever
committed and none is embedded in `build.gradle.kts`.

## Install

```bat
adb install -r app\build\outputs\apk\release\app-release.apk
adb shell monkey -p com.colorbrawl.android -c android.intent.category.LAUNCHER 1
```

## Applying the Android source patches

`app/src/main/assets/game/` is the upstream source plus a small set of edits. Those edits
live in one place and are reproducible:

```bat
node tools\patch-for-android.mjs            :: apply
node tools\patch-for-android.mjs --verify   :: exit 0 when applied
node tools\patch-for-android.mjs --revert   :: undo
```

The script matches on exact anchors, refuses to write anything if an upstream anchor has
moved, preserves each file's original line endings (upstream mixes LF and CRLF), and is
idempotent. What it changes and why is documented in the file header and in
`docs/BUG_FIX_REPORT.md`.

## Touch controls

Landscape. Left thumb drives a movement slider; the right thumb drags the camera; the
right-hand cluster fires and uses abilities. Every button maps to a real documented
keyboard binding from the game's own HOW TO PLAY screen:

| Control | Keyboard equivalent |
|---|---|
| Movement slider | `W` `A` `S` `D` |
| Camera drag | mouse (Pointer Lock) |
| FIRE | left mouse |
| JUMP | `Space` |
| SQUID | `Shift` |
| SUB | right mouse / `E` |
| SPECIAL | `F` / `Q` |
| MAP | `Tab` |
| PAUSE | `Esc` |

There is no Pointer Lock on Android, so the touch layer supplies the camera delta that the
mouse would have produced. Keyboard and gamepad still work when attached — the touch layer
is a third input source, not a replacement.

The touch overlay is `pointer-events: none` everywhere except the joystick pad and the
buttons, so the original menus and HUD receive native taps and no synthetic click
dispatch is needed.

## Assets

The entire game is packaged in the APK. After installation nothing is fetched from a
network, a local server, or the development machine:

```
APK → WebView → assets/game/ → index.html → three.js → WebGL2 → Color Brawl
```

Served content includes HTML, CSS, 136 ES modules, vendored three.js r186 and its
addons, GLSL, procedural-texture code, fonts (woff2), stage artwork (webp), lightmap
PNG/JSON pairs, and all game data. The soundtrack is synthesised in code, so no audio
files are needed.

Total packaged size is about 24 MB of web assets.

## Deliverable

```
dp/Color-Brawl.apk
```

## Verified state

See:

- `docs/FINAL_ANDROID_TEST_REPORT.md` — environment, build, device, gameplay, performance, APK
- `docs/BUG_FIX_REPORT.md` — every bug found, its root cause and its fix
- `docs/SOURCE_FEATURE_INVENTORY.md` — every upstream feature and its Android status
- `docs/SOURCE_COMMIT.md` — exact upstream revision

Known limitation, recorded rather than hidden: the upstream public relay
(`server/src/index.js`) rejects any `Origin` that is not `inkwave-aah.pages.dev` or a
localhost/LAN address, returning HTTP 403. An APK page origin is
`https://appassets.androidplatform.net`, so **online multiplayer cannot create or join a
real room from the APK** without a server-side change that is outside this repository.
Offline play against bots — the game's default mode — is unaffected.
