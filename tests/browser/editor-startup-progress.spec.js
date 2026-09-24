/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';

for (const productId of ['soundscaper', 'framescaper']) {
	test(`${productId} shows measured editor-file progress through startup`, async ({ page }) => {
		let releaseEntry;
		let releaseBootstrap;
		let entryRequested = false;
		let bootstrapRequested = false;
		const entryGate = new Promise((resolve) => { releaseEntry = resolve; });
		const bootstrapGate = new Promise((resolve) => { releaseBootstrap = resolve; });
		await page.route(/\/assets\/index-[^/]+\.js$/u, async (route) => {
			entryRequested = true;
			await entryGate;
			await route.continue();
		});
		await page.route(new RegExp(`/assets/${productId === 'framescaper'
			? 'Framescaper' : 'Soundscaper'}AudioEditorBootstrap-[^/]+\\.js$`, 'u'), async (route) => {
			bootstrapRequested = true;
			await bootstrapGate;
			await route.continue();
		});
		try {
			await page.goto(resolveBrowserProductTestUrl(productId === 'framescaper' ? '/framescaper/en/' : '/en/'), {
				waitUntil: 'commit',
			});
			await expect.poll(() => entryRequested).toBe(true);
			const firstPaint = page.getByRole('progressbar', { name: 'Loading project', exact: true });
			await expect(firstPaint).toBeVisible();
			await expect(firstPaint).not.toHaveAttribute('aria-valuenow');
			expect((await firstPaint.boundingBox())?.height).toBe(2);
			await page.emulateMedia({ reducedMotion: 'reduce' });
			await expect.poll(() => firstPaint.evaluate((element) => (
				getComputedStyle(element, '::after').animationName
			))).toBe('none');

			releaseEntry();
			await expect.poll(() => bootstrapRequested).toBe(true);
			const measured = page.locator('.website-audio-editor-section')
				.getByRole('progressbar', { name: 'Loading editor files' });
			await expect(measured).toBeVisible();
			await expect(firstPaint).toHaveCount(0);
			await expect.poll(async () => Number(await measured.getAttribute('aria-valuenow')))
				.toBeGreaterThan(0);
			const percentage = Number(await measured.getAttribute('aria-valuenow'));
			expect(percentage).toBeLessThan(100);
			await expect(page.locator('[data-audio-editor]')).toHaveCount(0);

			releaseBootstrap();
			const editor = page.locator('[data-audio-editor-bound="true"]');
			await expect(editor).toHaveAttribute('data-product', productId, { timeout: 20_000 });
			await expect(measured).toHaveCount(0);
		} finally {
			releaseEntry();
			releaseBootstrap();
		}
	});
}

test('a retired editor chunk replaces loading progress with the stale-build prompt', async ({ page }) => {
	await page.route('**/offline-shell.json', (route) => route.fulfill({
		status: 200,
		contentType: 'application/json',
		body: JSON.stringify({
			schemaVersion: 2,
			assets: [{ url: '/assets/retired.js', byteLength: 1, sha256: 'a'.repeat(64) }],
		}),
	}));
	await page.route(/\/assets\/SoundscaperAudioEditorBootstrap-[^/]+\.js$/u, (route) => route.fulfill({
		status: 404,
		contentType: 'text/html',
		body: '<!doctype html><title>Not found</title>',
	}));
	await page.goto('/en/');
	await expect(page.getByRole('alertdialog', { name: 'Editor is out of date' })).toBeVisible();
	await expect(page.locator('[data-editor-startup-progress]')).toHaveCount(0);
});
