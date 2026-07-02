# Features

**Free Format Convert** is a 100% client-side file converter. Every conversion runs inside the visitor's browser — files never leave the device, and there is no backend, no upload, and no account. This document catalogs the features shipped in the app.

---

## 🔒 Privacy by design

- **Nothing leaves your device.** All processing happens locally in the browser using the Canvas API, WebAssembly (ffmpeg.wasm), and pure-JS libraries. No file is ever uploaded to a server.
- **No accounts, no tracking of file contents, no server storage.** The core product promise, not an afterthought.
- **Self-hosted fonts and icons.** Fonts (Geist Sans / Geist Mono) are downloaded and self-hosted at build time via Astro's Fonts API; the favicon / PWA icon set lives in `public/` — no third-party CDN hotlinking, consistent with the privacy story.

---

## 🖼️ Image conversion

- **Instant Canvas fast path** for raster formats the browser can natively encode (`jpg` / `jpeg` / `png` / `webp`): `createImageBitmap → draw → canvas.toBlob`. No download, no WASM, near-instant.
- **Broad decodable source set** (including `jfif`, which is byte-identical to JPEG) with automatic fallback to ffmpeg for formats Canvas can't encode (e.g. BMP, GIF).
- **HEIC / HEIF support** — decoded via `heic2any` since no browser can decode HEIC through `createImageBitmap`.
- **Image → PDF** — one image per page, flattened onto white so transparent PNGs don't render black.

## 🎞️ Animated images → video

- **GIF and APNG can convert to video** (MP4 / WebM). These are real, working conversions — not dead pages — powered by ffmpeg.
- Codec quirks handled automatically: even-dimension scaling for h264 (animated GIFs are often odd-sized), VP8 pinning for `.webm`, and the `apng` muxer with `-plays 0` to preserve animation.

## 🔊 Audio & 🎬 video conversion

- **Full audio and video transcoding** via a lazily-loaded `@ffmpeg/ffmpeg` WebAssembly core (~30 MB), fetched from CDN only the first time it's needed, then cached for the session.
- **Single-threaded core** so it works without special COOP/COEP headers.
- **Video → audio extraction** is inferred automatically (adds `-vn` to skip video decoding) when converting a video source to an audio target.
- **Support for camcorder / broadcast containers** as inputs: `mts` / `m2ts` / `ts` / `vob` / `3g2` / `f4v` demux reliably (e.g. `mts-to-mp4`).
- **Adaptive timeouts** — the conversion timeout scales with input size, so large-but-legitimate files get more room while small stuck files still fail fast.

## 📄 Document & 📚 ebook conversion

Handled by a dedicated, dynamically-imported document engine:

- **DOCX → PDF** — extracts HTML with `mammoth`, then a manual block-layout pass writes a real, text-selectable PDF via `jsPDF` (not a rasterized screenshot).
- **PDF → JPG / PNG** — renders each page with `pdfjs-dist`; a single page yields one image, multiple pages yield a `.zip` archive of numbered images.
- **PDF → Word (DOCX)** and **PDF → EPUB** — extracts and reflows text into an editable `.docx` (via `docx`) or a spec-valid EPUB 3 package (via `jszip`).
- **EPUB → PDF** — unzips the ebook, walks the OPF spine in reading order, inlines images as data URLs, and flows the markup through the same PDF layout pass.
- **Image → PDF** (including HEIC sources).

> Document text conversions (PDF↔Word, PDF↔EPUB) are intentionally **text-only** — they reflow content rather than reproducing exact layout, columns, or fonts, since there's no reliable fully-client-side way to do that.

---

## 🧭 SEO & page surface

- **~690 auto-generated conversion pages** — one static page per `(source → target)` pair (`/png-to-jpg`, `/mp4-to-mp3`, `/gif-to-mp4`, …), each with its own `<h1>`, meta title/description, and canonical URL. Add a format to `formats.ts` and its pages appear automatically.
- **Category hub pages** — `/video-to-gif`, `/image-to-gif`, `/pdf-converter`, `/document-converter`, `/ebook-converter` for broader search intent.
- **`/conversions` index** — every generated pair grouped by category with jump navigation.
- **`sitemap.xml`** generated dynamically, plus a "Conversions" mega-menu in the navbar built server-side from the format matrix.
- **Popular-conversions grid** on the homepage linking into the pair pages.

## 🎨 UI & experience

- **Tool-first homepage** — the converter *is* the hero; no marketing splash ahead of the tool.
- **Drag-and-drop converter widget** — a hand-written vanilla-TS custom element (`<file-converter>`) with a full state machine (`idle → dragging → file-selected → converting → done/error`) driven entirely by a `data-state` attribute and CSS, with no layout shift.
- **Preset targets** — landing pages preselect the right output format so users only pick a file and hit Convert.
- **Client-side size guards** — per-category upload caps (image 50 MB, audio 300 MB, video 1 GB, document 100 MB) are checked at file-selection time for instant feedback.
- **Typed, user-friendly errors** — every failure is normalized into a `ConversionError` with a clear reason (`unsupported-pair`, `timeout`, `engine-load-failed`, `file-too-large`, `unknown`).

## 🌗 Theming

- **Light / dark mode toggle** driven by a `data-theme` attribute, with an inline pre-paint script that reads `localStorage` / `prefers-color-scheme` to avoid any flash of the wrong theme.
- **Design-token system** — a Vercel-inspired set of CSS custom properties (color, spacing, radius, typography, elevation) that every component consumes; theming never branches in component code.

## 📱 PWA & polish

- **Web app manifest** and full favicon / touch-icon / maskable-icon set for installability and proper display across platforms.
- **Custom `404` and `500` error pages.**
- **Content & legal pages** — About, Contact, Terms, Privacy — sharing a consistent `PageHeader` and prose styling.

---

## 🏗️ Architecture at a glance

| Layer | Responsibility |
| :--- | :--- |
| `src/lib/formats.ts` | Single source of truth for supported formats, categories, targets, and size caps |
| `src/lib/converter/index.ts` | Orchestrator — routes each job to the right engine and normalizes errors |
| `src/lib/converter/imageEngine.ts` | Canvas fast path |
| `src/lib/converter/ffmpegEngine.ts` | Audio / video / hard image formats via ffmpeg.wasm |
| `src/lib/converter/documentEngine.ts` | Document & ebook conversions |
| `src/scripts/converter-controller.ts` | The `<file-converter>` custom element and its state machine |

All heavy libraries (`@ffmpeg/*`, `jspdf`, `pdfjs-dist`, `mammoth`, `jszip`, `docx`, `heic2any`) are **dynamically imported** so they stay out of the eager bundle and load only when actually needed.

See [`CLAUDE.md`](CLAUDE.md) for the full architecture reference and [`DESIGN.md`](DESIGN.md) for the design system.
