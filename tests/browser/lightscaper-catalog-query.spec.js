/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { test } from './helpers/browser-coverage-fixture.js';

test.use({ browserCoverage: false });
const ROOT = '/__lightscaper_catalog_query__';
async function routeQuery(page) {
	page.on('console', (message) => { if (message.text().startsWith('catalog-query-measurement')) console.info(message.text()); });
	const bundle = await build({ entryPoints: [fileURLToPath(new URL('../helpers/lightscaper-catalog-query-native-fixture.ts', import.meta.url))],
		bundle: true, write: false, format: 'esm', platform: 'browser' });
	await page.route(`${ROOT}/**`, async (route) => {
		const html = route.request().url().endsWith('/index.html');
		await route.fulfill({ contentType: html ? 'text/html' : 'text/javascript',
			body: html ? '<!doctype html><title>Catalog query qualification</title>' : bundle.outputFiles[0].text });
	});
	await page.goto(`${ROOT}/index.html`);
}

test('native v1 query rebuild resumes across close and includes concurrent writes', async ({ page }) => {
	await routeQuery(page);
	const result = await page.evaluate(async (root) => (await import(`${root}/entry.js`)).qualifyCatalogQueryMigrationNativeV1(), ROOT);
	expect(result.refusal).toBe('PHOTO_QUERY_INDEX_NOT_READY'); expect(result.first.processed).toBe(16);
	expect(result.first.ready).toBe(false); expect(result.count).toBe(44); expect(result.newPhoto).toBe(true);
	expect(result.currentRating).toBe(5); expect(result.firstCapture.every(Boolean)).toBe(true);
	expect(result.originalSha256).toBe('a'.repeat(64));
});

test('100,000 native query rows preserve global order and bounded sparse-search steps', async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'The large-library query timing gate covers Chromium and Firefox; WebKit qualifies query migration only.');
	test.setTimeout(180_000); await routeQuery(page);
	const result = await page.evaluate(async (root) => (await import(`${root}/entry.js`)).qualifyCatalogQueryScaleNativeV1(), ROOT);
	expect(result.first).toBe('photo-099999'); expect(result.distant).toBe('photo-004999');
	expect(result.sparseIds).toEqual(Array.from({ length: 101 }, (_, index) => `photo-${String(index * 997).padStart(6, '0')}`));
	expect(result.maximumCandidates).toBeLessThanOrEqual(64); expect(result.emptySteps).toBeGreaterThan(1_400);
	expect(result.forbiddenReads).toBe(0); expect(result.active).toBe(0); expect(result.p95Milliseconds).toBeLessThanOrEqual(250);
	test.info().annotations.push({ type: 'query-budget', description: JSON.stringify({ steps: result.steps, p95Milliseconds: result.p95Milliseconds,
		seedMilliseconds: result.seedMilliseconds, queryMilliseconds: result.queryMilliseconds }) });
});
