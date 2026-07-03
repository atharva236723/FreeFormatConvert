/**
 * Pure client-side image editing operations, all built on the Canvas API — no network, no
 * ffmpeg, no third-party library. Mirrors the "nothing leaves your device" story: every
 * function decodes the source, draws it onto an offscreen canvas, and re-encodes a Blob.
 *
 * Decoding reuses the same createImageBitmap→<img> fallback as imageEngine.ts so SVG and other
 * formats createImageBitmap can't handle still work. Encoding is limited to what canvas.toBlob
 * can actually produce (PNG/JPEG/WebP) — see `pickOutput`.
 */

export interface DecodedImage {
	width: number;
	height: number;
	source: CanvasImageSource;
	cleanup: () => void;
}

/** Formats canvas.toBlob can encode. Anything else falls back to PNG (lossless, keeps alpha). */
const CANVAS_ENCODABLE: Record<string, { mime: string; ext: string }> = {
	'image/jpeg': { mime: 'image/jpeg', ext: 'jpg' },
	'image/png': { mime: 'image/png', ext: 'png' },
	'image/webp': { mime: 'image/webp', ext: 'webp' },
};

export async function decodeImage(file: File | Blob): Promise<DecodedImage> {
	try {
		const bitmap = await createImageBitmap(file);
		return { width: bitmap.width, height: bitmap.height, source: bitmap, cleanup: () => bitmap.close() };
	} catch {
		const url = URL.createObjectURL(file);
		try {
			const img = new Image();
			img.decoding = 'async';
			await new Promise<void>((resolve, reject) => {
				img.onload = () => resolve();
				img.onerror = () => reject(new Error('The source image could not be decoded.'));
				img.src = url;
			});
			const width = img.naturalWidth || 512;
			const height = img.naturalHeight || 512;
			return { width, height, source: img, cleanup: () => URL.revokeObjectURL(url) };
		} catch (err) {
			URL.revokeObjectURL(url);
			throw err;
		}
	}
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (!blob) {
					reject(new Error('Image encoding failed'));
					return;
				}
				// A browser that can't encode the requested type silently returns image/png (with the
				// real type on the blob). Detect that mismatch so we never hand back a PNG under a .webp
				// name — the WebP-on-Safari-<14 case — and fail with a clear message instead.
				if (blob.type && blob.type !== mime) {
					reject(new Error(`This browser can't encode ${mime.replace('image/', '').toUpperCase()} — try PNG or JPG instead.`));
					return;
				}
				resolve(blob);
			},
			mime,
			quality,
		);
	});
}

/**
 * Chooses an output encoding. Preserves the source format when the browser can re-encode it
 * (JPEG/PNG/WebP); everything else (GIF, BMP, TIFF, SVG…) becomes PNG so transparency and detail
 * survive. `forceMime` overrides this — used by the compressor, which always emits JPEG/WebP.
 */
export function pickOutput(file: File, forceMime?: string): { mime: string; ext: string } {
	if (forceMime && CANVAS_ENCODABLE[forceMime]) return CANVAS_ENCODABLE[forceMime];
	return CANVAS_ENCODABLE[file.type] ?? CANVAS_ENCODABLE['image/png'];
}

export function replaceExt(filename: string, ext: string): string {
	const dot = filename.lastIndexOf('.');
	const base = dot === -1 ? filename : filename.slice(0, dot);
	return `${base}.${ext}`;
}

export function suffixName(filename: string, suffix: string, ext: string): string {
	const dot = filename.lastIndexOf('.');
	const base = dot === -1 ? filename : filename.slice(0, dot);
	return `${base}-${suffix}.${ext}`;
}

function makeCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(width));
	canvas.height = Math.max(1, Math.round(height));
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas 2D context unavailable');
	return { canvas, ctx };
}

export interface ImageDimensions {
	width: number;
	height: number;
}

export async function readDimensions(file: File): Promise<ImageDimensions> {
	const { width, height, cleanup } = await decodeImage(file);
	cleanup();
	return { width, height };
}

/** Resize to exact pixel dimensions. JPEG output flattens onto white so it isn't black. */
export async function resizeImage(
	file: File,
	target: ImageDimensions,
	opts: { quality?: number; forceMime?: string } = {},
): Promise<{ blob: Blob; ext: string }> {
	const { source, cleanup } = await decodeImage(file);
	try {
		const { mime, ext } = pickOutput(file, opts.forceMime);
		const { canvas, ctx } = makeCanvas(target.width, target.height);
		if (mime === 'image/jpeg') {
			ctx.fillStyle = '#ffffff';
			ctx.fillRect(0, 0, canvas.width, canvas.height);
		}
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
		const blob = await canvasToBlob(canvas, mime, opts.quality);
		return { blob, ext };
	} finally {
		cleanup();
	}
}

/** Rotate by an arbitrary angle (degrees, clockwise), growing the canvas to fit the result. */
export async function rotateImage(file: File, degrees: number): Promise<{ blob: Blob; ext: string }> {
	const { width, height, source, cleanup } = await decodeImage(file);
	try {
		const { mime, ext } = pickOutput(file);
		const rad = (degrees * Math.PI) / 180;
		const sin = Math.abs(Math.sin(rad));
		const cos = Math.abs(Math.cos(rad));
		const outW = width * cos + height * sin;
		const outH = width * sin + height * cos;
		const { canvas, ctx } = makeCanvas(outW, outH);
		if (mime === 'image/jpeg') {
			ctx.fillStyle = '#ffffff';
			ctx.fillRect(0, 0, canvas.width, canvas.height);
		}
		ctx.translate(canvas.width / 2, canvas.height / 2);
		ctx.rotate(rad);
		ctx.drawImage(source, -width / 2, -height / 2);
		const blob = await canvasToBlob(canvas, mime);
		return { blob, ext };
	} finally {
		cleanup();
	}
}

/** Mirror horizontally or vertically. */
export async function flipImage(file: File, axis: 'horizontal' | 'vertical'): Promise<{ blob: Blob; ext: string }> {
	const { width, height, source, cleanup } = await decodeImage(file);
	try {
		const { mime, ext } = pickOutput(file);
		const { canvas, ctx } = makeCanvas(width, height);
		if (mime === 'image/jpeg') {
			ctx.fillStyle = '#ffffff';
			ctx.fillRect(0, 0, canvas.width, canvas.height);
		}
		if (axis === 'horizontal') {
			ctx.translate(width, 0);
			ctx.scale(-1, 1);
		} else {
			ctx.translate(0, height);
			ctx.scale(1, -1);
		}
		ctx.drawImage(source, 0, 0);
		const blob = await canvasToBlob(canvas, mime);
		return { blob, ext };
	} finally {
		cleanup();
	}
}

export interface CropRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Crop a rectangle (in source pixels) out of the image. */
export async function cropImage(file: File, rect: CropRect): Promise<{ blob: Blob; ext: string }> {
	const { width, height, source, cleanup } = await decodeImage(file);
	try {
		const { mime, ext } = pickOutput(file);
		const x = Math.max(0, Math.min(rect.x, width));
		const y = Math.max(0, Math.min(rect.y, height));
		const w = Math.max(1, Math.min(rect.width, width - x));
		const h = Math.max(1, Math.min(rect.height, height - y));
		const { canvas, ctx } = makeCanvas(w, h);
		if (mime === 'image/jpeg') {
			ctx.fillStyle = '#ffffff';
			ctx.fillRect(0, 0, canvas.width, canvas.height);
		}
		ctx.drawImage(source, x, y, w, h, 0, 0, w, h);
		const blob = await canvasToBlob(canvas, mime);
		return { blob, ext };
	} finally {
		cleanup();
	}
}

/**
 * Compress a photo to land just under a target byte size. Decodes the source once, then for each
 * scale step (full size first) binary-searches the JPEG/WebP quality for the highest quality whose
 * encoding fits under `targetBytes`. Keeps the largest resolution that can hit the target, only
 * downscaling when even the lowest quality at the current size is still too big. If nothing fits
 * (target smaller than the tiniest achievable encoding), returns the smallest blob it produced and
 * flags `underTarget: false` so the UI can be honest about it.
 */
export async function compressImageToTarget(
	file: File,
	opts: { targetBytes: number; mime?: 'image/jpeg' | 'image/webp' },
): Promise<{ blob: Blob; ext: string; underTarget: boolean }> {
	const mime = opts.mime ?? 'image/jpeg';
	const ext = mime === 'image/webp' ? 'webp' : 'jpg';
	const target = Math.max(1, opts.targetBytes);
	const { width, height, source, cleanup } = await decodeImage(file);
	try {
		// Full size first, then progressively smaller — so we keep as much resolution as possible.
		const scales = [1, 0.85, 0.7, 0.55, 0.42, 0.32, 0.24, 0.16, 0.1];
		let smallest: Blob | null = null;
		for (const scale of scales) {
			const outW = Math.max(1, Math.round(width * scale));
			const outH = Math.max(1, Math.round(height * scale));
			const { canvas, ctx } = makeCanvas(outW, outH);
			if (mime === 'image/jpeg') {
				ctx.fillStyle = '#ffffff';
				ctx.fillRect(0, 0, canvas.width, canvas.height);
			}
			ctx.imageSmoothingQuality = 'high';
			ctx.drawImage(source, 0, 0, outW, outH);

			// Binary-search quality: size is monotonic in quality, so find the largest q that fits.
			let lo = 0.05;
			let hi = 0.95;
			let fit: Blob | null = null;
			for (let i = 0; i < 7; i++) {
				const q = (lo + hi) / 2;
				const blob = await canvasToBlob(canvas, mime, q);
				if (!smallest || blob.size < smallest.size) smallest = blob;
				if (blob.size <= target) {
					fit = blob;
					lo = q;
				} else {
					hi = q;
				}
			}
			if (fit) return { blob: fit, ext, underTarget: true };
		}
		// Even the smallest scale/quality overshot the target — hand back the best we managed.
		return { blob: smallest!, ext, underTarget: false };
	} finally {
		cleanup();
	}
}

/**
 * Compress a photo by re-encoding as JPEG (or WebP) at a chosen quality, optionally capping the
 * longest edge. Returns the new blob plus the original size so the UI can show the saving.
 */
export async function compressImage(
	file: File,
	opts: { quality: number; maxEdge?: number; mime?: 'image/jpeg' | 'image/webp' },
): Promise<{ blob: Blob; ext: string }> {
	const { width, height, source, cleanup } = await decodeImage(file);
	try {
		const mime = opts.mime ?? 'image/jpeg';
		const ext = mime === 'image/webp' ? 'webp' : 'jpg';
		let outW = width;
		let outH = height;
		if (opts.maxEdge && Math.max(width, height) > opts.maxEdge) {
			const scale = opts.maxEdge / Math.max(width, height);
			outW = Math.round(width * scale);
			outH = Math.round(height * scale);
		}
		const { canvas, ctx } = makeCanvas(outW, outH);
		if (mime === 'image/jpeg') {
			ctx.fillStyle = '#ffffff';
			ctx.fillRect(0, 0, canvas.width, canvas.height);
		}
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(source, 0, 0, outW, outH);
		const blob = await canvasToBlob(canvas, mime, opts.quality);
		return { blob, ext };
	} finally {
		cleanup();
	}
}
