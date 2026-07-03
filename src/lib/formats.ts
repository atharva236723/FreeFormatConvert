export type FileCategory = 'image' | 'audio' | 'video' | 'document';

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
	// inputOnly: the browser decodes AVIF via createImageBitmap (so AVIF→JPG/PNG/… work), but
	// the ffmpeg wasm core has no AV1 encoder — a `.avif` target aborts with "encoder … disabled".
	{ ext: 'avif', label: 'AVIF', mime: 'image/avif', category: 'image', inputOnly: true },
	{ ext: 'heic', label: 'HEIC', mime: 'image/heic', category: 'image', inputOnly: true },
	{ ext: 'svg', label: 'SVG', mime: 'image/svg+xml', category: 'image', inputOnly: true },
	{ ext: 'jp2', label: 'JPEG 2000', mime: 'image/jp2', category: 'image' },
	{ ext: 'tga', label: 'TGA', mime: 'image/x-tga', category: 'image' },
	{ ext: 'ppm', label: 'PPM', mime: 'image/x-portable-pixmap', category: 'image' },
	{ ext: 'psd', label: 'PSD', mime: 'image/vnd.adobe.photoshop', category: 'image', inputOnly: true },
	{ ext: 'pcx', label: 'PCX', mime: 'image/x-pcx', category: 'image' },
	{ ext: 'apng', label: 'APNG', mime: 'image/apng', category: 'image' },
	// JFIF is just a JPEG (same bytes, different extension), so the browser decodes it via
	// createImageBitmap like any JPEG. Source-only: we'd never emit a `.jfif` when `.jpg` is
	// the canonical name for identical output. Powers the popular "JFIF to PNG/JPG" conversions.
	{ ext: 'jfif', label: 'JFIF', mime: 'image/jpeg', category: 'image', inputOnly: true },
];

export const AUDIO_FORMATS: FormatDef[] = [
	{ ext: 'mp3', label: 'MP3', mime: 'audio/mpeg', category: 'audio', popular: true },
	{ ext: 'wav', label: 'WAV', mime: 'audio/wav', category: 'audio', popular: true },
	{ ext: 'aac', label: 'AAC', mime: 'audio/aac', category: 'audio', popular: true },
	{ ext: 'ogg', label: 'OGG', mime: 'audio/ogg', category: 'audio', popular: true },
	{ ext: 'flac', label: 'FLAC', mime: 'audio/flac', category: 'audio', popular: true },
	{ ext: 'm4a', label: 'M4A', mime: 'audio/mp4', category: 'audio', popular: true },
	{ ext: 'wma', label: 'WMA', mime: 'audio/x-ms-wma', category: 'audio' },
	// These three are inputOnly: the ffmpeg wasm core can decode them (so Opus/ALAC/AMR → MP3/…
	// work), but can't reliably *encode* them. Opus's encoder traps with a WASM "memory access
	// out of bounds" (same failure class as VP9); AMR has no encoder compiled in at all; and ALAC
	// has no standalone muxer (it only lives inside .m4a, which we already offer). Offering them
	// as targets produced conversions that always failed.
	{ ext: 'opus', label: 'Opus', mime: 'audio/opus', category: 'audio', inputOnly: true },
	{ ext: 'aiff', label: 'AIFF', mime: 'audio/aiff', category: 'audio' },
	{ ext: 'alac', label: 'ALAC', mime: 'audio/x-alac', category: 'audio', inputOnly: true },
	{ ext: 'amr', label: 'AMR', mime: 'audio/amr', category: 'audio', inputOnly: true },
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
	// MPEG-TS / camcorder / DVD containers. Marked inputOnly: ffmpeg demuxes them reliably
	// (so "MTS to MP4", "VOB to MP4", … all work), but we don't offer them as *targets* — the
	// popular direction is always into a mainstream container, and muxing back out to these is
	// both rarely wanted and less reliable in the wasm core.
	{ ext: 'mts', label: 'MTS', mime: 'video/mp2t', category: 'video', inputOnly: true },
	{ ext: 'm2ts', label: 'M2TS', mime: 'video/mp2t', category: 'video', inputOnly: true },
	{ ext: 'ts', label: 'TS', mime: 'video/mp2t', category: 'video', inputOnly: true },
	{ ext: 'vob', label: 'VOB', mime: 'video/mpeg', category: 'video', inputOnly: true },
	{ ext: '3g2', label: '3G2', mime: 'video/3gpp2', category: 'video', inputOnly: true },
	{ ext: 'f4v', label: 'F4V', mime: 'video/x-f4v', category: 'video', inputOnly: true },
];

/**
 * Document formats are handled by documentEngine.ts (not Canvas/ffmpeg). Unlike media
 * — where any pair within a category is offered — only a curated set of high-fidelity,
 * fully client-side conversions is exposed (see `getDocumentOp` / documentEngine.ts for
 * why the reverse directions like PDF→DOCX are deliberately excluded).
 *
 * `pdf` is both a source (PDF→image/Word/EPUB) and a target (DOCX→PDF, image→PDF, EPUB→PDF).
 * `docx` is offered as a target only for PDF sources (see `getDocumentTargets`), so it's marked
 * `inputOnly` to keep it out of the generic target loop; PDF→DOCX is text-only (see documentEngine).
 * `epub` is both a source (EPUB→PDF) and a target (PDF→EPUB) — ebook conversions reflow to clean
 * text rather than reproducing the source's exact layout.
 */
export const DOCUMENT_FORMATS: FormatDef[] = [
	{ ext: 'pdf', label: 'PDF', mime: 'application/pdf', category: 'document', popular: true },
	{
		ext: 'docx',
		label: 'Word (DOCX)',
		mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		category: 'document',
		popular: true,
		inputOnly: true,
	},
	{ ext: 'epub', label: 'EPUB', mime: 'application/epub+zip', category: 'document', popular: true },
];

const ALL_FORMATS: FormatDef[] = [...IMAGE_FORMATS, ...AUDIO_FORMATS, ...VIDEO_FORMATS, ...DOCUMENT_FORMATS];

const FORMATS_BY_CATEGORY: Record<FileCategory, FormatDef[]> = {
	image: IMAGE_FORMATS,
	audio: AUDIO_FORMATS,
	video: VIDEO_FORMATS,
	document: DOCUMENT_FORMATS,
};

/**
 * Per-category upload caps. These exist to bound worst-case conversion time in the
 * browser (single-threaded ffmpeg.wasm, no server to offload to) — not an artificial
 * paywall. Video gets the largest allowance since that's the format users most often
 * bring at real size; image/audio caps are generous relative to typical file sizes for
 * those categories while keeping the ffmpeg timeout budget (see ffmpegEngine.ts) sane.
 */
export const MAX_FILE_SIZE_BYTES: Record<FileCategory, number> = {
	image: 50 * 1024 * 1024, // 50 MB
	audio: 300 * 1024 * 1024, // 300 MB
	video: 1024 * 1024 * 1024, // 1 GB
	document: 100 * 1024 * 1024, // 100 MB
};

/**
 * Formats the browser's `createImageBitmap` can reliably decode as a *source*.
 * Broader than the encodable set below — decoding is far more permissive than encoding.
 */
const CANVAS_DECODABLE_EXTS = new Set(['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'bmp', 'svg', 'avif']);

/**
 * Formats `canvas.toBlob()` can actually *encode*. This is deliberately narrow: BMP and GIF
 * are NOT supported encode targets in any mainstream browser — requesting them silently falls
 * back to PNG, which would corrupt the file while keeping a `.bmp`/`.gif` extension on it.
 * Those (and anything else) must go through ffmpeg instead, which has real encoders for them.
 */
const CANVAS_ENCODABLE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp']);

/**
 * Image formats that carry animation. Their MIME type (`image/gif`, `image/apng`) means
 * the browser classifies them as images, but they can legitimately be converted to *video*
 * (MP4, WebM, …) — ffmpeg reads every frame. So for these sources we widen the target list
 * to include video containers, which is why `gif-to-mp4` etc. are real, working conversions.
 */
const ANIMATED_IMAGE_EXTS = new Set(['gif', 'apng']);

/**
 * Image source extensions that can be packaged into a PDF. Broader than the Canvas-decodable
 * set because `heic` is included: the browser can't decode HEIC via `createImageBitmap`, so
 * documentEngine.ts decodes it with heic2any first, then flows it through the image→PDF path.
 */
const IMAGE_TO_PDF_SOURCES = new Set([...CANVAS_DECODABLE_EXTS, 'heic']);

/**
 * HEIC/HEIF sources. Neither `createImageBitmap` nor the ffmpeg wasm core can decode them, so
 * they're transcoded to JPEG with heic2any first and then handled entirely on the Canvas /
 * documentEngine paths. That means their only reachable targets are the Canvas-encodable raster
 * formats, ICO, and PDF — ffmpeg-only targets (GIF/BMP/TIFF) can't be produced from a HEIC source.
 */
const HEIC_EXTS = new Set(['heic', 'heif']);

export function getExtension(filename: string): string {
	const dot = filename.lastIndexOf('.');
	if (dot === -1) return '';
	return filename.slice(dot + 1).toLowerCase();
}

/**
 * Extension aliases — different extensions that denote the *same* underlying format.
 * Used to validate a dropped file against a conversion page's expected source: a `.jpeg`
 * or `.jfif` file is still valid on the "JPG to …" page (all three are byte-identical JPEG),
 * and `.tif` is the same format as `.tiff`.
 */
const EXT_ALIASES: Record<string, string> = {
	jpeg: 'jpg',
	jfif: 'jpg',
	tif: 'tiff',
};

/** Collapses an extension to its canonical form (e.g. `jpeg`/`jfif` → `jpg`). */
export function normalizeExt(ext: string): string {
	const e = ext.toLowerCase();
	return EXT_ALIASES[e] ?? e;
}

/**
 * Whether a dropped file's format matches the expected source extension of a conversion
 * pair (e.g. only genuine PNG files are valid on `/png-to-jpg`). Alias-aware, so
 * `.jpeg`/`.jfif` count as `jpg`. Used by the converter to reject mismatched files on the
 * per-conversion landing pages, while the homepage/hub converters stay auto-detecting.
 */
export function fileMatchesSourceExt(filename: string, expectedSourceExt: string): boolean {
	return normalizeExt(getExtension(filename)) === normalizeExt(expectedSourceExt);
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

	if (sourceCategory === 'document') return getDocumentTargets(ext);

	const sameCategory: TargetOption[] = FORMATS_BY_CATEGORY[sourceCategory]
		.filter((f) => !f.inputOnly && f.ext !== ext)
		.map((f) => ({ ...f, group: 'convert' }));

	// Any image we can rasterize can also be packaged into a PDF (handled by documentEngine, not
	// Canvas/ffmpeg). Surfaced as a normal convert target alongside the image formats. Includes
	// HEIC, which documentEngine decodes via heic2any before laying it onto the PDF page.
	if (sourceCategory === 'image' && IMAGE_TO_PDF_SOURCES.has(ext)) {
		const pdf = DOCUMENT_FORMATS.find((f) => f.ext === 'pdf')!;
		sameCategory.push({ ...pdf, group: 'convert' });
	}

	// HEIC/HEIF can't be decoded by ffmpeg, so drop targets that would need it (GIF/BMP/TIFF).
	// What's left — Canvas-encodable rasters, ICO and PDF — is exactly what the Canvas and
	// documentEngine paths can produce from a heic2any-decoded source.
	if (sourceCategory === 'image' && HEIC_EXTS.has(ext)) {
		return sameCategory.filter(
			(t) => CANVAS_ENCODABLE_EXTS.has(t.ext) || t.ext === 'ico' || t.ext === 'pdf',
		);
	}

	// Animated images (GIF, APNG) can be turned into real video. ffmpeg preserves every
	// frame, so offer the video containers as extra convert targets (e.g. GIF→MP4).
	if (sourceCategory === 'image' && ANIMATED_IMAGE_EXTS.has(ext)) {
		const already = new Set(sameCategory.map((t) => t.ext));
		for (const video of VIDEO_FORMATS) {
			if (video.inputOnly || video.ext === ext || already.has(video.ext)) continue;
			sameCategory.push({ ...video, group: 'convert' });
		}
	}

	if (sourceCategory !== 'video') return sameCategory;

	const audioExtraction: TargetOption[] = AUDIO_FORMATS.filter((f) => f.popular).map((f) => ({
		...f,
		group: 'extract-audio',
	}));

	return [...sameCategory, ...audioExtraction];
}

function getDocumentTargets(sourceExt: string): TargetOption[] {
	if (sourceExt === 'pdf') {
		// Rasterize each page to an image (JPG/PNG — the reliable, universally-decodable pair),
		// extract text into an editable Word doc, or reflow text into an EPUB ebook.
		const imageTargets = (['jpg', 'png'] as const).map((e) => IMAGE_FORMATS.find((f) => f.ext === e)!);
		const docTargets = (['docx', 'epub'] as const).map((e) => DOCUMENT_FORMATS.find((f) => f.ext === e)!);
		return [...imageTargets, ...docTargets].map((f) => ({ ...f, popular: true, group: 'convert' as const }));
	}
	if (sourceExt === 'docx') {
		// Word docs convert to PDF, and — via an internal DOCX→PDF→raster pass (documentEngine) —
		// to JPG/PNG images (a multi-page doc yields one image per page, bundled into a ZIP).
		const pdf = DOCUMENT_FORMATS.find((f) => f.ext === 'pdf')!;
		const imageTargets = (['jpg', 'png'] as const).map((e) => IMAGE_FORMATS.find((f) => f.ext === e)!);
		return [
			{ ...pdf, group: 'convert' as const },
			...imageTargets.map((f) => ({ ...f, popular: true, group: 'convert' as const })),
		];
	}
	if (sourceExt === 'epub') {
		const pdf = DOCUMENT_FORMATS.find((f) => f.ext === 'pdf')!;
		return [{ ...pdf, group: 'convert' }];
	}
	return [];
}

/**
 * The high-fidelity, fully client-side document conversions handled by documentEngine.ts.
 * Returns null for any pair that isn't one of them. PDF→DOCX/EPUB are text-only (they extract
 * text and reflow it, losing the source's exact visual layout); PPTX→anything stays excluded
 * (no reliable fully-client-side renderer).
 */
export type DocumentOp =
	| 'docx-to-pdf'
	| 'docx-to-image'
	| 'pdf-to-image'
	| 'image-to-pdf'
	| 'pdf-to-docx'
	| 'pdf-to-epub'
	| 'epub-to-pdf';

export function getDocumentOp(sourceExt: string, targetExt: string): DocumentOp | null {
	const s = sourceExt.toLowerCase();
	const t = targetExt.toLowerCase();
	if (s === 'docx' && t === 'pdf') return 'docx-to-pdf';
	if (s === 'docx' && (t === 'jpg' || t === 'jpeg' || t === 'png')) return 'docx-to-image';
	if (s === 'epub' && t === 'pdf') return 'epub-to-pdf';
	if (s === 'pdf' && (t === 'jpg' || t === 'jpeg' || t === 'png')) return 'pdf-to-image';
	if (s === 'pdf' && t === 'docx') return 'pdf-to-docx';
	if (s === 'pdf' && t === 'epub') return 'pdf-to-epub';
	if (IMAGE_TO_PDF_SOURCES.has(s) && t === 'pdf') return 'image-to-pdf';
	return null;
}

export function isFastPathPair(sourceExt: string, targetExt: string): boolean {
	const s = sourceExt.toLowerCase();
	// HEIC/HEIF aren't natively Canvas-decodable, but imageEngine transcodes them to JPEG with
	// heic2any before drawing, so a HEIC→JPG/PNG/WebP conversion still runs on the Canvas path
	// (the ffmpeg core can't decode HEIC at all, so this is the only route that works).
	const decodable = CANVAS_DECODABLE_EXTS.has(s) || HEIC_EXTS.has(s);
	return decodable && CANVAS_ENCODABLE_EXTS.has(targetExt.toLowerCase());
}

export function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB'];
	const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	const value = bytes / 1024 ** i;
	return `${i === 0 ? value : value.toFixed(2)} ${units[i]}`;
}

/**
 * Heading-friendly label: strips parentheticals so "GIF (animated)" → "GIF" and
 * "Word (DOCX)" → "Word". Used for the `X to Y` copy on the per-conversion SEO pages.
 */
export function displayLabel(fmt: FormatDef): string {
	return fmt.label.replace(/\s*\([^)]*\)\s*/g, '').trim();
}

/**
 * One SEO landing page is generated per conversion pair (see `src/pages/[conversion].astro`).
 * A pair is identified by its `slug` (`png-to-jpg`), which is also the route path.
 */
export interface ConversionPair {
	slug: string;
	sourceExt: string;
	targetExt: string;
	sourceLabel: string;
	targetLabel: string;
	sourceCategory: FileCategory;
	targetCategory: FileCategory;
	group: 'convert' | 'extract-audio';
}

/**
 * Every valid (source → target) pair the converter can perform, one entry per unique
 * slug. Built straight from `getAvailableTargets` so it stays in sync with the engines —
 * add a format above and its pages appear automatically. `gif` lives in both the image and
 * video lists; the image entry wins for any slug they share (e.g. `gif-to-png`), while the
 * video entry contributes the video-only targets (`gif-to-mp4`, …). The actual file category
 * is re-detected at run time from the uploaded file, so the winning category here only
 * affects which "related conversions" we cross-link.
 */
export function getAllConversionPairs(): ConversionPair[] {
	const seen = new Set<string>();
	const pairs: ConversionPair[] = [];
	for (const source of ALL_FORMATS) {
		for (const target of getAvailableTargets(source.category, source.ext)) {
			const slug = `${source.ext}-to-${target.ext}`;
			if (seen.has(slug)) continue;
			seen.add(slug);
			pairs.push({
				slug,
				sourceExt: source.ext,
				targetExt: target.ext,
				sourceLabel: displayLabel(source),
				targetLabel: displayLabel(target),
				sourceCategory: source.category,
				targetCategory: target.category,
				group: target.group,
			});
		}
	}
	return pairs;
}

/** Other conversions from the same source format, for cross-linking on a landing page. */
export function getRelatedPairs(pair: ConversionPair, limit = 8): ConversionPair[] {
	return getAllConversionPairs()
		.filter((p) => p.sourceExt === pair.sourceExt && p.slug !== pair.slug)
		.slice(0, limit);
}

/**
 * High-intent conversions surfaced on the homepage. Curated (not popularity-derived) —
 * kept in search-demand order. Any slug not actually generated is filtered out, so this
 * list can't produce dead links even if a format is later removed.
 */
const POPULAR_SLUGS = [
	'png-to-jpg',
	'jpg-to-png',
	'heic-to-jpg',
	'webp-to-png',
	'webp-to-jpg',
	'png-to-webp',
	'mp4-to-mp3',
	'mov-to-mp4',
	'mkv-to-mp4',
	'avi-to-mp4',
	'webm-to-mp4',
	'gif-to-mp4',
	'mp4-to-gif',
	'wav-to-mp3',
	'flac-to-mp3',
	'm4a-to-mp3',
	'pdf-to-jpg',
	'pdf-to-png',
	'pdf-to-docx',
	'pdf-to-epub',
	'docx-to-pdf',
	'epub-to-pdf',
	'jpg-to-pdf',
	'heic-to-pdf',
	'png-to-ico',
	'svg-to-png',
];

export function getPopularPairs(limit = 12): ConversionPair[] {
	const bySlug = new Map(getAllConversionPairs().map((p) => [p.slug, p]));
	return POPULAR_SLUGS.map((slug) => bySlug.get(slug))
		.filter((p): p is ConversionPair => Boolean(p))
		.slice(0, limit);
}
