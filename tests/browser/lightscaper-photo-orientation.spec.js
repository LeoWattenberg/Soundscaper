/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { test } from './helpers/browser-coverage-fixture.js';

test.use({ browserCoverage: false });
const ROOT = '/__lightscaper_photo_orientation__';

async function routeOrientation(page) {
	const bundle = await build({ entryPoints: [fileURLToPath(new URL('../helpers/lightscaper-photo-orientation-native-fixture.ts', import.meta.url))],
		bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'] });
	await page.route(`${ROOT}/**`, async route => {
		const html = route.request().url().endsWith('/index.html');
		await route.fulfill({ contentType: html ? 'text/html' : 'text/javascript', body: html
			? '<!doctype html><title>Native JPEG Exif pixel qualification</title>' : bundle.outputFiles[0].text });
	});
	await page.goto(`${ROOT}/index.html`);
}

test('genuine JPEG Exif1..8 produces exact baseline pixel rotations and mirrors while retaining edited original bytes', async ({ page, browser }, info) => {
	await routeOrientation(page);
	const result = await page.evaluate(async root => (await import(`${root}/entry.js`)).qualifyPhotoExifOrientationNativeV1(), ROOT);
	await info.attach('native-jpeg-orientation-observations', { body: JSON.stringify({ browserVersion: browser.version(), ...result }, null, 2), contentType: 'application/json' });
	expect(result.encodedByteLength).toBeLessThanOrEqual(64 * 1024);
	expect(result.maximumSeedSampleDifference).toBeLessThanOrEqual(16);
	expect(result.nativeRuntimes.length).toBeGreaterThan(0);
	expect(result.rows).toHaveLength(8);
	for (const row of result.rows) {
		expect(row, `EXIF orientation${row.orientation}`).toMatchObject({ status: 'prepared', metadataOrientation: row.orientation,
			extractedOrientation: row.orientation, unequalChannels: 0, maximumPixelDifference: 0, originalBytesEqual: true,
			packedOriginalEqual: true, inputUnchanged: true, shaMatches: true, lengthMatches: true, pixelByteLength: 3072, opaque: true });
		expect([row.width, row.height]).toEqual([row.expectedWidth, row.expectedHeight]);
	}
});

test('a genuine JPEG with unsupported Exif ColorSpace refuses before opening the browser decoder', async ({ page }) => {
	await routeOrientation(page);
	const result = await page.evaluate(async root => (await import(`${root}/entry.js`)).qualifyPhotoExifColorRefusalNativeV1(), ROOT);
	expect(result).toMatchObject({ outcome: 'failed', opened: 0, inputUnchanged: true });
	expect(result.message).toMatch(/Exif.*colour/iu);
});
