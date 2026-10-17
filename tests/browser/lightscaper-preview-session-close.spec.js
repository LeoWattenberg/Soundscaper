/* SPDX-License-Identifier: AGPL-3.0-only */

import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { expect, installNativeImageHandoffRuntime, qualifyNativePhotoPreviewSessionClose, test } from './helpers/lightscaper-image-handoff-native-fixture.js';

const CUTS = ['after-write', 'after-close', 'payload-put', 'inventory-put', 'completed-ack', 'cleanup-ack'];

for (const cut of CUTS) test(`selected preview Session.close at ${cut} joins native work and preserves original custody`, async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'This native sync-worker qualification is maintained for Chromium and Firefox.');
	await installNativeImageHandoffRuntime(page);
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/?lang=en`);
	await expect(page.getByRole('region', { name: 'Lightscaper', exact: true })).toBeVisible();
	const result = await qualifyNativePhotoPreviewSessionClose(page, cut), committed = cut === 'completed-ack' || cut === 'cleanup-ack';
	expect(result.schemaVersion).toBe(1); expect(result.cut).toBe(cut); expect(result.selectedDefaultProfile).toBe(true);
	expect(result.close.samePromise).toBe(true); expect(result.close.newWorkRefused).toBe(true);
	expect(result.close.resourceClosesWhileHeld).toBe(0);
	expect(result.close.fulfilled).toBe(cut !== 'cleanup-ack'); expect(result.close.cleanupFailureExact).toBe(cut === 'cleanup-ack');
	if (cut === 'after-write' || cut === 'after-close' || cut === 'cleanup-ack') expect(result.close.heldPending).toBe(true);
	else expect(result.close.heldPending).toBeNull();
	expect(result.native).toMatchObject({ writerOpens: 1, writeBytes: 16, operationId: 'media-asset-chunk-write', workerProof: true });
	expect(result.native.closeAcks).toBe(cut === 'after-write' ? 0 : 1);
	expect(result.transaction.complete).toBe(committed ? 1 : 0);
	expect(result.transaction.abort).toBe(cut === 'payload-put' || cut === 'inventory-put' ? 1 : 0);
	if (cut === 'payload-put' || cut === 'inventory-put') expect(result.transaction.putSuccesses).toContain(cut === 'payload-put' ? 'videoDerivatives' : 'videoDerivativeCacheEntries');
	if (committed) {
		expect(result.transaction.putSuccesses).toEqual(['videoDerivatives', 'videoDerivativeCacheEntries']);
		expect(result.afterCut).toMatchObject({ payload: 1, inventory: 1, pathPresent: true, pair: { storage: 'opfs', size: 16, recipeVersion: 1 } });
		expect(result.afterCut.bodySha256).toBe(result.afterCut.pair.outputSha256); expect(result.finalPair).toEqual(result.afterCut);
	} else expect(result.afterCut).toEqual({ payload: 0, inventory: 0, pair: null, pathPresent: false, bodySha256: null });
	expect(result.reopened).toEqual({ cache: committed ? 'hit' : 'stored', nativeWriterOpens: committed ? 0 : 1, originalReads: committed ? 0 : 1, literalPixelsExact: true });
	expect(result.finalPair).toMatchObject({ payload: 1, inventory: 1, pathPresent: true, pair: { storage: 'opfs', size: 16 } });
	expect(result.finalPair.bodySha256).toBe(result.finalPair.pair.outputSha256);
	expect(result.original).toMatchObject({ photoExact: true, metadataExact: true, custodyExact: true, bytesExact: true });
	expect(result.original.sha256).toMatch(/^[a-f0-9]{64}$/u); expect(result.oldPathAbsent).toBe(cut === 'cleanup-ack' ? true : null);
});
