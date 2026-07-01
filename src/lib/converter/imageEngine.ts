const MIME_FOR_EXT: Record<string, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
};

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

	const bitmap = await createImageBitmap(file);
	const canvas = document.createElement('canvas');
	canvas.width = bitmap.width;
	canvas.height = bitmap.height;
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		throw new Error('Canvas 2D context unavailable');
	}
	ctx.drawImage(bitmap, 0, 0);
	bitmap.close();

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
