/**
 * Client-side PDF editing (merge / extract / remove / rotate / split) built on pdf-lib, plus
 * page-thumbnail rendering via pdfjs-dist. Both libraries are heavy, so this module is only ever
 * dynamically imported by pdf-tool-controller.ts — keeping them out of the eager bundle, exactly
 * like ffmpeg's core and the document engine. All page numbers in this API are 1-based.
 */

async function loadPdfLib() {
	return import('pdf-lib');
}

async function loadPdfjs() {
	const pdfjs = await import('pdfjs-dist');
	const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
	pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
	return pdfjs;
}

export async function getPageCount(file: File): Promise<number> {
	const { PDFDocument } = await loadPdfLib();
	const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
	return doc.getPageCount();
}

function toBlob(bytes: Uint8Array): Blob {
	return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

/** Concatenate several PDFs, in the given order, into one document. */
export async function mergePdfs(files: File[]): Promise<Blob> {
	const { PDFDocument } = await loadPdfLib();
	const out = await PDFDocument.create();
	for (const file of files) {
		const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
		const pages = await out.copyPages(src, src.getPageIndices());
		pages.forEach((p) => out.addPage(p));
	}
	return toBlob(await out.save());
}

/** Build a new PDF containing only the given pages, in the order supplied. */
export async function extractPages(file: File, pages: number[]): Promise<Blob> {
	const { PDFDocument } = await loadPdfLib();
	const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
	const out = await PDFDocument.create();
	const indices = pages.map((p) => p - 1).filter((i) => i >= 0 && i < src.getPageCount());
	const copied = await out.copyPages(src, indices);
	copied.forEach((p) => out.addPage(p));
	return toBlob(await out.save());
}

/** Remove the given pages, keeping the rest in order. */
export async function removePages(file: File, pages: number[]): Promise<Blob> {
	const total = await getPageCount(file);
	const remove = new Set(pages);
	const keep: number[] = [];
	for (let p = 1; p <= total; p++) if (!remove.has(p)) keep.push(p);
	return extractPages(file, keep);
}

/** Rotate the given pages (all if none supplied) by a multiple of 90°, added to their current
 * rotation. */
export async function rotatePdf(file: File, angle: number, pages?: number[]): Promise<Blob> {
	const { PDFDocument, degrees } = await loadPdfLib();
	const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
	const targetSet = pages && pages.length ? new Set(pages) : null;
	doc.getPages().forEach((page, i) => {
		if (targetSet && !targetSet.has(i + 1)) return;
		const current = page.getRotation().angle;
		page.setRotation(degrees((current + angle) % 360));
	});
	return toBlob(await doc.save());
}

/** Split each selected page (all if none supplied) into its own single-page PDF, packaged in a
 * ZIP. Returns the zip blob and a suggested filename. */
export async function splitToZip(file: File, pages: number[], baseName: string): Promise<Blob> {
	const { PDFDocument } = await loadPdfLib();
	const JSZip = (await import('jszip')).default;
	const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
	const zip = new JSZip();
	const list = pages.length ? pages : src.getPageIndices().map((i) => i + 1);
	for (const p of list) {
		const idx = p - 1;
		if (idx < 0 || idx >= src.getPageCount()) continue;
		const out = await PDFDocument.create();
		const [copied] = await out.copyPages(src, [idx]);
		out.addPage(copied);
		const bytes = await out.save();
		zip.file(`${baseName}-page-${p}.pdf`, bytes);
	}
	return zip.generateAsync({ type: 'blob' });
}

export interface PageThumb {
	page: number;
	dataUrl: string;
}

/**
 * Render small preview thumbnails for every page so the UI can show a selectable grid. Capped
 * page count keeps memory bounded on very large PDFs. `onThumb` streams each thumbnail as it's
 * ready so the grid can fill progressively.
 */
export async function renderThumbnails(
	file: File,
	opts: { maxPages?: number; width?: number; onThumb?: (t: PageThumb) => void } = {},
): Promise<number> {
	const maxPages = opts.maxPages ?? 200;
	const targetWidth = opts.width ?? 150;
	const pdfjs = await loadPdfjs();
	const data = new Uint8Array(await file.arrayBuffer());
	const loadingTask = pdfjs.getDocument({ data });
	const doc = await loadingTask.promise;
	const total = Math.min(doc.numPages, maxPages);
	for (let p = 1; p <= total; p++) {
		const page = await doc.getPage(p);
		const viewport = page.getViewport({ scale: 1 });
		const scale = targetWidth / viewport.width;
		const scaled = page.getViewport({ scale });
		const canvas = document.createElement('canvas');
		canvas.width = Math.ceil(scaled.width);
		canvas.height = Math.ceil(scaled.height);
		const ctx = canvas.getContext('2d')!;
		await page.render({ canvas, canvasContext: ctx, viewport: scaled }).promise;
		opts.onThumb?.({ page: p, dataUrl: canvas.toDataURL('image/jpeg', 0.7) });
		page.cleanup();
	}
	const pageCount = doc.numPages;
	await loadingTask.destroy();
	return pageCount;
}
