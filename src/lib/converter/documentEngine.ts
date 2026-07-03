import type { jsPDF as JsPdfType } from 'jspdf';
import type JSZipInstance from 'jszip';
import { ConversionError } from './errors';
import { loadPdfjs } from './pdfjsLoader';
import type { DocumentOp } from '../formats';

export interface ConvertDocumentResult {
	blob: Blob;
	filename: string;
}

export interface DocumentOptions {
	onProgress?: (ratio: number) => void;
}

/**
 * The fully client-side document conversions. Everything here is dynamically imported so the
 * heavy PDF/DOCX/ebook libraries (jspdf, pdfjs-dist, mammoth, jszip, docx, heic2any) never load
 * until a document conversion is actually run — mirroring the lazy loading of ffmpeg.wasm in
 * ffmpegEngine.ts.
 */
export async function convertDocument(
	file: File,
	op: DocumentOp,
	targetExt: string,
	baseName: string,
	opts: DocumentOptions = {},
): Promise<ConvertDocumentResult> {
	switch (op) {
		case 'image-to-pdf':
			return imageToPdf(file, baseName, opts.onProgress);
		case 'pdf-to-image':
			return pdfToImage(file, targetExt, baseName, opts.onProgress);
		case 'docx-to-pdf':
			return docxToPdf(file, baseName, opts.onProgress);
		case 'docx-to-image':
			return docxToImage(file, targetExt, baseName, opts.onProgress);
		case 'pdf-to-docx':
			return pdfToDocx(file, baseName, opts.onProgress);
		case 'pdf-to-epub':
			return pdfToEpub(file, baseName, opts.onProgress);
		case 'epub-to-pdf':
			return epubToPdf(file, baseName, opts.onProgress);
	}
}

// ---------------------------------------------------------------------------
// image → PDF
// ---------------------------------------------------------------------------

async function imageToPdf(
	file: File,
	baseName: string,
	onProgress?: (r: number) => void,
): Promise<ConvertDocumentResult> {
	onProgress?.(0.15);

	const bitmap = await fileToBitmap(file);

	const { width, height } = bitmap;
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new ConversionError('unknown', 'Canvas 2D context unavailable.');
	// Flatten onto white so transparent PNGs don't turn black once encoded as JPEG.
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, width, height);
	ctx.drawImage(bitmap, 0, 0);
	bitmap.close();

	const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
	onProgress?.(0.6);

	const { jsPDF } = await import('jspdf');
	// Custom page format sized exactly to the image (in px units) so the picture fills the
	// page with no letterboxing, regardless of aspect ratio.
	const pdf = new jsPDF({ unit: 'px', format: [width, height], compress: true });
	pdf.addImage(dataUrl, 'JPEG', 0, 0, width, height);
	const blob = pdf.output('blob');
	onProgress?.(1);

	return { blob, filename: `${baseName}.pdf` };
}

/**
 * Decodes an image file into an ImageBitmap. Most formats go straight through
 * `createImageBitmap`, but HEIC/HEIF can't be decoded natively by any mainstream browser, so
 * those are first transcoded to JPEG with heic2any (a WASM libheif wrapper) and then decoded.
 */
async function fileToBitmap(file: File): Promise<ImageBitmap> {
	if (isHeic(file)) {
		let jpegBlob: Blob;
		try {
			const heic2any = (await import('heic2any')).default;
			const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
			jpegBlob = Array.isArray(out) ? out[0] : out;
		} catch {
			throw new ConversionError('unsupported-pair', 'This HEIC image could not be read.');
		}
		try {
			return await createImageBitmap(jpegBlob);
		} catch {
			throw new ConversionError('unsupported-pair', 'This HEIC image could not be read.');
		}
	}

	try {
		return await createImageBitmap(file);
	} catch {
		throw new ConversionError('unsupported-pair', 'This image could not be read.');
	}
}

function isHeic(file: File): boolean {
	const type = file.type.toLowerCase();
	if (type === 'image/heic' || type === 'image/heif') return true;
	const name = file.name.toLowerCase();
	return name.endsWith('.heic') || name.endsWith('.heif');
}

// ---------------------------------------------------------------------------
// PDF → image (JPG / PNG)
// ---------------------------------------------------------------------------

/** Cap so a giant PDF can't spawn hundreds of full-res canvases and exhaust memory. */
const PDF_TO_IMAGE_MAX_PAGES = 100;
/** Longest-edge pixel budget per rendered page — keeps output crisp but bounded. */
const PDF_RENDER_MAX_EDGE = 2400;
const PDF_RENDER_TARGET_SCALE = 2;

async function pdfToImage(
	file: File,
	targetExt: string,
	baseName: string,
	onProgress?: (r: number) => void,
): Promise<ConvertDocumentResult> {
	onProgress?.(0.05);
	const data = new Uint8Array(await file.arrayBuffer());
	return pdfDataToImages(data, targetExt, baseName, onProgress);
}

/**
 * Rasterizes every page of an in-memory PDF (a raw byte buffer, so it works both for an uploaded
 * PDF and for one we generate on the fly from a DOCX) to JPG/PNG. A single page returns one image;
 * multiple pages are bundled into a ZIP. `startRatio` lets a caller reserve the leading part of the
 * progress bar for an earlier step (e.g. the DOCX→PDF pass that precedes DOCX→image).
 */
async function pdfDataToImages(
	data: Uint8Array,
	targetExt: string,
	baseName: string,
	onProgress?: (r: number) => void,
	startRatio = 0.05,
): Promise<ConvertDocumentResult> {
	const isPng = targetExt.toLowerCase() === 'png';
	const mime = isPng ? 'image/png' : 'image/jpeg';
	const outExt = isPng ? 'png' : 'jpg';

	const pdfjs = await loadPdfjs();
	const loadingTask = pdfjs.getDocument({ data });
	let doc;
	try {
		doc = await loadingTask.promise;
	} catch {
		throw new ConversionError('unsupported-pair', 'This file could not be read as a PDF.');
	}

	const total = doc.numPages;
	if (total > PDF_TO_IMAGE_MAX_PAGES) {
		await loadingTask.destroy();
		throw new ConversionError(
			'file-too-large',
			`This document has ${total} pages. Converting to images is limited to ${PDF_TO_IMAGE_MAX_PAGES} pages to keep it fast in the browser.`,
		);
	}

	const span = 0.95 - startRatio;
	const pageBlobs: Blob[] = [];
	try {
		for (let n = 1; n <= total; n++) {
			const page = await doc.getPage(n);
			const { blob } = await renderPdfPage(page, mime, PDF_RENDER_MAX_EDGE);
			pageBlobs.push(blob);
			page.cleanup();
			onProgress?.(startRatio + (n / total) * span);
		}
	} finally {
		await loadingTask.destroy();
	}

	if (pageBlobs.length === 1) {
		onProgress?.(1);
		return { blob: pageBlobs[0], filename: `${baseName}.${outExt}` };
	}

	// Multiple pages → one image each, bundled into a ZIP (zero-padded so they sort right).
	const { default: JSZip } = await import('jszip');
	const zip = new JSZip();
	const pad = String(pageBlobs.length).length;
	pageBlobs.forEach((blob, i) => {
		zip.file(`${baseName}-${String(i + 1).padStart(pad, '0')}.${outExt}`, blob);
	});
	const zipBlob = await zip.generateAsync({ type: 'blob' });
	onProgress?.(1);

	return { blob: zipBlob, filename: `${baseName}.zip` };
}

/** Renders a single pdfjs page to a raster blob, white-flattened so JPEG transparency isn't black. */
async function renderPdfPage(
	page: { getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: any) => { promise: Promise<void> } },
	mime: string,
	maxEdge: number,
): Promise<{ blob: Blob; width: number; height: number }> {
	const base = page.getViewport({ scale: 1 });
	const longest = Math.max(base.width, base.height);
	const scale = Math.min(PDF_RENDER_TARGET_SCALE, maxEdge / longest);
	const viewport = page.getViewport({ scale });

	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.ceil(viewport.width));
	canvas.height = Math.max(1, Math.ceil(viewport.height));
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new ConversionError('unknown', 'Canvas 2D context unavailable.');
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	await page.render({ canvasContext: ctx, viewport, canvas }).promise;
	return { blob: await canvasToBlob(canvas, mime), width: canvas.width, height: canvas.height };
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new ConversionError('unknown', 'Image encoding failed.'))),
			mime,
			mime === 'image/jpeg' ? 0.92 : undefined,
		);
	});
}

// ---------------------------------------------------------------------------
// PDF text extraction (shared by PDF → Word and PDF → EPUB)
// ---------------------------------------------------------------------------

/** Bounds text extraction so a huge PDF can't stall the tab (text is cheap, but not free). */
const PDF_TEXT_MAX_PAGES = 1000;

/**
 * Pulls text out of a PDF, grouped per page into paragraphs. pdfjs hands back positioned text
 * runs with an `hasEOL` flag; we rebuild lines from that, then merge consecutive non-blank lines
 * into paragraphs (a blank line ends a paragraph). This reflows the text — it deliberately does
 * NOT try to reconstruct the PDF's exact visual layout, columns, or image placement.
 */
async function extractPdfPages(file: File, onProgress?: (r: number) => void): Promise<string[][]> {
	const pdfjs = await loadPdfjs();
	const data = new Uint8Array(await file.arrayBuffer());
	const loadingTask = pdfjs.getDocument({ data });

	let doc;
	try {
		doc = await loadingTask.promise;
	} catch {
		throw new ConversionError('unsupported-pair', 'This file could not be read as a PDF.');
	}

	const total = Math.min(doc.numPages, PDF_TEXT_MAX_PAGES);
	const pages: string[][] = [];
	try {
		for (let n = 1; n <= total; n++) {
			const page = await doc.getPage(n);
			const content = await page.getTextContent();
			pages.push(itemsToParagraphs(content.items));
			page.cleanup();
			onProgress?.(0.1 + (n / total) * 0.6);
		}
	} finally {
		await loadingTask.destroy();
	}

	return pages;
}

/** Rebuilds paragraphs from pdfjs' positioned text runs (using each run's `hasEOL` line break). */
function itemsToParagraphs(items: ReadonlyArray<unknown>): string[] {
	const lines: string[] = [];
	let line = '';
	for (const item of items) {
		if (!item || typeof item !== 'object' || !('str' in item)) continue;
		const run = item as { str: string; hasEOL?: boolean };
		line += run.str;
		if (run.hasEOL) {
			lines.push(line);
			line = '';
		}
	}
	if (line.trim()) lines.push(line);
	return linesToParagraphs(lines);
}

/** Merges wrapped lines into paragraphs; a blank line marks a paragraph boundary. */
function linesToParagraphs(lines: string[]): string[] {
	const paragraphs: string[] = [];
	let buffer = '';
	for (const raw of lines) {
		const text = raw.trim();
		if (!text) {
			if (buffer) paragraphs.push(buffer);
			buffer = '';
			continue;
		}
		buffer = buffer ? `${buffer} ${text}` : text;
	}
	if (buffer) paragraphs.push(buffer);
	return paragraphs;
}

// ---------------------------------------------------------------------------
// PDF → Word (DOCX) — text-only
// ---------------------------------------------------------------------------

/**
 * Longest-edge budget for a page rendered as an image and embedded in the Word doc (the scanned-PDF
 * fallback below). Smaller than the PDF→image budget so the .docx doesn't balloon.
 */
const DOCX_EMBED_MAX_EDGE = 1600;
/** Approximate content box (px @ 96 DPI) of a default A4 Word page with 1" margins — embed fit target. */
const DOCX_PAGE_BOX = { width: 600, height: 900 };

/**
 * Extracts the PDF's text and writes a real, editable .docx (via the `docx` library). Paragraphs
 * are preserved and each PDF page starts on a new Word page. For a page with *no extractable text*
 * (e.g. a scanned/image-only PDF), the page is rendered to an image and embedded instead — so a
 * scanned document still converts to a usable Word file rather than coming out blank. Trade-off: it
 * reflows text and does not reproduce the source's exact layout, columns, fonts, or image positions.
 */
async function pdfToDocx(
	file: File,
	baseName: string,
	onProgress?: (r: number) => void,
): Promise<ConvertDocumentResult> {
	onProgress?.(0.05);
	const pdfjs = await loadPdfjs();
	const data = new Uint8Array(await file.arrayBuffer());
	const loadingTask = pdfjs.getDocument({ data });

	let doc;
	try {
		doc = await loadingTask.promise;
	} catch {
		throw new ConversionError('unsupported-pair', 'This file could not be read as a PDF.');
	}

	const { Document, Packer, Paragraph, TextRun, ImageRun } = await import('docx');
	const children: InstanceType<typeof Paragraph>[] = [];

	const total = Math.min(doc.numPages, PDF_TEXT_MAX_PAGES);
	try {
		for (let n = 1; n <= total; n++) {
			const page = await doc.getPage(n);
			const content = await page.getTextContent();
			const paragraphs = itemsToParagraphs(content.items);
			const startsNewPage = n > 1;

			if (paragraphs.length === 0) {
				// No text layer (scanned page): embed the rendered page image so the content survives.
				const { blob, width, height } = await renderPdfPage(page, 'image/png', DOCX_EMBED_MAX_EDGE);
				const bytes = new Uint8Array(await blob.arrayBuffer());
				children.push(
					new Paragraph({
						pageBreakBefore: startsNewPage,
						children: [
							new ImageRun({
								type: 'png',
								data: bytes,
								transformation: fitToBox(width, height, DOCX_PAGE_BOX),
							}),
						],
					}),
				);
			} else {
				paragraphs.forEach((text, i) => {
					children.push(
						new Paragraph({
							children: [new TextRun(text)],
							pageBreakBefore: startsNewPage && i === 0,
							spacing: { after: 160 },
						}),
					);
				});
			}

			page.cleanup();
			onProgress?.(0.1 + (n / total) * 0.8);
		}
	} finally {
		await loadingTask.destroy();
	}

	if (children.length === 0) {
		children.push(new Paragraph({ children: [new TextRun('')] }));
	}

	const outDoc = new Document({ sections: [{ children }] });
	const blob = await Packer.toBlob(outDoc);
	onProgress?.(1);

	return { blob, filename: `${baseName}.docx` };
}

/** Scales (w×h) down to fit within `box`, preserving aspect ratio. Never scales up. */
function fitToBox(w: number, h: number, box: { width: number; height: number }): { width: number; height: number } {
	const ratio = Math.min(box.width / w, box.height / h, 1);
	return { width: Math.round(w * ratio), height: Math.round(h * ratio) };
}

// ---------------------------------------------------------------------------
// PDF → EPUB (ebook) — text-only
// ---------------------------------------------------------------------------

/**
 * Extracts the PDF's text and packages it as a valid EPUB 3 ebook: reflowable XHTML wrapped in
 * the standard container (mimetype + META-INF/container.xml + OPF package + nav). Text-only —
 * the source's exact layout and images are not carried over.
 */
async function pdfToEpub(
	file: File,
	baseName: string,
	onProgress?: (r: number) => void,
): Promise<ConvertDocumentResult> {
	onProgress?.(0.05);
	const pages = await extractPdfPages(file, onProgress);

	const bodyHtml = pages
		.flat()
		.map((p) => `<p>${escapeHtml(p)}</p>`)
		.join('\n')
		|| '<p></p>';

	const blob = await buildEpub(baseName, bodyHtml);
	onProgress?.(1);

	return { blob, filename: `${baseName}.epub` };
}

/** Assembles a minimal, spec-valid EPUB 3 from a title and a chunk of body XHTML. */
async function buildEpub(title: string, bodyHtml: string): Promise<Blob> {
	const { default: JSZip } = await import('jszip');
	const zip = new JSZip();
	const safeTitle = escapeHtml(title || 'Document');
	const uid = `urn:uuid:${cryptoRandomUuid()}`;

	// The mimetype entry must be first and stored uncompressed per the EPUB spec.
	zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

	zip.file(
		'META-INF/container.xml',
		`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`,
	);

	zip.file(
		'OEBPS/content.opf',
		`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${uid}</dc:identifier>
    <dc:title>${safeTitle}</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="content" href="content.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="content"/>
  </spine>
</package>
`,
	);

	zip.file(
		'OEBPS/nav.xhtml',
		`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><title>${safeTitle}</title></head>
<body>
  <nav epub:type="toc" id="toc"><h1>Contents</h1><ol><li><a href="content.xhtml">${safeTitle}</a></li></ol></nav>
</body>
</html>
`,
	);

	zip.file(
		'OEBPS/content.xhtml',
		`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head><title>${safeTitle}</title></head>
<body>
${bodyHtml}
</body>
</html>
`,
	);

	return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
}

function cryptoRandomUuid(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
	return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// EPUB → PDF — text-only
// ---------------------------------------------------------------------------

/**
 * Unzips an EPUB, walks its OPF spine in reading order, inlines each XHTML document's images as
 * data URLs, then flows the combined HTML into a text-selectable PDF via the same block-layout
 * pass used by DOCX→PDF. Reflows to clean text — it does not reproduce the ebook's exact styling.
 */
async function epubToPdf(
	file: File,
	baseName: string,
	onProgress?: (r: number) => void,
): Promise<ConvertDocumentResult> {
	onProgress?.(0.1);
	const { default: JSZip } = await import('jszip');

	let zip: JSZipInstance;
	try {
		zip = await JSZip.loadAsync(await file.arrayBuffer());
	} catch {
		throw new ConversionError('unsupported-pair', 'This file could not be read as an EPUB.');
	}

	const parser = new DOMParser();

	// 1. container.xml → path to the OPF package file.
	const containerXml = await readZipText(zip, 'META-INF/container.xml');
	if (!containerXml) throw new ConversionError('unsupported-pair', 'This EPUB is missing its container manifest.');
	const container = parser.parseFromString(containerXml, 'application/xml');
	const opfPath = container.querySelector('rootfile')?.getAttribute('full-path');
	if (!opfPath) throw new ConversionError('unsupported-pair', 'This EPUB has no readable package file.');

	// 2. OPF → manifest (id → href) + spine (reading order).
	const opfXml = await readZipText(zip, opfPath);
	if (!opfXml) throw new ConversionError('unsupported-pair', 'This EPUB package file could not be read.');
	const opf = parser.parseFromString(opfXml, 'application/xml');
	const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

	const manifest = new Map<string, string>();
	opf.querySelectorAll('manifest > item').forEach((item) => {
		const id = item.getAttribute('id');
		const href = item.getAttribute('href');
		if (id && href) manifest.set(id, href);
	});

	const spine = Array.from(opf.querySelectorAll('spine > itemref'))
		.map((ref) => ref.getAttribute('idref'))
		.filter((id): id is string => Boolean(id))
		.map((id) => manifest.get(id))
		.filter((href): href is string => Boolean(href));

	if (spine.length === 0) throw new ConversionError('unsupported-pair', 'This EPUB has no readable content.');

	// 3. Read each spine document, inline its images, collect its body markup.
	const bodies: string[] = [];
	for (let i = 0; i < spine.length; i++) {
		const href = resolvePath(opfDir, spine[i]);
		const html = await readZipText(zip, href);
		if (!html) continue;
		const docDir = href.includes('/') ? href.slice(0, href.lastIndexOf('/') + 1) : '';
		const bodyEl = parser.parseFromString(html, 'application/xhtml+xml').querySelector('body')
			?? parser.parseFromString(html, 'text/html').querySelector('body');
		if (!bodyEl) continue;
		await inlineImages(bodyEl, zip, docDir);
		bodies.push(bodyEl.innerHTML);
		onProgress?.(0.1 + ((i + 1) / spine.length) * 0.6);
	}

	const combined = bodies.join('\n<hr/>\n') || '<p></p>';

	const { jsPDF } = await import('jspdf');
	const pdf = renderHtmlToPdf(new jsPDF({ unit: 'pt', format: 'a4', compress: true }), combined);
	onProgress?.(1);

	return { blob: pdf.output('blob'), filename: `${baseName}.pdf` };
}

async function readZipText(zip: JSZipInstance, path: string): Promise<string | null> {
	const entry = zip.file(path) ?? zip.file(decodeURIComponent(path));
	return entry ? entry.async('string') : null;
}

/** Resolves a possibly-relative EPUB href against a base directory (handles `../` segments). */
function resolvePath(baseDir: string, href: string): string {
	const clean = href.split('#')[0];
	const segments = (baseDir + clean).split('/');
	const out: string[] = [];
	for (const seg of segments) {
		if (seg === '..') out.pop();
		else if (seg !== '.' && seg !== '') out.push(seg);
	}
	return out.join('/');
}

/** Replaces each <img> src with a data URL read from the EPUB zip, so the PDF renderer can draw it. */
async function inlineImages(root: Element, zip: JSZipInstance, docDir: string): Promise<void> {
	const imgs = Array.from(root.querySelectorAll('img'));
	for (const img of imgs) {
		const src = img.getAttribute('src');
		if (!src || src.startsWith('data:')) continue;
		const entry = zip.file(resolvePath(docDir, src)) ?? zip.file(decodeURIComponent(resolvePath(docDir, src)));
		if (!entry) continue;
		try {
			const base64 = await entry.async('base64');
			img.setAttribute('src', `data:${guessImageMime(src)};base64,${base64}`);
		} catch {
			/* leave the src as-is; renderHtmlToPdf will skip non-data images */
		}
	}
}

function guessImageMime(path: string): string {
	const ext = path.split('.').pop()?.toLowerCase();
	if (ext === 'png') return 'image/png';
	if (ext === 'gif') return 'image/gif';
	if (ext === 'svg') return 'image/svg+xml';
	if (ext === 'webp') return 'image/webp';
	return 'image/jpeg';
}

// ---------------------------------------------------------------------------
// DOCX → PDF
// ---------------------------------------------------------------------------

async function docxToPdf(
	file: File,
	baseName: string,
	onProgress?: (r: number) => void,
): Promise<ConvertDocumentResult> {
	const pdf = await docxToPdfDoc(file, onProgress);
	onProgress?.(1);
	return { blob: pdf.output('blob'), filename: `${baseName}.pdf` };
}

/**
 * Shared DOCX→PDF core: mammoth extracts the document as HTML, then `renderHtmlToPdf` lays it out
 * into a text-selectable PDF. Returns the jsPDF instance so callers can either serialize it (DOCX→PDF)
 * or hand its bytes to the rasterizer (DOCX→image). Emits progress up to ~0.5.
 */
async function docxToPdfDoc(file: File, onProgress?: (r: number) => void): Promise<JsPdfType> {
	onProgress?.(0.1);

	// The prebuilt browser bundle avoids pulling mammoth's Node-only dependencies.
	const mammothMod: any = await import('mammoth/mammoth.browser.js');
	const mammoth = mammothMod.default ?? mammothMod;
	const arrayBuffer = await file.arrayBuffer();

	let html: string;
	try {
		const result = await mammoth.convertToHtml({ arrayBuffer });
		html = result.value ?? '';
	} catch {
		throw new ConversionError('unsupported-pair', 'This file could not be read as a Word (.docx) document.');
	}
	onProgress?.(0.5);

	const { jsPDF } = await import('jspdf');
	return renderHtmlToPdf(new jsPDF({ unit: 'pt', format: 'a4', compress: true }), html);
}

/**
 * DOCX → JPG/PNG. There's no direct client-side Word renderer, so we route through the same
 * DOCX→PDF layout pass and then rasterize each resulting PDF page. A single-page doc yields one
 * image; a multi-page doc yields one image per page, bundled into a ZIP (handled by pdfDataToImages).
 */
async function docxToImage(
	file: File,
	targetExt: string,
	baseName: string,
	onProgress?: (r: number) => void,
): Promise<ConvertDocumentResult> {
	// docxToPdfDoc emits up to 0.5; scale it into the first ~40% of the bar, then rasterize.
	const pdf = await docxToPdfDoc(file, (r) => onProgress?.(r * 0.8));
	onProgress?.(0.45);
	const data = new Uint8Array(pdf.output('arraybuffer'));
	return pdfDataToImages(data, targetExt, baseName, onProgress, 0.45);
}

/**
 * Renders mammoth's HTML into a real, text-selectable PDF via a manual block layout pass —
 * not html2canvas rasterization. This keeps output small, text searchable, and pagination
 * reliable. Trade-off: it flows block-level structure (headings, paragraphs, lists, tables,
 * images) rather than reproducing exact Word layout, and uses jsPDF's built-in Helvetica,
 * which only covers Latin-1 (non-Latin scripts won't render).
 */
function renderHtmlToPdf(pdf: JsPdfType, html: string): JsPdfType {
	const pageW = pdf.internal.pageSize.getWidth();
	const pageH = pdf.internal.pageSize.getHeight();
	const margin = 56;
	const maxW = pageW - margin * 2;
	const lineGap = 1.15;
	let y = margin;

	const ensureSpace = (h: number) => {
		if (y + h > pageH - margin) {
			pdf.addPage();
			y = margin;
		}
	};

	const writeText = (
		raw: string,
		{ size, bold = false, indent = 0, spacingAfter }: { size: number; bold?: boolean; indent?: number; spacingAfter?: number },
	) => {
		const text = (raw ?? '').replace(/\s+/g, ' ').trim();
		if (!text) return;
		pdf.setFont('helvetica', bold ? 'bold' : 'normal');
		pdf.setFontSize(size);
		const lineH = size * lineGap;
		for (const line of pdf.splitTextToSize(text, maxW - indent) as string[]) {
			ensureSpace(lineH);
			pdf.text(line, margin + indent, y + size * 0.85);
			y += lineH;
		}
		y += spacingAfter ?? size * 0.5;
	};

	const addImg = (imgEl: Element) => {
		const src = imgEl.getAttribute('src');
		if (!src || !src.startsWith('data:')) return;
		try {
			const props = pdf.getImageProperties(src);
			let w = maxW;
			let h = (props.height * w) / props.width;
			const maxH = pageH - margin * 2;
			if (h > maxH) {
				h = maxH;
				w = (props.width * h) / props.height;
			}
			ensureSpace(h + 8);
			pdf.addImage(src, margin, y, w, h);
			y += h + 10;
		} catch {
			/* skip images jsPDF can't decode */
		}
	};

	// Structural wrappers that hold block content rather than being a text block themselves.
	// EPUB documents nest their content inside these (unlike mammoth's flat output), so we
	// recurse into them to reach the real headings/paragraphs instead of dumping the whole
	// subtree as one giant paragraph.
	const CONTAINER_TAGS = new Set([
		'div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'nav', 'body', 'blockquote', 'figure', 'details',
	]);

	const processNode = (node: Element) => {
		const tag = node.tagName.toLowerCase();
		switch (tag) {
			case 'h1':
				writeText(node.textContent ?? '', { size: 22, bold: true, spacingAfter: 10 });
				break;
			case 'h2':
				writeText(node.textContent ?? '', { size: 17, bold: true, spacingAfter: 8 });
				break;
			case 'h3':
			case 'h4':
			case 'h5':
			case 'h6':
				writeText(node.textContent ?? '', { size: 14, bold: true, spacingAfter: 6 });
				break;
			case 'ul':
			case 'ol':
				Array.from(node.children).forEach((li, i) => {
					const bullet = tag === 'ol' ? `${i + 1}. ` : '•  ';
					writeText(bullet + (li.textContent ?? ''), { size: 11, indent: 16, spacingAfter: 3 });
				});
				y += 4;
				break;
			case 'table':
				Array.from(node.querySelectorAll('tr')).forEach((tr) => {
					const cells = Array.from(tr.children).map((td) => (td.textContent ?? '').replace(/\s+/g, ' ').trim());
					writeText(cells.join('    |    '), { size: 10, spacingAfter: 3 });
				});
				y += 6;
				break;
			case 'img':
				addImg(node);
				break;
			default: {
				if (CONTAINER_TAGS.has(tag) && node.children.length > 0) {
					for (const child of Array.from(node.children)) processNode(child);
				} else {
					const img = node.querySelector?.('img');
					if (img) addImg(img);
					writeText(node.textContent ?? '', { size: 11, spacingAfter: 8 });
				}
			}
		}
	};

	const dom = new DOMParser().parseFromString(html || '<p></p>', 'text/html');
	for (const node of Array.from(dom.body.children)) processNode(node);

	return pdf;
}
