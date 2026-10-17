/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { test } from './helpers/browser-coverage-fixture.js';

test.use({ browserCoverage: false });
const ROOT = '/__lightscaper_preview_cache__';

async function scenario(page, mode) {
	const bundle = await build({ entryPoints: [fileURLToPath(new URL('../helpers/lightscaper-preview-cache-native-fixture.ts', import.meta.url))],
		bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'] });
	await page.route(`${ROOT}/**`, async route => {
		const html = route.request().url().endsWith('/index.html');
		await route.fulfill({ contentType: html ? 'text/html' : 'text/javascript',
			body: html ? '<!doctype html><title>Native photo preview cache qualification</title>' : bundle.outputFiles[0].text });
	});
	await page.goto(`${ROOT}/index.html`);
	return page.evaluate(async ({ root, mode }) => {
		const api = await import(`${root}/entry.js`);
		return api.qualifyPhotoPreviewCacheNativeV1(mode);
	}, { root: ROOT, mode });
}

function retained(result) {
	expect(result.width).toBe(24); expect(result.height).toBe(32);
	expect(result.maximumPixelDifference).toBeLessThanOrEqual(2);
	expect(result.bodyOriginalFree).toBe(true); expect(result.originalBytesEqual).toBe(true);
	expect(result.photoStatesEqual).toBe(true); expect(result.assets).toBe(1);
	expect(result.permanentPhotos).toEqual(['photo-1', 'photo-2']); expect(result.stagedPhotos).toEqual(['photo-1', 'photo-2']);
	expect(result.deletionRefused).toBe(true); expect(result.inventoryCalls).toEqual([]);
}

test('native retained-original previews preserve oriented pixels and custody across durable cache reopen', async ({ page, browserName }) => {
	const result = await scenario(page, 'reopen'); retained(result);
	expect(result.keys[0]).not.toBe(result.keys[1]); expect(result.reopenedPixelsEqual).toBe(true);
	expect(result.originalReadsBeforeReopen).toBe(2);
	if (browserName === 'webkit' && result.cache.every(value => value === 'transient')) {
		expect(result.reopenedCache).toBe('transient'); expect(result.originalReadsAfterReopen).toBe(3);
	} else {
		expect(result.cache).toEqual(['stored', 'stored']); expect(result.reopenedCache).toBe('hit');
		expect(result.originalReadsAfterReopen).toBe(2);
	}
});

test('native paired Blob failure returns an independent transient preview and rolls back both cache rows', async ({ page }) => {
	const result = await scenario(page, 'fault'); retained(result);
	expect(result.cache).toBe('transient'); expect(result.persistenceFailure).toContain('Blob/File');
	expect(result.failureRows).toEqual({ payload: 0, inventory: 0 });
});
