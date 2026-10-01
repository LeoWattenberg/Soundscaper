/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors } from './audio-editor-test-helpers.js';

// The override scenario serves a synthetic feature module outside the built site.
test.use({ browserCoverage: false });

for (const productId of ['soundscaper', 'framescaper']) {
	test(`${productId} desktop stubs finish Speed preparation without a web build manifest`, async ({ page }) => {
		await installDesktopBridge(page, `${productId}Desktop`);
		const errors = collectClientErrors(page);
		const path = productId === 'soundscaper' ? '/embed/en/' : '/framescaper/embed/en/';
		const editor = await bootEditor(page, path);
		await expect(editor).toHaveAttribute('data-product', productId);
		const warmup = page.locator('[data-desktop-speed-warmup="ready"]');
		await expect(warmup).toHaveCount(1);
		await expect(warmup).toHaveAttribute('data-desktop-speed-warmup-failed', '0');
		expect(errors).toEqual([]);
	});
}

test('a desktop Speed scenario can replace the shared manifest with its feature modules', async ({ page }) => {
	await installDesktopBridge(page, 'scapeDesktop');
	const errors = collectClientErrors(page);
	let featureRequests = 0;
	await page.route('**/assets/desktop-fixture-override.js', async (route) => {
		featureRequests += 1;
		await route.fulfill({ status: 200, contentType: 'text/javascript', body: 'export const ready = true;' });
	});
	await page.route('**/.offline-build-manifest.json', async (route) => {
		await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
			'src/soundscaper/ui/SoundscaperAudioEditorBootstrap.tsx': {
				file: 'assets/desktop-fixture-bootstrap.js', isDynamicEntry: true,
			},
			'src/common/editor/ui/dialogs/FixtureDialog.tsx': {
				file: 'assets/desktop-fixture-override.js', isDynamicEntry: true,
			},
		}) });
	});
	await bootEditor(page, '/embed/en/');
	await expect(page.locator('[data-desktop-speed-warmup="ready"]'))
		.toHaveAttribute('data-desktop-speed-warmup-failed', '0');
	expect(featureRequests).toBe(1);
	expect(errors).toEqual([]);
});

async function installDesktopBridge(page, name) {
	await page.addInitScript((bridgeName) => {
		Object.defineProperty(globalThis, bridgeName, {
			configurable: true,
			enumerable: true,
			value: Object.freeze({ v1: Object.freeze({
				getEnvironment: () => Promise.resolve({ platform: 'win32' }),
			}) }),
		});
	}, name);
}
