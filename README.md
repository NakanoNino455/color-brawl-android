# Color Brawl

**Color Brawl** is an Android build of [INKWAVE](https://github.com/jaydendavisnc/inkwave), a 4v4
turf-war ink shooter built on three.js. The name on the device is Color Brawl; INKWAVE is the
upstream project and the reference implementation.

The game is **not** reimplemented or forked into a different engine. The original ES-module source
ships inside the APK and runs unmodified in an Android WebView, on top of a small documented
compatibility layer and a touch input layer. Every change to the original source is applied by one
script, `android/tools/patch-for-android.mjs`, which is idempotent, refuses to write anything if
any anchor is missing or ambiguous, and can verify or revert itself.

## Install

Grab `release/Color-Brawl.apk` and install it on any Android 7.0+ (API 24) device. It is a release
build signed with the project key, and it runs fully offline.

## Original source

| | |
|---|---|
| Repository | https://github.com/jaydendavisnc/inkwave |
| Commit | `3e9b5505ea900cb41851b4d75f16d488552b1794` |
| Licence | MIT, Copyright (c) 2026 Jayden Davis |
| Provenance | `docs/SOURCE_COMMIT.md` |

INKWAVE is MIT licensed, so this port redistributes and modifies it under the same terms. The
original copyright notice is preserved in `upstream/LICENSE`, and `upstream/` is an unmodified copy
of the source at the pinned commit. **All credit for the game itself belongs to Jayden Davis.**

## What this port changes

The upstream game is a mouse-and-keyboard desktop title. The port adds:

- **A WebView host** (`android/app/src/main/java/.../MainActivity.kt`) that serves the whole game
  from `assets/game/` through `WebViewAssetLoader`, so it runs offline with no `file://` module
  restrictions, plus immersive fullscreen, landscape lock and lifecycle freezing.
- **A touch input layer** (`android/app/src/main/assets/game/android/touch.js`) presenting on-screen
  controls to the game as a gamepad, with an aim latch so the camera can be turned while firing,
  and a **layout editor** (Settings > Controls > Custom button layout, or long-press AIM) whose
  positions persist.
- **Three graphics tiers (SD / HD / UHD) and two frame-rate tiers (60 / 120 Hz)** in Settings.
- **Mobile performance work**: a reduced ink-ripple loop, MSAA off at the mid tier, smaller shadow
  map and paint atlas, and a 60 Hz default frame target.
- **All desktop affordances removed**: no keycaps, no mouse glyphs, no keyboard hint rows, no
  keyboard control reference.

`docs/` carries the full record: `BUG_FIX_REPORT.md` (every defect found, with the measurement that
found it), `FINAL_ANDROID_TEST_REPORT.md`, `SOURCE_FEATURE_INVENTORY.md` and `SOURCE_COMMIT.md`.

## Build from source

Requirements: JDK 17+, Android SDK with API 36 platform and build-tools, and Node.js for the patch
script.

```
cd android
# 1. copy the eight files the patch script edits from upstream into the app, then apply every patch
cd app/src/main/assets/game
cp ../../../../../../upstream/src/core/input.js       src/core/input.js
cp ../../../../../../upstream/src/game/player.js      src/game/player.js
cp ../../../../../../upstream/src/main.js             src/main.js
cp ../../../../../../upstream/src/config.js           src/config.js
cp ../../../../../../upstream/src/ui/ui-icons.js      src/ui/ui-icons.js
cp ../../../../../../upstream/src/ui/menus.js         src/ui/menus.js
cp ../../../../../../upstream/styles/ui.css           styles/ui.css
cp ../../../../../../upstream/src/world/inkShading.js src/world/inkShading.js
cd ../../../../..
node tools/patch-for-android.mjs            # apply
node tools/patch-for-android.mjs --verify   # must exit 0
node tools/patch-for-android.mjs --revert   # undo

./gradlew assembleRelease
```

Release signing reads `COLORBRAWL_STORE_FILE`, `COLORBRAWL_STORE_PASSWORD`, `COLORBRAWL_KEY_ALIAS`
and `COLORBRAWL_KEY_PASSWORD` from `local.properties` (git-ignored), falling back to the debug key.
The release keystore is deliberately **not** in this repository.

Toolchain used: AGP 9.4.1, Gradle 9.6.0, compileSdk/targetSdk 36, minSdk 24.

## Known limitations

- **Online multiplayer does not work from the APK.** The upstream relay rejects the WebView origin
  with HTTP 403; this needs an `Origin` allow-list change on the deployed Cloudflare Worker. It is
  documented as blocked rather than faked — there is no mock networking in this build.
- **The 60 fps target was never met on the test emulator**, which is not a reliable benchmark (the
  same configuration measured both 46 ms and 65 ms median). The frame is CPU-bound on the ink
  atlas; the mobile changes above reduce known-heavy work but are not a measured fps claim. Real
  hardware numbers are still needed.
- **Ground ink does not render on at least one real device** (Redmi / Dimensity 7200 Ultra). Three
  candidate causes remain and could not be distinguished without that device's logs. See
  `docs/BUG_FIX_REPORT.md`, BUG-034.

## Licence

MIT. The upstream copyright notice (Copyright (c) 2026 Jayden Davis) is preserved in
`upstream/LICENSE` and applies to the game; the Android host and touch layer are contributed under
the same licence.
