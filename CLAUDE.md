# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A client-side file converter (image/video/audio) built on Astro. There is no backend — every conversion runs in the visitor's browser. This is the product's core pitch, not an implementation detail: files never leave the device, unlike server-upload competitors.

## Commands

```sh
npm install       # install dependencies
npm run dev       # start dev server at localhost:4321
npm run build     # type-check via astro check + production build to ./dist/
npm run preview   # preview the production build locally
npm run astro ... # run any Astro CLI command, e.g. `npm run astro add react`
```

There is no linter or test suite configured.

When starting the dev server, use background mode so it doesn't block:
```sh
astro dev --background
```
Manage it with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Architecture

### Conversion engine (the core of the app)

Two engines are picked automatically per conversion — the split is invisible to the user, it exists purely for speed:

- **`src/lib/converter/imageEngine.ts`** — Canvas API fast path (`createImageBitmap` → draw → `canvas.toBlob`) for raster pairs the browser can actually encode. Instant, no network request.
- **`src/lib/converter/ffmpegEngine.ts`** — `@ffmpeg/ffmpeg` wrapper for everything else (all audio, all video, and image formats Canvas can't handle). The ~30MB wasm core is **not bundled** — it's fetched lazily from jsDelivr (`https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/`) the first time it's actually needed, then cached as a module-level singleton for the session. Uses the single-threaded core (not `core-mt`) so it works without COOP/COEP headers. If you bump `@ffmpeg/ffmpeg`, check that the pinned `CORE_VERSION` constant is still a compatible pairing — mismatches between the JS wrapper and the CDN-loaded core are a common ffmpeg.wasm failure mode.

**`src/lib/converter/index.ts`** is the orchestrator every caller should use (`convertFile(file, targetExt, opts)`). It decides fast-path vs ffmpeg via `isFastPathPair()`, infers video→audio extraction (adds `-vn` to skip video decoding entirely) by comparing source/target category, and normalizes every failure into a typed `ConversionError` (`reason: 'unsupported-pair' | 'timeout' | 'engine-load-failed' | 'unknown'`).

`ConversionError` lives in its own file, **`src/lib/converter/errors.ts`**, deliberately separate from `ffmpegEngine.ts`. `index.ts` needs the error class at the top level but must NOT statically import anything from `ffmpegEngine.ts`, or Vite will pull that module's dynamic `import('@ffmpeg/ffmpeg')` calls into the eagerly-loaded chunk graph and defeat the lazy-loading (Vite will warn `INEFFECTIVE_DYNAMIC_IMPORT` if this regresses). `ffmpegEngine` itself is only ever reached via `await import('./ffmpegEngine')` inside `convertFile`.

**`src/lib/formats.ts`** is the single source of truth for supported formats: per-category (`image`/`audio`/`video`) `FormatDef` lists, `detectCategory(file)`, `getAvailableTargets(category, ext)` (also merges in the video→audio "extract audio" bonus targets), and `isFastPathPair()`. When adding a format, add it here — nothing else hardcodes a format list.

Known constraint baked into `isFastPathPair`: `canvas.toBlob()` cannot actually encode BMP or GIF in any browser (it silently falls back to PNG). The fast path is intentionally narrow — decodable-source set is broad, encodable-target set is only `jpg/jpeg/png/webp`. Anything else routes through ffmpeg, which has real encoders for those containers.

### UI

No UI framework is installed. The converter widget is a single vanilla-TS custom element:

- **`src/components/Converter.astro`** — static markup/CSS. Visibility of each stage (`dropzone`, pick/converting/done/error) is driven entirely by a `data-state` attribute on the `<file-converter>` root, toggled via CSS descendant selectors (`file-converter[data-state="..."] .stage-x { display: block }`) — no framework, no layout-shift.
- **`src/scripts/converter-controller.ts`** — `customElements.define('file-converter', ...)`, the whole state machine (`idle → dragging → file-selected → converting → done/error`), wired to drag/drop, the hidden file input, and dynamically-rendered format-picker buttons (built at runtime from `formats.ts`, not duplicated as static HTML per category).

Follow this pattern for any other non-trivial interactive component in this project rather than reaching for React/Vue — there's no framework integration configured, and adding one for a single self-contained widget isn't worth the bundle cost next to the already-lazy-loaded wasm core.

### Styling

**No Tailwind**, despite the `tailwind-4-docs` skill being available in `.agents/skills/` — it isn't used in this project. Styling is hand-written CSS using custom properties translated 1:1 from `DESIGN.md`'s token tables:
- `src/styles/tokens.css` — every color/spacing/radius/typography/elevation token as a `--variable`.
- `src/styles/global.css` — reset + base typography, imports `tokens.css`.

[DESIGN.md](DESIGN.md) (Vercel-inspired design system) is the source of truth for all visual decisions — colors, type scale, spacing, radius, elevation, component chrome. **Read it before writing or modifying any UI.**

### Fonts

Configured via Astro's native Fonts API in `astro.config.mjs` (`fonts: [...]` using `fontProviders.fontsource()` for Geist Sans/Geist Mono), rendered with `<Font cssVariable="..." />` from `astro:assets` in `src/layouts/Layout.astro`. Astro downloads and self-hosts these at build time — there's no runtime request to a third party, which reinforces the "nothing leaves your device" story. Don't add a manual `<link>` tag or a Fontsource npm dependency; extend the `fonts` array in config instead.

### Page composition

`src/pages/index.astro` is deliberately homepage-as-tool: `NavBar → Converter (the hero) → FeatureStrip → HowItWorks → Faq → Footer`. There is no separate marketing landing page ahead of the tool — don't reintroduce that split.

## Agent skills and MCP

- `.agents/skills/web-design-guidelines` — reviews UI code against Web Interface Guidelines (accessibility, UX best practices) by fetching the latest guidelines from source before checking.
- `.agents/skills/tailwind-4-docs` — local Tailwind CSS v4 docs snapshot; not currently relevant since this project doesn't use Tailwind (see Styling above).
- An `astro-docs` MCP server (`https://mcp.docs.astro.build/mcp`) is configured — use it for live Astro documentation (Fonts API, client-side script/custom-element patterns, routing) instead of relying on training data, since Astro's APIs are version-specific and this project pins `astro ^7.0.4`.
