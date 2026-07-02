import {
	detectCategory,
	findFormat,
	formatBytes,
	getDocumentOp,
	getExtension,
	isFastPathPair,
	MAX_FILE_SIZE_BYTES,
	type FileCategory,
} from '../formats';
import { convertImage, convertImageToIco } from './imageEngine';
import { ConversionError } from './errors';

export { ConversionError } from './errors';
export type { ConversionErrorReason } from './errors';

export interface ConvertOptions {
	onProgress?: (ratio: number) => void;
}

export interface ConvertResult {
	blob: Blob;
	filename: string;
}

function stripExtension(filename: string): string {
	const dot = filename.lastIndexOf('.');
	return dot === -1 ? filename : filename.slice(0, dot);
}

/**
 * Picks the right engine for a conversion (instant Canvas fast-path vs. lazy-loaded
 * ffmpeg.wasm) and normalizes failures into a typed ConversionError so the UI can
 * show a clear message instead of a raw stack trace.
 */
export async function convertFile(file: File, targetExt: string, opts: ConvertOptions = {}): Promise<ConvertResult> {
	const sourceCategory = detectCategory(file);
	if (!sourceCategory) {
		throw new ConversionError('unsupported-pair', "We don't support that file type yet.");
	}

	const maxBytes = MAX_FILE_SIZE_BYTES[sourceCategory];
	if (file.size > maxBytes) {
		throw new ConversionError(
			'file-too-large',
			`${sourceCategory} files are limited to ${formatBytes(maxBytes)}. This file is ${formatBytes(file.size)}.`,
		);
	}

	const sourceExt = getExtension(file.name);
	let targetCategory: FileCategory = sourceCategory;
	let extractAudioOnly = false;

	if (sourceCategory === 'video' && !findFormat('video', targetExt)) {
		targetCategory = 'audio';
		extractAudioOnly = true;
	}

	const baseName = stripExtension(file.name);
	const filename = `${baseName}.${targetExt}`;

	// Document conversions (DOCX→PDF, PDF→image, image→PDF) run in their own lazily-loaded
	// engine. Kept out of the static import graph for the same reason as ffmpegEngine — the
	// PDF/DOCX libraries are heavy and shouldn't load until a document conversion is chosen.
	const documentOp = getDocumentOp(sourceExt, targetExt);
	if (documentOp) {
		try {
			const { convertDocument } = await import('./documentEngine');
			return await convertDocument(file, documentOp, targetExt, baseName, { onProgress: opts.onProgress });
		} catch (err) {
			if (err instanceof ConversionError) throw err;
			const message = err instanceof Error ? err.message : 'Something went wrong during conversion.';
			throw new ConversionError('unknown', message);
		}
	}

	try {
		let blob: Blob;
		if (sourceCategory === 'image' && targetExt.toLowerCase() === 'ico') {
			// ffmpeg's wasm core can't mux ICO, so ICO is encoded on the Canvas path instead
			// (rasterize → PNG → wrap in an ICO container). Works for any Canvas-decodable source.
			opts.onProgress?.(0.5);
			blob = await convertImageToIco(file);
			opts.onProgress?.(1);
		} else if (sourceCategory === 'image' && targetCategory === 'image' && isFastPathPair(sourceExt, targetExt)) {
			opts.onProgress?.(0.5);
			blob = await convertImage(file, targetExt);
			opts.onProgress?.(1);
		} else {
			const { transcode } = await import('./ffmpegEngine');
			blob = await transcode(file, targetExt, { extractAudioOnly, onProgress: opts.onProgress });
		}
		return { blob, filename };
	} catch (err) {
		if (err instanceof ConversionError) throw err;
		const message = err instanceof Error ? err.message : 'Something went wrong during conversion.';
		throw new ConversionError('unknown', message);
	}
}
