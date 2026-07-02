# Free Format Convert

A **100% client-side** file converter for images, video, audio, documents, and ebooks. Every conversion runs entirely in the visitor's browser — files never leave the device. No backend, no upload, no account.

> Built with [Astro](https://astro.build), the Canvas API, [ffmpeg.wasm](https://ffmpegwasm.netlify.app/), and a handful of pure-JS document libraries.

## ✨ Highlights

- 🔒 **Private by design** — nothing is ever uploaded; all processing is local.
- 🖼️ **Images** — instant Canvas fast path for JPG/PNG/WebP, HEIC support, image → PDF.
- 🎬 **Audio & video** — full transcoding via a lazily-loaded ffmpeg WebAssembly core.
- 🎞️ **Animated GIF / APNG → video** (MP4 / WebM).
- 📄 **Documents & ebooks** — DOCX↔PDF, PDF↔Word, PDF↔EPUB, PDF → JPG/PNG.
- 🧭 **~690 SEO pages** auto-generated, one per conversion pair.
- 🌗 **Light / dark theme** with no flash of wrong theme.

See **[FEATURES.md](FEATURES.md)** for the full feature list.

## 🚀 Getting started

Requires **Node >= 22.12.0**.

```sh
npm install       # install dependencies
npm run dev       # start dev server at localhost:4321
npm run build     # production build to ./dist/
npm run preview   # preview the production build
npx astro check   # full TypeScript type-check
```

> `npm run build` transpiles TS with esbuild and only type-checks `.astro` files — run `npx astro check` separately to type-check `.ts` files. There is no linter or test suite configured.

## 📁 Project structure

```text
src/
├── components/            # UI components (Converter, NavBar, Footer, hubs…)
├── layouts/Layout.astro   # shared page shell + theme/head
├── lib/
│   ├── formats.ts         # single source of truth for supported formats
│   └── converter/         # conversion engines + orchestrator
│       ├── index.ts       # picks the engine, normalizes errors
│       ├── imageEngine.ts # Canvas fast path
│       ├── ffmpegEngine.ts# audio/video via ffmpeg.wasm
│       └── documentEngine.ts # documents & ebooks
├── pages/                 # routes (incl. [conversion].astro → ~690 pages)
├── scripts/               # vanilla-TS custom elements & behaviors
└── styles/                # design tokens + global CSS
```

## 📚 Documentation

- **[FEATURES.md](FEATURES.md)** — everything the app can do.
- **[CLAUDE.md](CLAUDE.md)** — architecture reference.
- **[DESIGN.md](DESIGN.md)** — Vercel-inspired design system and tokens.
