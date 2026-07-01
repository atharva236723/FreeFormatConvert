export type FileCategory = 'image' | 'audio' | 'video';

export interface FormatDef {
	/** lowercase extension, no leading dot */
	ext: string;
	label: string;
	mime: string;
	category: FileCategory;
	/** shown in the default/collapsed picker */
	popular?: boolean;
	/** valid as a source format but not offered as a conversion target */
	inputOnly?: boolean;
}

export interface TargetOption extends FormatDef {
	group: 'convert' | 'extract-audio';
}

export const IMAGE_FORMATS: FormatDef[] = [
	{ ext: 'jpg', label: 'JPG', mime: 'image/jpeg', category: 'image', popular: true },
	{ ext: 'png', label: 'PNG', mime: 'image/png', category: 'image', popular: true },
	{ ext: 'webp', label: 'WebP', mime: 'image/webp', category: 'image', popular: true },
	{ ext: 'gif', label: 'GIF', mime: 'image/gif', category: 'image', popular: true },
	{ ext: 'bmp', label: 'BMP', mime: 'image/bmp', category: 'image', popular: true },
	{ ext: 'tiff', label: 'TIFF', mime: 'image/tiff', category: 'image' },
	{ ext: 'ico', label: 'ICO', mime: 'image/x-icon', category: 'image' },
	{ ext: 'avif', label: 'AVIF', mime: 'image/avif', category: 'image' },
	{ ext: 'heic', label: 'HEIC', mime: 'image/heic', category: 'image', inputOnly: true },
	{ ext: 'svg', label: 'SVG', mime: 'image/svg+xml', category: 'image', inputOnly: true },
	{ ext: 'jp2', label: 'JPEG 2000', mime: 'image/jp2', category: 'image' },
	{ ext: 'tga', label: 'TGA', mime: 'image/x-tga', category: 'image' },
	{ ext: 'ppm', label: 'PPM', mime: 'image/x-portable-pixmap', category: 'image' },
	{ ext: 'psd', label: 'PSD', mime: 'image/vnd.adobe.photoshop', category: 'image', inputOnly: true },
	{ ext: 'pcx', label: 'PCX', mime: 'image/x-pcx', category: 'image' },
];

export const AUDIO_FORMATS: FormatDef[] = [
	{ ext: 'mp3', label: 'MP3', mime: 'audio/mpeg', category: 'audio', popular: true },
	{ ext: 'wav', label: 'WAV', mime: 'audio/wav', category: 'audio', popular: true },
	{ ext: 'aac', label: 'AAC', mime: 'audio/aac', category: 'audio', popular: true },
	{ ext: 'ogg', label: 'OGG', mime: 'audio/ogg', category: 'audio', popular: true },
	{ ext: 'flac', label: 'FLAC', mime: 'audio/flac', category: 'audio', popular: true },
	{ ext: 'm4a', label: 'M4A', mime: 'audio/mp4', category: 'audio', popular: true },
	{ ext: 'wma', label: 'WMA', mime: 'audio/x-ms-wma', category: 'audio' },
	{ ext: 'opus', label: 'Opus', mime: 'audio/opus', category: 'audio' },
	{ ext: 'aiff', label: 'AIFF', mime: 'audio/aiff', category: 'audio' },
	{ ext: 'alac', label: 'ALAC', mime: 'audio/x-alac', category: 'audio' },
	{ ext: 'amr', label: 'AMR', mime: 'audio/amr', category: 'audio' },
	{ ext: 'ac3', label: 'AC3', mime: 'audio/ac3', category: 'audio' },
];

export const VIDEO_FORMATS: FormatDef[] = [
	{ ext: 'mp4', label: 'MP4', mime: 'video/mp4', category: 'video', popular: true },
	{ ext: 'webm', label: 'WebM', mime: 'video/webm', category: 'video', popular: true },
	{ ext: 'mov', label: 'MOV', mime: 'video/quicktime', category: 'video', popular: true },
	{ ext: 'avi', label: 'AVI', mime: 'video/x-msvideo', category: 'video', popular: true },
	{ ext: 'mkv', label: 'MKV', mime: 'video/x-matroska', category: 'video', popular: true },
	{ ext: 'gif', label: 'GIF (animated)', mime: 'image/gif', category: 'video', popular: true },
	{ ext: 'flv', label: 'FLV', mime: 'video/x-flv', category: 'video' },
	{ ext: 'wmv', label: 'WMV', mime: 'video/x-ms-wmv', category: 'video' },
	{ ext: 'mpeg', label: 'MPEG', mime: 'video/mpeg', category: 'video' },
	{ ext: '3gp', label: '3GP', mime: 'video/3gpp', category: 'video' },
	{ ext: 'ogv', label: 'OGV', mime: 'video/ogg', category: 'video' },
	{ ext: 'm4v', label: 'M4V', mime: 'video/x-m4v', category: 'video' },
];

const ALL_FORMATS: FormatDef[] = [...IMAGE_FORMATS, ...AUDIO_FORMATS, ...VIDEO_FORMATS];

const FORMATS_BY_CATEGORY: Record<FileCategory, FormatDef[]> = {
	image: IMAGE_FORMATS,
	audio: AUDIO_FORMATS,
	video: VIDEO_FORMATS,
};

/**
 * Formats the browser's `createImageBitmap` can reliably decode as a *source*.
 * Broader than the encodable set below — decoding is far more permissive than encoding.
 */
const CANVAS_DECODABLE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg', 'avif']);

/**
 * Formats `canvas.toBlob()` can actually *encode*. This is deliberately narrow: BMP and GIF
 * are NOT supported encode targets in any mainstream browser — requesting them silently falls
 * back to PNG, which would corrupt the file while keeping a `.bmp`/`.gif` extension on it.
 * Those (and anything else) must go through ffmpeg instead, which has real encoders for them.
 */
const CANVAS_ENCODABLE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp']);

export function getExtension(filename: string): string {
	const dot = filename.lastIndexOf('.');
	if (dot === -1) return '';
	return filename.slice(dot + 1).toLowerCase();
}

export function detectCategory(file: File): FileCategory | null {
	const mimePrefix = file.type.split('/')[0];
	if (mimePrefix === 'image' || mimePrefix === 'audio' || mimePrefix === 'video') {
		return mimePrefix;
	}
	const ext = getExtension(file.name);
	const match = ALL_FORMATS.find((f) => f.ext === ext);
	return match ? match.category : null;
}

export function findFormat(category: FileCategory, ext: string): FormatDef | undefined {
	return FORMATS_BY_CATEGORY[category].find((f) => f.ext === ext.toLowerCase());
}

export function findMimeForExt(ext: string): string {
	const match = ALL_FORMATS.find((f) => f.ext === ext.toLowerCase());
	return match?.mime ?? 'application/octet-stream';
}

/**
 * Valid conversion targets for a given source. When the source is video, audio
 * formats are appended as "extract audio" targets (video is already loaded into
 * ffmpeg, so pulling the audio track out is essentially free).
 */
export function getAvailableTargets(sourceCategory: FileCategory, sourceExt: string): TargetOption[] {
	const ext = sourceExt.toLowerCase();
	const sameCategory: TargetOption[] = FORMATS_BY_CATEGORY[sourceCategory]
		.filter((f) => !f.inputOnly && f.ext !== ext)
		.map((f) => ({ ...f, group: 'convert' }));

	if (sourceCategory !== 'video') return sameCategory;

	const audioExtraction: TargetOption[] = AUDIO_FORMATS.filter((f) => f.popular).map((f) => ({
		...f,
		group: 'extract-audio',
	}));

	return [...sameCategory, ...audioExtraction];
}

export function isFastPathPair(sourceExt: string, targetExt: string): boolean {
	return CANVAS_DECODABLE_EXTS.has(sourceExt.toLowerCase()) && CANVAS_ENCODABLE_EXTS.has(targetExt.toLowerCase());
}

export function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB'];
	const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	const value = bytes / 1024 ** i;
	return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}
