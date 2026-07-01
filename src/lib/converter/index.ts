import { detectCategory, findFormat, getExtension, isFastPathPair, type FileCategory } from '../formats';
import { convertImage } from './imageEngine';
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

	const sourceExt = getExtension(file.name);
	let targetCategory: FileCategory = sourceCategory;
	let extractAudioOnly = false;

	if (sourceCategory === 'video' && !findFormat('video', targetExt)) {
		targetCategory = 'audio';
		extractAudioOnly = true;
	}

	const filename = `${stripExtension(file.name)}.${targetExt}`;

	try {
		let blob: Blob;
		if (sourceCategory === 'image' && targetCategory === 'image' && isFastPathPair(sourceExt, targetExt)) {
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
