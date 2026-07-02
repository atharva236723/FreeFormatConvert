const MIME_FOR_EXT: Record<string, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
};

interface DecodedImage {
	width: number;
	height: number;
	source: CanvasImageSource;
	cleanup: () => void;
}

/**
 * Decode a source image to something drawable on a canvas. `createImageBitmap` is the fast
 * path and handles JPEG/PNG/WebP/GIF/BMP/AVIF, but it throws on SVG ("source image could not
 * be decoded"). So on failure we fall back to an <img> element, which the browser rasterizes
 * (including SVG) before we draw it. SVGs without an intrinsic size report 0×0, so default to
 * 512² in that case rather than producing an empty canvas.
 */
async function decodeImage(file: File): Promise<DecodedImage> {
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

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (blob) resolve(blob);
				else reject(new Error('Image encoding failed'));
			},
			mime,
			quality,
		);
	});
}

/**
 * Instant, in-memory raster conversion via the Canvas API. Only ever called for pairs
 * `isFastPathPair()` has already approved (decodable source, encodable target) — see
 * src/lib/formats.ts for exactly which formats those are and why.
 */
export async function convertImage(file: File, targetExt: string, quality = 0.92): Promise<Blob> {
	const mime = MIME_FOR_EXT[targetExt.toLowerCase()];
	if (!mime) {
		throw new Error(`Unsupported image target: ${targetExt}`);
	}

	const { width, height, source, cleanup } = await decodeImage(file);
	try {
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			throw new Error('Canvas 2D context unavailable');
		}
		ctx.drawImage(source, 0, 0, width, height);
		return await canvasToBlob(canvas, mime, quality);
	} finally {
		cleanup();
	}
}

/** Largest edge an ICO frame can describe (its width/height fields are a single byte). */
const ICO_MAX_DIM = 256;

/**
 * Encode an image to a real .ico. ffmpeg's wasm core has no ICO muxer, so this is done by
 * hand: rasterize the source to a PNG (downscaled to fit 256², ICO's per-frame limit) and
 * wrap it in a single-entry ICO container. Modern Windows/browsers read PNG-payload ICOs
 * natively, which keeps alpha and avoids a lossy BMP round-trip.
 */
export async function convertImageToIco(file: File): Promise<Blob> {
	const { width, height, source, cleanup } = await decodeImage(file);
	try {
		const scale = Math.min(1, ICO_MAX_DIM / Math.max(width, height));
		const w = Math.max(1, Math.round(width * scale));
		const h = Math.max(1, Math.round(height * scale));

		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			throw new Error('Canvas 2D context unavailable');
		}
		ctx.drawImage(source, 0, 0, w, h);

		const pngBlob = await canvasToBlob(canvas, 'image/png', 1);
		const png = new Uint8Array(await pngBlob.arrayBuffer());
		return buildIco(png, w, h);
	} finally {
		cleanup();
	}
}

function buildIco(png: Uint8Array, width: number, height: number): Blob {
	// ICONDIR (6 bytes) + one ICONDIRENTRY (16 bytes), then the PNG payload.
	const head = new ArrayBuffer(6 + 16);
	const dv = new DataView(head);
	dv.setUint16(0, 0, true); // reserved, must be 0
	dv.setUint16(2, 1, true); // image type: 1 = icon
	dv.setUint16(4, 1, true); // number of images
	dv.setUint8(6, width >= 256 ? 0 : width); // width (0 means 256)
	dv.setUint8(7, height >= 256 ? 0 : height); // height (0 means 256)
	dv.setUint8(8, 0); // color palette count (0 = none)
	dv.setUint8(9, 0); // reserved
	dv.setUint16(10, 1, true); // color planes
	dv.setUint16(12, 32, true); // bits per pixel
	dv.setUint32(14, png.length, true); // size of image data
	dv.setUint32(18, 6 + 16, true); // offset of image data from file start
	return new Blob([head, png as BlobPart], { type: 'image/x-icon' });
}
