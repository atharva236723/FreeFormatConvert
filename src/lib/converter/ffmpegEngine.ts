import { findMimeForExt, getExtension } from '../formats';
import { ConversionError } from './errors';

const CORE_VERSION = '0.12.10';
const CORE_BASE_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

/**
 * Timeout scales with input size so a large-but-legitimately-slow conversion (e.g. a
 * video near the 1GB cap) isn't killed mid-encode, while a small file that's genuinely
 * stuck still fails fast instead of hanging for the full cap. Bounded at MAX so worst
 * case is still "not very long" rather than unbounded.
 */
const BASE_TIMEOUT_MS = 60_000;
const TIMEOUT_MS_PER_MB = 500;
const MAX_TIMEOUT_MS = 600_000;

function computeTimeoutMs(fileSizeBytes: number): number {
	const sizeMB = fileSizeBytes / (1024 * 1024);
	return Math.min(BASE_TIMEOUT_MS + sizeMB * TIMEOUT_MS_PER_MB, MAX_TIMEOUT_MS);
}

// Lazily typed — the real FFmpeg class only exists once @ffmpeg/ffmpeg is dynamically imported.
type FFmpegInstance = InstanceType<typeof import('@ffmpeg/ffmpeg').FFmpeg>;

let ffmpegInstance: FFmpegInstance | null = null;
let loadPromise: Promise<FFmpegInstance> | null = null;
let currentProgressHandler: ((ratio: number) => void) | null = null;
let lastLogLine = '';

async function resetEngine() {
	try {
		ffmpegInstance?.terminate();
	} catch {
		// already dead, nothing to clean up
	}
	ffmpegInstance = null;
	loadPromise = null;
}

async function getFFmpeg(): Promise<FFmpegInstance> {
	if (ffmpegInstance) return ffmpegInstance;
	if (loadPromise) return loadPromise;

	loadPromise = (async () => {
		const [{ FFmpeg }, { toBlobURL }] = await Promise.all([import('@ffmpeg/ffmpeg'), import('@ffmpeg/util')]);
		const ffmpeg = new FFmpeg();

		ffmpeg.on('progress', ({ progress }) => {
			currentProgressHandler?.(Math.min(Math.max(progress, 0), 1));
		});
		ffmpeg.on('log', ({ message }) => {
			lastLogLine = message;
		});

		try {
			const [coreURL, wasmURL] = await Promise.all([
				toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, 'text/javascript'),
				toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
			]);
			await ffmpeg.load({ coreURL, wasmURL });
		} catch {
			loadPromise = null;
			throw new ConversionError(
				'engine-load-failed',
				'Could not load the conversion engine. Check your connection and try again.',
			);
		}

		ffmpegInstance = ffmpeg;
		return ffmpeg;
	})();

	return loadPromise;
}

async function execWithTimeout(ffmpeg: FFmpegInstance, args: string[], timeoutMs: number): Promise<number | void> {
	let timeoutHandle: ReturnType<typeof setTimeout>;
	const timeout = new Promise<never>((_, reject) => {
		timeoutHandle = setTimeout(() => {
			reject(new ConversionError('timeout', 'This conversion is taking too long — this format pair might not be supported.'));
		}, timeoutMs);
	});
	try {
		return await Promise.race([ffmpeg.exec(args), timeout]);
	} finally {
		clearTimeout(timeoutHandle!);
	}
}

export interface TranscodeOptions {
	extractAudioOnly?: boolean;
	onProgress?: (ratio: number) => void;
}

export async function transcode(file: File, targetExt: string, opts: TranscodeOptions = {}): Promise<Blob> {
	const sourceExt = getExtension(file.name) || 'bin';
	const inputName = `input.${sourceExt}`;
	const outputName = `output.${targetExt}`;

	const ffmpeg = await getFFmpeg();
	lastLogLine = '';

	try {
		const { fetchFile } = await import('@ffmpeg/util');
		await ffmpeg.writeFile(inputName, await fetchFile(file));

		const target = targetExt.toLowerCase();
		const args = ['-i', inputName];
		if (opts.extractAudioOnly) args.push('-vn');
		// This core build's libvpx-vp9 encoder (ffmpeg's default codec for .webm) reliably
		// crashes with a WASM "memory access out of bounds" fault, even on trivial input —
		// a known upstream ffmpeg.wasm issue, not something fixable from the JS side. VP8
		// (libvpx) encodes the same container correctly, so pin it explicitly for webm targets.
		if (target === 'webm' && !opts.extractAudioOnly) args.push('-c:v', 'libvpx');
		// H.264 (the default codec for these containers) requires even pixel dimensions and
		// yuv420p for broad playback. Animated GIFs frequently have odd dimensions, so a naive
		// GIF→MP4 would fail with "width/height not divisible by 2". Force both. The scale
		// filter is a no-op when dimensions are already even.
		if ((target === 'mp4' || target === 'mov' || target === 'm4v') && !opts.extractAudioOnly) {
			args.push('-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-pix_fmt', 'yuv420p');
		}
		// Force the APNG muxer (not the single-frame PNG encoder the ".apng" extension would
		// otherwise select) so every frame of an animated source is kept, and loop forever.
		if (target === 'apng') args.push('-f', 'apng', '-plays', '0');
		args.push(outputName);

		currentProgressHandler = opts.onProgress ?? null;

		let exitCode: number | void;
		try {
			exitCode = await execWithTimeout(ffmpeg, args, computeTimeoutMs(file.size));
		} catch (err) {
			// exec() only throws for a timeout race or a genuine engine-level fault (e.g. a WASM
			// trap) — either way the cached instance can't be trusted for the next conversion.
			await resetEngine();
			throw err;
		}

		const unsupportedMessage = lastLogLine
			? `Could not convert to .${targetExt}: ${lastLogLine}`
			: `Could not convert to .${targetExt}. This format pair might not be supported.`;

		if (typeof exitCode === 'number' && exitCode !== 0) {
			throw new ConversionError('unsupported-pair', unsupportedMessage);
		}

		let data: Uint8Array;
		try {
			data = (await ffmpeg.readFile(outputName)) as Uint8Array;
		} catch {
			throw new ConversionError('unsupported-pair', unsupportedMessage);
		}

		return new Blob([data as BlobPart], { type: findMimeForExt(targetExt) });
	} finally {
		currentProgressHandler = null;
		try {
			await ffmpeg.deleteFile(inputName);
		} catch {
			/* input may never have been written */
		}
		try {
			await ffmpeg.deleteFile(outputName);
		} catch {
			/* output may never have been created */
		}
	}
}
