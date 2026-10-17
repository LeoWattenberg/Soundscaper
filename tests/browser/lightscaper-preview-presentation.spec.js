/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { test } from './helpers/browser-coverage-fixture.js';

test.use({ browserCoverage: false });
const ROOT = '/__lightscaper_preview_presentation__';

async function fixture(page) {
	const bundle = await build({ entryPoints: [fileURLToPath(new URL('../helpers/lightscaper-preview-presentation-native-fixture.tsx', import.meta.url))],
		bundle: true, write: false, format: 'esm', platform: 'browser', outdir: 'preview-presentation-fixture', entryNames: 'entry' });
	await page.route(`${ROOT}/**`, async route => {
		const path = new URL(route.request().url()).pathname, html = path.endsWith('/index.html'), css = path.endsWith('.css');
		const output = bundle.outputFiles.find(file => file.path.endsWith(css ? '.css' : '.js'));
		await route.fulfill({ contentType: html ? 'text/html' : css ? 'text/css' : 'text/javascript',
			body: html ? '<!doctype html><title>Preview presentation qualification</title><link rel="stylesheet" href="entry.css">' : output.text });
	});
	await page.goto(`${ROOT}/index.html`);
}

test('native raw preview presentation preserves oriented pixels and alpha, aliases staging, and releases backing', async ({ page }) => {
	await fixture(page);
	const result = await page.evaluate(async root => (await import(`${root}/entry.js`)).qualifyPixelCanvasNativeV1(), ROOT);
	expect(result.width).toBe(2); expect(result.height).toBe(3);
	for (let index = 0; index < result.pixels.length; index++) {
		const alpha = result.oracle[index - index % 4 + 3];
		const tolerance = index % 4 === 3 || alpha === 255 || alpha === 0 ? 0 : 2;
		expect(Math.abs(result.pixels[index] - result.oracle[index])).toBeLessThanOrEqual(tolerance);
	}
	expect(result.imageDataAliases).toBe(true); expect(result.stagedPixelsWiped).toBe(true);
	expect(result.bodyDigestUnchanged).toBe(true); expect([result.releasedWidth, result.releasedHeight]).toEqual([0, 0]);
	if (result.priorContextWasOpaque) expect(result.opaqueRefused).toBe(true);
	else { expect(result.opaqueRefused).toBe(false); expect(result.ignoredOptionPreservesAlpha).toBe(true); }
	expect(result.opaqueReleased).toBe(true);
});

test('React previews opt in, keep64MiB thumbnails and16MiB loupe, and release surfaces on close', async ({ page }) => {
	await fixture(page);
	await page.evaluate(async root => { (await import(`${root}/entry.js`)).mountPreviewPresentationNativeV1(); }, ROOT);
	await expect(page.getByRole('button', { name: 'Show thumbnails' })).toBeVisible();
	expect(await page.evaluate(async root => (await import(`${root}/entry.js`)).previewPresentationStateNativeV1(), ROOT)).toMatchObject({ calls: [], active: 0 });
	await expect(page.getByRole('img')).toHaveCount(0);
	await page.getByRole('button', { name: 'Show thumbnails' }).click();
	await expect(page.getByRole('status', { name: 'Thumbnail backing bytes' })).toHaveText(String(64 * 1024 * 1024));
	await expect(page.getByRole('img', { name: /Thumbnail/u })).toHaveCount(64);
	await page.getByRole('button', { name: 'Show loupe' }).click();
	await expect(page.getByRole('status', { name: 'Loupe backing bytes' })).toHaveText(String(16 * 1024 * 1024));
	await expect(page.getByRole('status', { name: 'Thumbnail backing bytes' })).toHaveText(String(64 * 1024 * 1024));
	const dimensions = await page.getByRole('img').evaluateAll(canvases => canvases.reduce((bytes, canvas) => bytes + canvas.width * canvas.height * 4, 0));
	expect(dimensions).toBe(80 * 1024 * 1024);
	await page.getByRole('button', { name: 'Close previews' }).click(); await expect(page.getByRole('img')).toHaveCount(0);
	const state = await page.evaluate(async root => (await import(`${root}/entry.js`)).previewPresentationStateNativeV1(), ROOT);
	expect(state.maximumActive).toBe(1); expect(state.detachedDimensions).toHaveLength(65);
	expect(state.detachedDimensions.every(pair => pair[0] === 0 && pair[1] === 0)).toBe(true);
});

test('page and factory transitions join held demand before publishing a new preview generation', async ({ page }) => {
	await fixture(page);
	await page.evaluate(async root => { const api = await import(`${root}/entry.js`); api.holdNextPreviewNativeV1(); api.mountPreviewPresentationNativeV1(); }, ROOT);
	await page.getByRole('button', { name: 'Show thumbnails' }).click();
	await expect.poll(async () => page.evaluate(async root => (await import(`${root}/entry.js`)).previewPresentationStateNativeV1(), ROOT)).toMatchObject({ active: 1 });
	await page.getByRole('button', { name: 'Next page' }).click(); await page.getByRole('button', { name: 'Replace factory' }).click();
	const held = await page.evaluate(async root => (await import(`${root}/entry.js`)).previewPresentationStateNativeV1(), ROOT);
	expect(held.calls).toHaveLength(1); expect(held.heldAborted).toBe(true);
	await page.evaluate(async root => { (await import(`${root}/entry.js`)).releaseHeldPreviewNativeV1(); }, ROOT);
	await expect(page.getByRole('status', { name: 'Thumbnail backing bytes' })).toHaveText(String(64 * 1024 * 1024));
	await expect(page.getByRole('img', { name: /Thumbnail page-1/u })).toHaveCount(64);
	const state = await page.evaluate(async root => (await import(`${root}/entry.js`)).previewPresentationStateNativeV1(), ROOT);
	expect(state.maximumActive).toBe(1); expect(state.calls.slice(1).every(call => call.startsWith('1:page-1-'))).toBe(true);
});
