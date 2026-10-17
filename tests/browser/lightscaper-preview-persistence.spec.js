/* SPDX-License-Identifier: AGPL-3.0-only */

import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { authoredWildcardResponseHeaders } from '../../scripts/lib/static-response-headers.mjs';
import { expect, test } from './helpers/browser-coverage-fixture.js';

const ROOT = '/__lightscaper_preview_persistence__';
// These six cuts qualify the actual asynchronous OPFS route. They do not claim
// sync-worker execution, selected-store Close cancellation, or every possible interruption.
const CUTS = ['after-write', 'after-close', 'payload-put', 'inventory-put', 'completed-ack', 'cleanup-ack'];

for (const cut of CUTS) test(`native photo preview ${cut} preserves its paired publication contract and original regeneration`, async ({ page }) => {
	const result = await qualify(page, cut), committed = cut === 'completed-ack' || cut === 'cleanup-ack';
	expect(result.kind).toBe(cut); expect(result.directSharedLifecycle).toBe(true);
	expect(result.asyncNativeOpfs).toBe(true); expect(result.workerQualified).toBe(false);
	expect(result.cut.fired).toBe(true); expect(result.cut.writeBytes).toBe(24 * 32 * 4); expect(result.lifecycleReleased).toBe(true);
	expect(result.width).toBe(24); expect(result.height).toBe(32); expect(result.maximumPixelDifference).toBeLessThanOrEqual(2);
	expect(result.originalSha256).toMatch(/^[a-f0-9]{64}$/u); expect(result.nativeOriginalSha256).toBe(result.originalSha256);
	for (const field of ['originalMetadataExact', 'originalPathExact', 'originalBytesExact', 'originalShaExact', 'photoStateExact',
		'deletionRefused', 'reopenedPixelsExact', 'regeneratedPixelsExact', 'cleanupErrorsExact']) expect(result[field]).toBe(true);
	expect(result.permanentPhotos).toEqual(['photo-1']); expect(result.stagedPhotos).toEqual(['photo-1']); expect(result.assets).toBe(1);
	expect(result.regeneratedNativeSha256).toBe(result.previewSha256); expect(result.finalNativeSha256).toBe(result.previewSha256);
	expect(result.regeneratedCache).toBe('stored'); expect(result.trimmed).toEqual({ removedEntries: 1, removedBytes: 24 * 32 * 4, more: false });
	expect(result.afterTrim).toEqual({ payload: 0, inventory: 0, pair: null, pathPresent: false, nativeFileSha256: null });
	if (cut === 'after-write') expect(result.cut.closedSha256).toBeNull();
	else expect(result.cut.closedSha256).toBe(result.previewSha256);
	if (committed) {
		expect(result.receipt).toBe('stored'); expect(result.refusal).toBeNull(); expect(result.cut.aborted).toBe(true);
		expect(result.cut.completed).toBe(1); expect(result.cut.transactionAborts).toBe(0);
		expect(result.cut.putSuccesses).toEqual(['videoDerivatives', 'videoDerivativeCacheEntries']);
		expect(result.afterCut).toMatchObject({ payload: 1, inventory: 1, pathPresent: true, nativeFileSha256: result.previewSha256,
			pair: { storage: 'opfs', outputSha256: result.previewSha256, size: 24 * 32 * 4 } });
		expect(result.reopenedPair).toEqual(result.afterCut); expect(result.reopenedCache).toBe('hit');
		expect(result.readsAfterReopen).toBe(1); expect(result.originalReads).toBe(2);
		expect(result.cleanupErrorCount).toBe(cut === 'cleanup-ack' ? 1 : 0);
		if (cut === 'cleanup-ack') { expect(result.replaced).toBe(true); expect(result.oldPathAbsent).toBe(true); expect(result.cut.deletedPath).toBeTruthy(); }
	} else {
		expect(result.receipt).toBeNull(); expect(result.refusal).toBeTruthy(); expect(result.cleanupErrorCount).toBe(0);
		expect(result.afterCut).toEqual({ payload: 0, inventory: 0, pair: null, pathPresent: false, nativeFileSha256: null });
		expect(result.reopenedPair).toEqual(result.afterCut); expect(result.reopenedCache).toBe('stored');
		expect(result.readsAfterReopen).toBe(2); expect(result.originalReads).toBe(3);
		expect(result.cut.completed).toBe(0);
		if (cut === 'payload-put' || cut === 'inventory-put') {
			expect(result.cut.transactionAborts).toBe(1); expect(result.cut.putSuccesses).toContain(cut === 'payload-put' ? 'videoDerivatives' : 'videoDerivativeCacheEntries');
		} else { expect(result.exactCancellation).toBe(true); expect(result.cut.aborted).toBe(true); expect(result.cut.transactionAborts).toBe(0); }
	}
});

async function qualify(page, cut) {
	const entry = new URL('../helpers/lightscaper-preview-persistence-native-v1.ts', import.meta.url);
	const bundle = await build({ entryPoints: [fileURLToPath(entry)], bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'] });
	const headers = authoredWildcardResponseHeaders();
	await page.context().route(`**${ROOT}/**`, async route => {
		const html = route.request().url().endsWith('/index.html');
		await route.fulfill({ contentType: html ? 'text/html' : 'text/javascript', headers,
			body: html ? '<!doctype html><title>Native photo preview persistence boundaries</title>' : bundle.outputFiles[0].text });
	});
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS
		? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}${ROOT}/index.html`);
	return page.evaluate(async ({ root, cut }) => (await import(`${root}/entry.js`)).qualifyPhotoPreviewPersistenceNativeV1(cut), { root: ROOT, cut });
}
