# Setu Flipbook

A self-hosted flipbook viewer for the Setu Collection Book PDF, with a realistic
page-curl turn, synthesised page-turn audio, thumbnails, zoom and fullscreen.

## How it works

The PDF is rasterised once, ahead of time, into WebP page images plus
thumbnails. The viewer then only ever loads images, so the first spread appears
in well under a second instead of pulling a 27 MB PDF down the wire. The curl
animation comes from [`page-flip`](https://github.com/Nodlik/StPageFlip); the
page-turn sound is generated at runtime with the Web Audio API, so there is no
audio file to ship.

## Setup

```bash
npm install
npm run prerender    # PDF -> public/pages/*.webp + public/manifest.json
npm run dev          # http://localhost:5173
```

`prerender` reads `public/catalogue.pdf` by default. To point it at a different
document:

```bash
npm run prerender -- /path/to/other.pdf
```

Tuning knobs live at the top of `scripts/prerender.mjs`: `PAGE_WIDTH` (render
resolution of the long edge), `THUMB_WIDTH` and `QUALITY`.

## Deploying

```bash
npm run build        # outputs dist/
```

`dist/` is entirely static — drop it on Netlify, Vercel, S3, GitHub Pages or any
web host. `base: './'` in `vite.config.js` means it also works from a
subdirectory. The original PDF stays at `public/catalogue.pdf` so the download
button serves the real file; delete it if you would rather not offer a download.

## Controls

| Action | Input |
| --- | --- |
| Turn page | Click or drag a page corner, side arrows, `←` / `→` / space |
| Jump to page | Type in the page box, or pick a thumbnail |
| First / last | `Home` / `End` |
| Thumbnails | `T` |
| Zoom | `+` / `−`, double-click, or ctrl/⌘ + scroll |
| Pan when zoomed | Drag |
| Fullscreen | `F` |
| Sound | Speaker button (choice is remembered) |

The current page is mirrored into the URL hash, so `#page=12` links to a
specific spread.

## Layout notes

The source pages are landscape, which makes a two-page spread very wide. The
viewer measures the stage on every resize and drops to single-page mode when a
spread would be too small — narrow windows and phones therefore show one page at
a time. Front and back covers are shifted to sit centred, since a closed book
only occupies half of the spread.

## Project layout

```
scripts/prerender.mjs   PDF -> WebP pages, thumbnails, manifest
scripts/shot.mjs        dev-only screenshot pass (needs the dev server running)
scripts/probe.mjs       dev-only layout geometry dump
scripts/audio-check.mjs dev-only loudness/tone measurement for the turn sound
src/main.js             viewer: build, navigation, zoom, thumbnails, controls
src/sound.js            Web Audio page-turn synthesis
src/styles.css          styling
public/                 catalogue.pdf, manifest.json, pages/
```
