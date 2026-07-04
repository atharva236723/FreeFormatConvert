# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) and
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] - 2026-07-04

First stable release. Free Format Convert is live at
[freeformatconvert.com](https://freeformatconvert.com) — a 100% client-side file
converter where nothing ever leaves the browser.

### Added

- **Conversion engine** with three auto-selected backends:
  - Canvas fast path for JPG/PNG/WebP (plus SVG and HEIC/HEIF decode).
  - `ffmpeg.wasm` for all audio, all video, and formats Canvas can't handle —
    the ~30MB core is lazily fetched and cached per session.
  - Document engine for DOCX↔PDF, PDF↔Word, PDF↔EPUB, EPUB→PDF, image→PDF,
    and PDF/DOCX → JPG/PNG.
- **Animated GIF / APNG → video** (MP4 / WebM) with animation preserved.
- **Standalone tools suite** — compress (image/video/audio/GIF, incl. target
  file size), resize/crop/rotate/flip, PDF merge/split/rotate/remove/extract,
  and unit converters — all fully client-side.
- **~690 auto-generated SEO pages**, one per conversion pair, plus category
  hubs, each a working converter with per-pair JSON-LD structured data.
- **Light / dark theme** with no flash of wrong theme, and a site-wide motion
  layer with reduced-motion support.
- Cloudflare Workers static-assets deployment with security headers, canonical
  domain, generated sitemap, and robots.txt.

### Security

- Per-category upload size caps and typed conversion errors.
- `X-Content-Type-Options`, `Referrer-Policy`, and `X-Frame-Options` headers.

[1.0.0]: https://github.com/atharva236723/FreeFormatConvert/releases/tag/v1.0.0
