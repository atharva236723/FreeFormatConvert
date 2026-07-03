/**
 * Shared pdfjs-dist loader used by both documentEngine.ts and tools/pdfTools.ts. It keeps pdfjs
 * lazy (the heavy library is only pulled in when a PDF is actually processed) and wires up a
 * polyfilled module worker so PDF work runs off the main thread.
 *
 * The worker is created once and reused: pdfjs does NOT terminate an externally-provided
 * `workerPort` on `loadingTask.destroy()` (its `#initializeFromPort` never sets the internal
 * `#webWorker`, so `destroy()`'s `terminate()` is a no-op), so a single cached worker is safe to
 * share across sequential conversions.
 */
import './pdfWorkerPolyfill';

let worker: Worker | null = null;

export async function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
	const pdfjs = await import('pdfjs-dist');
	worker ??= new Worker(new URL('./pdfjsWorker.ts', import.meta.url), { type: 'module' });
	pdfjs.GlobalWorkerOptions.workerPort = worker;
	return pdfjs;
}
