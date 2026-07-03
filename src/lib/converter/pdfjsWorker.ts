/**
 * pdf.js web-worker entry. Establishes the `Promise.withResolvers` polyfill (see
 * pdfWorkerPolyfill.ts) inside the *worker* scope before pdfjs's real worker module runs, then
 * hands off to it. The two static imports are evaluated in source order per the ES module spec, so
 * the polyfill is installed before `pdf.worker.min.mjs` evaluates.
 *
 * Referenced by pdfjsLoader.ts via
 * `new Worker(new URL('./pdfjsWorker.ts', import.meta.url), { type: 'module' })`, which is the
 * pattern Vite recognizes to bundle this as a module worker.
 */
import './pdfWorkerPolyfill';
import 'pdfjs-dist/build/pdf.worker.min.mjs';
