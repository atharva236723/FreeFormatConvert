/**
 * Single source of truth for the standalone tools (compressors, image/PDF editors, converters).
 * The /tools index, NavBar and Footer menus, and sitemap.xml all read from here, so adding a tool
 * page means adding one entry — everything else picks it up automatically (mirrors formats.ts).
 */

export interface ToolLink {
	href: string;
	label: string;
	desc: string;
}

export interface ToolGroup {
	title: string;
	tools: ToolLink[];
}

export const TOOL_GROUPS: ToolGroup[] = [
	{
		title: 'Compress',
		tools: [
			{ href: '/compress-image', label: 'Compress Image', desc: 'Shrink JPG, PNG or WebP with a quality slider.' },
			{ href: '/compress-video', label: 'Compress Video', desc: 'Reduce MP4, MOV, MKV and more to a smaller file.' },
			{ href: '/compress-audio', label: 'Compress Audio', desc: 'Lower the bitrate of MP3, WAV, M4A and more.' },
			{ href: '/compress-gif', label: 'Compress GIF', desc: 'Scale down and drop frames for a lighter GIF.' },
		],
	},
	{
		title: 'Image tools',
		tools: [
			{ href: '/resize-image', label: 'Resize Image', desc: 'Set exact pixel dimensions, aspect-ratio lock.' },
			{ href: '/crop-image', label: 'Crop Image', desc: 'Drag a selection box to keep part of an image.' },
			{ href: '/rotate-image', label: 'Rotate Image', desc: 'Turn by 90° steps or any fine angle.' },
			{ href: '/flip-image', label: 'Flip Image', desc: 'Mirror horizontally, vertically or both.' },
			{ href: '/color-picker', label: 'Color Picker', desc: 'Sample HEX and RGB colors from an image.' },
		],
	},
	{
		title: 'PDF tools',
		tools: [
			{ href: '/merge-pdf', label: 'Merge PDF', desc: 'Combine several PDFs into one, in your order.' },
			{ href: '/split-pdf', label: 'Split PDF', desc: 'Separate pages into individual PDF files.' },
			{ href: '/rotate-pdf', label: 'Rotate PDF', desc: 'Rotate every page or just the ones you pick.' },
			{ href: '/remove-pages-pdf', label: 'Remove PDF Pages', desc: 'Delete unwanted pages from a PDF.' },
			{ href: '/extract-pages-pdf', label: 'Extract PDF Pages', desc: 'Pull selected pages into a new PDF.' },
		],
	},
	{
		title: 'Video tools',
		tools: [
			{ href: '/trim-video', label: 'Trim Video', desc: 'Cut a clip to just the part you want.' },
		],
	},
	{
		title: 'Converters',
		tools: [
			{ href: '/unit-converter', label: 'Unit Converter', desc: 'Length, weight, temperature, speed & more.' },
			{ href: '/time-converter', label: 'Time Converter', desc: 'Seconds, minutes, hours, days, weeks, years.' },
		],
	},
];

/** Flat list of every tool route, for the sitemap. */
export const TOOL_PATHS: string[] = TOOL_GROUPS.flatMap((g) => g.tools.map((t) => t.href));

/** A short, curated set surfaced in the NavBar/Footer menus. */
export const FEATURED_TOOLS: ToolLink[] = [
	{ href: '/compress-image', label: 'Compress Image', desc: '' },
	{ href: '/compress-video', label: 'Compress Video', desc: '' },
	{ href: '/resize-image', label: 'Resize Image', desc: '' },
	{ href: '/crop-image', label: 'Crop Image', desc: '' },
	{ href: '/merge-pdf', label: 'Merge PDF', desc: '' },
	{ href: '/split-pdf', label: 'Split PDF', desc: '' },
	{ href: '/trim-video', label: 'Trim Video', desc: '' },
	{ href: '/unit-converter', label: 'Unit Converter', desc: '' },
];
