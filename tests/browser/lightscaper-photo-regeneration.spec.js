/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { test, expect } from './helpers/browser-coverage-fixture.js';

test.use({ browserCoverage: false });
const ROOT = '/__lightscaper_photo_regeneration__';
let bundled;
test.beforeAll(async () => {
	const result = await build({ entryPoints: ['tests/helpers/lightscaper-photo-regeneration-native-fixture.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
	bundled = result.outputFiles[0].text;
});
async function fixture(page) {
	await page.route(`${ROOT}/**`, async route => {
		if (new URL(route.request().url()).pathname.endsWith('/fixture.js')) await route.fulfill({ status: 200, contentType: 'text/javascript', body: bundled });
		else await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Original regeneration qualification</title>' });
	});
	await page.goto(`${ROOT}/index.html`);
}

test('retained JPEG EXIF1..8 regenerates exact original-free pixel previews and clears temporary frame custody', async ({ page }) => {
	await fixture(page);
	const result = await page.evaluate(async root => (await import(`${root}/fixture.js`)).qualifyPhotoOriginalRegenerationNativeV1(), ROOT);
	expect(result.encodedByteLength).toBeLessThanOrEqual(64 * 1024); expect(result.rows).toHaveLength(8);
	expect(result.maximumSeedSampleDifference).toBeLessThanOrEqual(16);
	for (const row of result.rows) {
		expect(row.sourceOrientation).toBe(row.orientation); expect(row.width).toBe(row.expectedWidth); expect(row.height).toBe(row.expectedHeight);
		expect(row.unequalChannels).toBe(0); expect(row.maximumPixelDifference).toBe(0);
		expect(row.closed).toBe(1); expect(row.consumedAfterClose).toBe(true); expect(row.frameWiped).toBe(true);
		expect(row.originalShaMatches).toBe(true); expect(row.inputUnchanged).toBe(true); expect(row.outputShaMatches).toBe(true);
		expect(row.bodyLength).toBe(3072); expect(row.opaque).toBe(true); expect(row.bodyOriginalFree).toBe(true);
	}
});

test('original digest and explicit unsupported color declarations refuse before native decoder open', async ({ page }) => {
	await fixture(page);
	const result = await page.evaluate(async root => (await import(`${root}/fixture.js`)).qualifyPhotoOriginalRegenerationRefusalNativeV1(), ROOT);
	expect(result.opened).toBe(0); expect(result.consumed).toBe(0); expect(result.inputUnchanged).toBe(true);
	expect(result.colorError).toMatch(/sRGB|colour|ColorSpace/u); expect(result.digestError).toMatch(/SHA|digest/u);
});

test('cancellation after a genuine late native JPEG open closes the session without consuming pixels', async ({ page }) => {
	await fixture(page);
	const result = await page.evaluate(async root => (await import(`${root}/fixture.js`)).qualifyPhotoOriginalRegenerationCancellationNativeV1(), ROOT);
	expect(result).toEqual({ opened: 1, closed: 1, consumed: 0, rejectedReason: true, inputUnchanged: true });
});
