# Source Provenance — INKWAVE

This file records the exact upstream revision that Color Brawl was built from. Every
feature claim in `SOURCE_FEATURE_INVENTORY.md` and every result in
`FINAL_ANDROID_TEST_REPORT.md` refers to this revision.

## Repository

| Field | Value |
|---|---|
| Repository | https://github.com/jaydendavisnc/inkwave |
| Project name (upstream) | INKWAVE |
| Product name (this port) | **Color Brawl** |
| Licence | MIT |

## Revision used

| Field | Value |
|---|---|
| Branch | `main` |
| Commit | `3e9b5505ea900cb41851b4d75f16d488552b1794` |
| Short commit | `3e9b550` |
| Commit date | 2026-09-29 12:31:46 -0400 |
| Commit subject | Merge pull request #8 from LilDannyy/zone-control-stages-arsenal |
| Commit body | INKWAVE 1.1: Zone Control, 4 new stages, new arsenal, smarter bots, desktop app |
| Working tree at inspection | clean (`git status --porcelain` empty) |
| Tags | none |
| Inspected at | 2026-10-01 17:38 +08:00 (local) |

Verification commands and their real output:

```
$ git rev-parse --abbrev-ref HEAD
main

$ git status --porcelain
(no output — working tree clean)

$ git remote get-url origin
https://github.com/jaydendavisnc/inkwave.git

$ git tag
(no output — the repository has no tags)
```

The upstream repository publishes exactly one branch (`main`); `git ls-remote --heads`
returns only `refs/heads/main` at `3e9b5505ea900cb41851b4d75f16d488552b1794`.

## Source composition at this revision

| Metric | Value |
|---|---|
| First-party game modules under `src/` | 136 `.js` files |
| First-party lines under `src/` | 95,866 |
| Vendored three.js | r186 (`vendor/three/build/three.core.js`: `const REVISION = '186';`) |
| Files under `vendor/` | 502 |
| Total repository size (excluding `.git`) | 26.4 MB in 772 files |
| Build step required | none — plain ES modules plus an import map |

## Layout of the checkout

```
inkwave/
├── index.html            entry point: #app / #ui-root / #fade / #boot-error + import map
├── package.json          three ^0.186.0; electron + wrangler as devDependencies
├── src/
│   ├── main.js           1399 lines — boot, frame loop, game-flow orchestration
│   ├── config.js         weapons, subs, specials, stages, quality presets, progression
│   ├── core/             ctx.js, input.js (the only raw-input module), renderer.js
│   ├── audio/            audio.js (2505), music.js (1490), bossAudio.js
│   ├── boss/             10 files — the HULLBREAKER boss battle
│   ├── dev/              stubs.js — module-failure fallbacks
│   ├── fx/               fx.js, fxHooks.js, screenfx.js, swimWake.js, zoneMarks.js
│   ├── game/             34 files — actor, bots, character*, weapons, subs, specials,
│   │                     match, physics, nav, minimap, cameraRig, zones, showcase
│   │   └── kits/         18 files — 9 self-registering weapon/sub kits
│   ├── net/              transport.js, session.js, netmatch.js, mock.js
│   ├── ui/               menus.js (4308), hud.js (2073), hud-boss.js, diorama.js, …
│   └── world/            paint.js, levelMaterial.js, texlib.js, environment.js, props.js,
│                         stages/ (7 stages × layout/props/surfaces/murals)
├── styles/               ui.css, hud.css
├── assets/               fonts (2 woff2), lightmaps (13 json+png), stages (28 webp), news
├── songs/                README.md only — audio is generated in code
├── server/               Cloudflare Worker + Durable Object relay
├── electron/             desktop shell (irrelevant to Android)
└── docs/                 CONTRACTS.md, NET.md, BOSS.md, RIG.md, EVENTS.md
```

## Local working copies

| Path | Purpose |
|---|---|
| `dp/inkwave/` | pristine upstream checkout at the commit above — the reference. Never modified. |
| `dp/project/Color-Brawl-Android/app/src/main/assets/game/` | the copy shipped inside the APK. Produced from the pristine checkout, then patched by `tools/patch-for-android.mjs`. |

## Reproducing the shipped state from scratch

```bash
git clone https://github.com/jaydendavisnc/inkwave.git
git -C inkwave checkout 3e9b5505ea900cb41851b4d75f16d488552b1794
# copy into app/src/main/assets/game/ excluding .git node_modules build docs tools electron
node tools/patch-for-android.mjs          # applies the 10 documented Android patches
node tools/patch-for-android.mjs --verify # must exit 0
```

The patch script is idempotent, refuses to run when an upstream anchor has moved, and
prints every edit it makes. `tools/patch-for-android.mjs` is the authoritative record of
every source modification relative to this commit.
