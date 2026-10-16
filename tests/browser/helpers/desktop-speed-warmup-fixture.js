/* SPDX-License-Identifier: AGPL-3.0-only */

import { test as base } from './browser-coverage-fixture.js';

export const test = base;

// Web builds consume and remove Vite's manifest. Only fixtures which install a
// desktop bridge need this bootstrap identity for the default Speed preference.
// Installing any route disables HTTP caching, so ordinary web pages keep the
// coverage fixture unchanged. Call this before installing a simulated bridge.
const installed = new WeakSet();

export async function installDesktopSpeedWarmupManifest(page) {
	if (installed.has(page)) return;
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
	installed.add(page);
}
