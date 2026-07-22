// @ts-check
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import scopeAudacityDesignSystemCss from './scripts/postcss-audacity-design-system.mjs';

const productId = process.env.SCAPE_PRODUCT === 'framescaper' ? 'framescaper' : 'soundscaper';

export default defineConfig({
	appType: 'spa',
	plugins: [react()],
	envPrefix: ['VITE_', 'PUBLIC_'],
	define: {
		__SCAPE_PRODUCT__: JSON.stringify(productId),
	},
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
});
