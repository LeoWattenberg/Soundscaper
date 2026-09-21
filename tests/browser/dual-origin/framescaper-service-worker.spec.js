/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from '../audio-editor-test-fixtures.js';
import { resolveBrowserProductTestUrl } from '../helpers/browser-product-test-url.js';

const FRAMESCAPER_ORIGIN = new URL(resolveBrowserProductTestUrl('/framescaper/')).origin;

// The dual-origin suite blocks service workers by default. This one isolated
// context executes the authenticated Framescaper worker for coverage.
test.use({ serviceWorkers: 'allow' });

test('the authenticated Framescaper site installs and activates its production service worker', async ({ page }) => {
	await page.goto(`${FRAMESCAPER_ORIGIN}/en/`);
	await expect(page.locator('html')).toHaveAttribute('data-product', 'framescaper');
	const registration = await page.evaluate(async () => {
		const ready = await navigator.serviceWorker.ready;
		if (!ready.active) throw new Error('Framescaper service worker has no active registration.');
		if (ready.active.state !== 'activated') {
			await new Promise((resolve, reject) => {
				const changed = () => {
					if (ready.active.state === 'activated') {
						ready.active.removeEventListener('statechange', changed);
						resolve();
					} else if (ready.active.state === 'redundant') {
						ready.active.removeEventListener('statechange', changed);
						reject(new Error('Framescaper service worker became redundant before activation.'));
					}
				};
				ready.active.addEventListener('statechange', changed);
				changed();
			});
		}
		return {
			scope: ready.scope,
			scriptURL: ready.active.scriptURL,
			state: ready.active.state,
		};
	});
	expect(registration).toEqual({
		scope: `${FRAMESCAPER_ORIGIN}/`,
		scriptURL: `${FRAMESCAPER_ORIGIN}/service-worker.js`,
		state: 'activated',
	});
});
