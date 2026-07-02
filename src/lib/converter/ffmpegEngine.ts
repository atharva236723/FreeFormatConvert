import { findMimeForExt, getExtension } from '../formats';
import { ConversionError } from './errors';

const CORE_VERSION = '0.12.10';
const CORE_BASE_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

/**
 * Video containers we force to H.264 (libx264, ultrafast). See the codec-quirk comment in
 * transcode() for why each needs the explicit codec/preset rather than ffmpeg's default.
 */
const H264_TARGETS = new Set(['mp4', 'mov', 'm4v', 'mkv', '3gp']);

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
		if (target === 'webm' && !opts.extractAudioOnly) {
			// Several webm defaults trap in this single-threaded wasm core:
			//   - VP9 (ffmpeg's default codec for .webm) reliably faults with a WASM
			//     "memory access out of bounds" — a known upstream ffmpeg.wasm issue — so pin VP8.
			//   - VP8 with an alpha channel + auto_alt_ref (e.g. a transparent GIF source) also
			//     fails to open the encoder, so flatten to yuv420p (drops alpha, rarely wanted in video).
			//   - libvpx's default deadline is far too slow here (a 10s 360p clip blew the timeout),
			//     so use the realtime deadline with an explicit bitrate to keep it inside the budget.
			//   - Opus (the other default webm audio codec) traps the same way VP9 does, so pin Vorbis.
			args.push(
				'-c:v', 'libvpx', '-pix_fmt', 'yuv420p',
				'-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1M',
				'-c:a', 'libvorbis',
			);
		} else if (H264_TARGETS.has(target) && !opts.extractAudioOnly) {
			// Force H.264 for these containers. Some of them otherwise default to a codec that
			// fails: .3gp selects H.263, which only accepts a handful of fixed frame sizes and
			// rejects arbitrary dimensions like 640x360. libx264's default preset is also far too
			// slow in the single-threaded wasm core (~40–60s for a short clip, and occasionally
			// OOM-ing mid-encode), so pin ultrafast. yuv420p + an even-dimension scale keep the
			// output broadly playable — animated GIFs are frequently odd-sized and H.264 rejects
			// odd dimensions. The scale filter is a no-op when dimensions are already even.
			args.push(
				'-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
				'-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
			);
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
