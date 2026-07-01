import { findMimeForExt, getExtension } from '../formats';
import { ConversionError } from './errors';

const CORE_VERSION = '0.12.10';
const CORE_BASE_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`;
const CONVERT_TIMEOUT_MS = 180_000;

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

async function execWithTimeout(ffmpeg: FFmpegInstance, args: string[]): Promise<number | void> {
	let timeoutHandle: ReturnType<typeof setTimeout>;
	const timeout = new Promise<never>((_, reject) => {
		timeoutHandle = setTimeout(() => {
			reject(new ConversionError('timeout', 'This conversion is taking too long — this format pair might not be supported.'));
		}, CONVERT_TIMEOUT_MS);
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

		const args = ['-i', inputName];
		if (opts.extractAudioOnly) args.push('-vn');
		args.push(outputName);

		currentProgressHandler = opts.onProgress ?? null;

		let exitCode: number | void;
		try {
			exitCode = await execWithTimeout(ffmpeg, args);
		} catch (err) {
			if (err instanceof ConversionError && err.reason === 'timeout') {
				await resetEngine();
			}
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

		return new Blob([data], { type: findMimeForExt(targetExt) });
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
