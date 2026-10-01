/* SPDX-License-Identifier: AGPL-3.0-only */

import { test as base } from './browser-coverage-fixture.js';

// Web builds consume and remove Vite's manifest. Specs which simulate a
// desktop bridge need its bootstrap identity for the default Speed preference,
// while the dedicated Speed scenario installs a richer route of its own.
// Keep this out of service-worker scenarios: routing disables the HTTP cache.
export const test = base.extend({
	page: async ({ page, serviceWorkers }, use) => {
		if (serviceWorkers === 'block') {
			await page.route('**/.offline-build-manifest.json', async (route) => {
				const productId = await route.request().frame().evaluate(() => {
					const product = document.documentElement.dataset.product;
					if (product !== 'soundscaper' && product !== 'framescaper') return null;
					const candidates = [globalThis.scapeDesktop, globalThis.soundscaperDesktop];
					if (product === 'framescaper') candidates.push(globalThis.framescaperDesktop);
					return candidates.some((candidate) => candidate?.v1
						&& typeof candidate.v1 === 'object') ? product : null;
				});
				if (productId === null || !route.request().url().startsWith('http:')) {
					await route.fallback();
					return;
				}
				const bootstrap = productId === 'soundscaper' ? 'Soundscaper' : 'Framescaper';
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						[`src/${productId}/ui/${bootstrap}AudioEditorBootstrap.tsx`]: {
							file: 'assets/desktop-fixture-bootstrap.js', isDynamicEntry: true,
						},
					}),
				});
			});
		}
		await use(page);
	},
});
