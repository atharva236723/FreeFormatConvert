# Contributing to Free Format Convert

Thanks for your interest in contributing! This is a **100% client-side** file
converter built on [Astro](https://astro.build) — every conversion runs in the
visitor's browser, and that constraint shapes every contribution.

## Ground rules

- **Nothing may leave the device.** No feature may upload a file to a server or
  call an external API for conversion. This is the product's core promise.
- **Keep heavy code lazy.** The ffmpeg wasm core (~30MB) and the document
  libraries are dynamically `import()`-ed so they stay out of the eager bundle.
  Don't add static imports that pull them into the main chunk.
- **`src/lib/formats.ts` is the single source of truth** for supported formats.
  Add a format there and its pages/pickers appear automatically.

## Getting started

Requires **Node >= 22.12.0**.

```sh
npm install       # install dependencies
npm run dev       # start dev server at localhost:4321
npm run build     # production build to ./dist/
npm run preview   # preview the production build
npx astro check   # full TypeScript type-check
```

## Before you open a pull request

1. Run `npx astro check` — `npm run build` does **not** type-check `.ts` files.
2. Run `npm run build` and make sure it succeeds with no new warnings
   (a `INEFFECTIVE_DYNAMIC_IMPORT` warning means lazy-loading regressed).
3. Test your change in a real browser — note which browser/OS in the PR.
4. If you added or removed a conversion or tool, update **`FEATURES.md`**.

## Project layout

See [`README.md`](README.md) for a directory map and [`CLAUDE.md`](CLAUDE.md)
for a deep architecture reference (engines, orchestrator, page composition).
[`DESIGN.md`](DESIGN.md) is the source of truth for all visual decisions — read
it before touching UI.

## Reporting bugs & requesting features

Use the [issue templates](.github/ISSUE_TEMPLATE). Bug reports must include the
browser and OS — the Canvas and wasm paths behave differently across them.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
