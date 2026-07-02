// @ts-check
import { defineConfig, fontProviders } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	site: 'https://freeformatconvert.com',
	fonts: [
		{
			provider: fontProviders.fontsource(),
			name: 'Geist',
			cssVariable: '--font-geist-sans',
			weights: [400, 500, 600],
			styles: ['normal'],
			fallbacks: ['sans-serif'],
		},
		{
			provider: fontProviders.fontsource(),
			name: 'Geist Mono',
			cssVariable: '--font-geist-mono',
			weights: [400],
			styles: ['normal'],
			fallbacks: ['monospace'],
		},
		{
			// Display face for hero headings — geometric, distinctive, premium.
			provider: fontProviders.fontsource(),
			name: 'Space Grotesk',
			cssVariable: '--font-space-grotesk',
			weights: [500, 600, 700],
			styles: ['normal'],
			fallbacks: ['sans-serif'],
		},
	],
});
