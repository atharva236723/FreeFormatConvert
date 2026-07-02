import type { APIRoute } from 'astro';
import { getAllConversionPairs } from '../lib/formats';

/** Static routes that aren't generated from the conversion matrix. */
const STATIC_PATHS = [
	'/',
	'/conversions',
	'/about',
	'/contact',
	'/terms',
	'/privacy',
	'/video-to-gif',
	'/image-to-gif',
	'/pdf-converter',
	'/document-converter',
	'/ebook-converter',
];

export const GET: APIRoute = ({ site }) => {
	// `site` comes from `astro.config.mjs`; without it we can't build absolute URLs.
	const origin = (site ?? new URL('https://freeformatconvert.com')).origin;

	const paths = [...STATIC_PATHS, ...getAllConversionPairs().map((pair) => `/${pair.slug}`)];

	const urls = paths
		.map((path) => `  <url>\n    <loc>${origin}${path}</loc>\n  </url>`)
		.join('\n');

	const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

	return new Response(body, {
		headers: { 'Content-Type': 'application/xml; charset=utf-8' },
	});
};
