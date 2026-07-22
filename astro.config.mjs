// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import scopeAudacityDesignSystemCss from './scripts/postcss-audacity-design-system.mjs';

export default defineConfig({
	site: process.env.ASTRO_SITE ?? 'https://soundscaper.org',
	output: 'static',
	integrations: [react()],
	redirects: {
		'/': '/en/',
	},
	vite: {
		worker: {
			format: 'es',
		},
		build: {
			assetsInlineLimit: 0,
		},
		css: {
			postcss: {
				plugins: [scopeAudacityDesignSystemCss()],
			},
		},
	},
});
