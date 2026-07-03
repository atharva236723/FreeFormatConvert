/**
 * Standalone media tools (compress / trim) that reuse the ffmpeg.wasm singleton via
 * ffmpegEngine.runFFmpeg. Kept separate from the converter so the heavy wasm core stays lazy —
 * this module is only ever dynamically imported by media-tool-controller.ts. The codec choices
 * mirror the quirks documented in ffmpegEngine.ts (libx264 + ultrafast for h264 in the single-
 * threaded core, etc.).
 */
import { probeDuration, runFFmpeg, type FFmpegRunOptions } from '../converter/ffmpegEngine';
import { getExtension } from '../formats';

export const VIDEO_LEVELS: Record<string, number> = {
	small: 32,
	balanced: 28,
	high: 24,
};

export interface MediaResult {
	blob: Blob;
	ext: string;
}

/** Compress a video to H.264/AAC MP4 at the chosen CRF. Always outputs .mp4 for broad playback. */
export async function compressVideo(file: File, crf: number, opts: FFmpegRunOptions = {}): Promise<MediaResult> {
	const blob = await runFFmpeg(
		file,
		(input, output) => [
			'-i', input,
			'-c:v', 'libx264', '-preset', 'ultrafast', '-crf', String(crf), '-pix_fmt', 'yuv420p',
			'-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
			'-c:a', 'aac', '-b:a', '128k',
			output,
		],
		'mp4',
		opts,
	);
	return { blob, ext: 'mp4' };
}

/** Re-encode audio at a target bitrate. Output extension follows the source when it's a common
 * lossy container; otherwise falls back to MP3. */
export async function compressAudio(file: File, bitrateKbps: number, opts: FFmpegRunOptions = {}): Promise<MediaResult> {
	const src = getExtension(file.name).toLowerCase();
	const ext = src === 'm4a' || src === 'aac' || src === 'ogg' ? src : 'mp3';
	const blob = await runFFmpeg(
		file,
		(input, output) => ['-i', input, '-vn', '-b:a', `${bitrateKbps}k`, output],
		ext,
		opts,
	);
	return { blob, ext };
}

/** Shrink a GIF by scaling down and/or lowering the frame rate. Uses a generated palette for
 * quality at reduced size (two filters in one graph via split). */
export async function compressGif(
	file: File,
	opts: { scale: number; fps: number } & FFmpegRunOptions,
): Promise<MediaResult> {
	const { scale, fps, ...run } = opts;
	const width = `trunc(iw*${scale}/2)*2`;
	const filter = `fps=${fps},scale=${width}:-2:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;
	const blob = await runFFmpeg(file, (input, output) => ['-i', input, '-vf', filter, output], 'gif', run);
	return { blob, ext: 'gif' };
}

/**
 * Media length in seconds. Prefers a value the caller already read from an HTML media element
 * (instant, no ffmpeg pass); otherwise probes it with ffmpeg for containers the browser can't play.
 */
async function resolveDuration(file: File, durationSec?: number): Promise<number> {
	if (durationSec && durationSec > 0 && Number.isFinite(durationSec)) return durationSec;
	const probed = await probeDuration(file);
	return probed && probed > 0 ? probed : 0;
}

/**
 * Compress audio to hit a target file size. Bitrate is derived from the clip length
 * (bits = targetBytes × 8, so kbps = that ÷ seconds), trimmed slightly for container overhead.
 * This is CBR, so the result lands close to the target. Needs a readable duration.
 */
export async function compressAudioToTarget(
	file: File,
	opts: { targetBytes: number; durationSec?: number } & FFmpegRunOptions,
): Promise<MediaResult> {
	const { targetBytes, durationSec, ...run } = opts;
	const duration = await resolveDuration(file, durationSec);
	if (!duration) throw new Error('Could not read this audio’s length, so a target size can’t be set. Try a different file.');
	const kbps = Math.max(8, Math.floor(((targetBytes * 8) / duration / 1000) * 0.98));
	return compressAudio(file, kbps, run);
}

/**
 * Compress video toward a target file size. Total budget (kbps) comes from length; a fixed audio
 * budget is subtracted and the rest goes to H.264 with `-maxrate`/`-bufsize` caps. Single-pass in
 * the wasm core (2-pass is too slow single-threaded), so this lands *near* the target, not exactly.
 */
export async function compressVideoToTarget(
	file: File,
	opts: { targetBytes: number; durationSec?: number } & FFmpegRunOptions,
): Promise<MediaResult> {
	const { targetBytes, durationSec, ...run } = opts;
	const duration = await resolveDuration(file, durationSec);
	if (!duration) throw new Error('Could not read this video’s length, so a target size can’t be set. Try a different file.');
	const audioKbps = 128;
	const totalKbps = (targetBytes * 8) / duration / 1000;
	// Leave headroom for the audio track and container overhead; never go below a legible floor.
	const videoKbps = Math.max(64, Math.floor((totalKbps - audioKbps) * 0.95));
	const blob = await runFFmpeg(
		file,
		(input, output) => [
			'-i', input,
			'-c:v', 'libx264', '-preset', 'ultrafast',
			'-b:v', `${videoKbps}k`, '-maxrate', `${Math.round(videoKbps * 1.45)}k`, '-bufsize', `${videoKbps * 2}k`,
			'-pix_fmt', 'yuv420p',
			'-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
			'-c:a', 'aac', '-b:a', `${audioKbps}k`,
			output,
		],
		'mp4',
		run,
	);
	return { blob, ext: 'mp4' };
}

/**
 * Compress a GIF toward a target size by walking a scale/frame-rate ladder from largest to smallest
 * and stopping at the first rung that fits. Roughest of the target-size tools — there's no bitrate
 * knob for GIF — and each rung is a full ffmpeg pass, so it can take a few tries on a big GIF.
 */
export async function compressGifToTarget(
	file: File,
	opts: { targetBytes: number } & FFmpegRunOptions,
): Promise<MediaResult> {
	const { targetBytes, onProgress, ...run } = opts;
	const ladder = [
		{ scale: 1, fps: 15 },
		{ scale: 0.8, fps: 15 },
		{ scale: 0.8, fps: 12 },
		{ scale: 0.6, fps: 12 },
		{ scale: 0.5, fps: 10 },
		{ scale: 0.4, fps: 8 },
		{ scale: 0.3, fps: 8 },
	];
	let smallest: MediaResult | null = null;
	for (let i = 0; i < ladder.length; i++) {
		const result = await compressGif(file, {
			...ladder[i],
			...run,
			onProgress: (p) => onProgress?.((i + p) / ladder.length),
		});
		if (!smallest || result.blob.size < smallest.blob.size) smallest = result;
		if (result.blob.size <= targetBytes) return result;
	}
	return smallest!;
}

/**
 * Re-encode a GIF through a filter chain while keeping every frame, using a generated palette for
 * quality (same technique as compressGif). The image tools (resize/crop/rotate/flip) route animated
 * GIFs here because their Canvas path only ever sees the first frame and would silently flatten the
 * animation to a still PNG.
 */
async function transformGif(file: File, vf: string, opts: FFmpegRunOptions): Promise<MediaResult> {
	const chain = vf ? `${vf},` : '';
	const filter = `${chain}split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse`;
	const blob = await runFFmpeg(file, (input, output) => ['-i', input, '-vf', filter, output], 'gif', opts);
	return { blob, ext: 'gif' };
}

/** Resize an animated GIF to exact pixel dimensions, preserving animation. */
export async function resizeGif(file: File, width: number, height: number, opts: FFmpegRunOptions = {}): Promise<MediaResult> {
	const w = Math.max(1, Math.round(width));
	const h = Math.max(1, Math.round(height));
	return transformGif(file, `scale=${w}:${h}:flags=lanczos`, opts);
}

/** Crop a rectangle (in source pixels) out of an animated GIF, preserving animation. */
export async function cropGif(
	file: File,
	rect: { x: number; y: number; width: number; height: number },
	opts: FFmpegRunOptions = {},
): Promise<MediaResult> {
	const x = Math.max(0, Math.round(rect.x));
	const y = Math.max(0, Math.round(rect.y));
	const w = Math.max(1, Math.round(rect.width));
	const h = Math.max(1, Math.round(rect.height));
	return transformGif(file, `crop=${w}:${h}:${x}:${y}`, opts);
}

/** Mirror an animated GIF horizontally and/or vertically, preserving animation. */
export async function flipGif(file: File, horizontal: boolean, vertical: boolean, opts: FFmpegRunOptions = {}): Promise<MediaResult> {
	const parts: string[] = [];
	if (horizontal) parts.push('hflip');
	if (vertical) parts.push('vflip');
	return transformGif(file, parts.join(','), opts);
}

/** Rotate an animated GIF by any angle (degrees, clockwise), preserving animation. Multiples of 90°
 * use transpose (lossless, no fill); other angles grow the canvas to fit and leave the corners
 * transparent. */
export async function rotateGif(file: File, degrees: number, opts: FFmpegRunOptions = {}): Promise<MediaResult> {
	const norm = ((Math.round(degrees) % 360) + 360) % 360;
	let vf: string;
	if (norm === 90) vf = 'transpose=1';
	else if (norm === 180) vf = 'transpose=2,transpose=2';
	else if (norm === 270) vf = 'transpose=2';
	else if (norm === 0) vf = '';
	else {
		const rad = ((degrees * Math.PI) / 180).toFixed(6);
		vf = `rotate=${rad}:ow=rotw(${rad}):oh=roth(${rad}):fillcolor=none`;
	}
	return transformGif(file, vf, opts);
}

/** Trim a clip to [start, end] seconds. Re-encodes (accurate cut) to H.264/AAC MP4. */
export async function trimVideo(
	file: File,
	start: number,
	end: number,
	opts: FFmpegRunOptions = {},
): Promise<MediaResult> {
	const duration = Math.max(0.1, end - start);
	const blob = await runFFmpeg(
		file,
		(input, output) => [
			'-ss', start.toFixed(3),
			'-i', input,
			'-t', duration.toFixed(3),
			'-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
			'-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
			'-c:a', 'aac', '-b:a', '128k',
			output,
		],
		'mp4',
		opts,
	);
	return { blob, ext: 'mp4' };
}
