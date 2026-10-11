/* SPDX-License-Identifier: AGPL-3.0-only */

import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { expect, installNativeImageHandoffRuntime, qualifyNativePhotoRestoredPreviewSessionClose, test } from './helpers/lightscaper-image-handoff-native-fixture.js';

const CUTS = ['payload-put', 'inventory-put', 'completed-ack'];
// SHA-256 of four literal opaque [255, 32, 0, 255] pixels, independent of the cache.
const EXPECTED_BODY_SHA256 = 'b8f1638431ea8612d0d6bf74c10b554715f1b4e1edd01ff5760e22af61564fae';

for (const cut of CUTS) test(`restored preview Session.close at ${cut} preserves paired publication and original custody`, async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'Restored-library native qualification is maintained for Chromium and Firefox.');
	await installNativeImageHandoffRuntime(page);
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/?lang=en`);
	await expect(page.getByRole('region', { name: 'Lightscaper', exact: true })).toBeVisible();
	const result = await qualifyNativePhotoRestoredPreviewSessionClose(page, cut), committed = cut === 'completed-ack';
	expect(result.schemaVersion).toBe(1); expect(result.cut).toBe(cut); expect(result.selectedRestoredProfile).toBe(true);
	expect(result.allocation.committedPointer).toBe(true);
	expect(result.allocation.namespaceToken).toEqual(expect.any(String)); expect(result.allocation.namespaceToken.length).toBeGreaterThan(0);
	expect(result.allocation.catalogDatabaseName).toEqual(expect.any(String));
	expect(result.allocation.mediaDatabaseName).toEqual(expect.any(String));
	expect(result.allocation.catalogDatabaseName).not.toBe(result.allocation.mediaDatabaseName);
	expect(result.close).toMatchObject({ samePromise: true, newWorkRefused: true, fulfilled: true,
		subscriberExactCancellation: true, heldPending: true, resourceClosesWhileHeld: 0, resourceClosesBeforeTerminal: 0,
		selectedResourceClosesAfterRelease: { catalog: 1, media: 1 } });
	expect(result.transaction.complete).toBe(committed ? 1 : 0);
	expect(result.transaction.abort).toBe(committed ? 0 : 1);
	expect(result.transaction.terminalBeforeResources).toBe(true);
	if (committed) {
		expect(result.transaction.putSuccesses).toEqual(['videoDerivatives', 'videoDerivativeCacheEntries']);
		expect(result.afterCut).toMatchObject({ payload: 1, inventory: 1, bodySha256: EXPECTED_BODY_SHA256,
			pair: { storage: 'indexeddb-blob', path: null, size: 16, recipeVersion: 1, outputSha256: EXPECTED_BODY_SHA256 } });
		expect(result.finalPair).toEqual(result.afterCut);
	} else {
		expect(result.transaction.putSuccesses).toContain(cut === 'payload-put' ? 'videoDerivatives' : 'videoDerivativeCacheEntries');
		expect(result.afterCut).toEqual({ payload: 0, inventory: 0, pair: null, bodySha256: null });
	}
	expect(result.reopened).toEqual({ cache: committed ? 'hit' : 'stored', originalReads: committed ? 0 : 1, literalPixelsExact: true });
	expect(result.finalPair).toMatchObject({ payload: 1, inventory: 1, bodySha256: EXPECTED_BODY_SHA256,
		pair: { storage: 'indexeddb-blob', path: null, size: 16, outputSha256: EXPECTED_BODY_SHA256 } });
	expect(result.original).toMatchObject({ photoExact: true, metadataExact: true, recordExact: true,
		contentTokenExact: true, custodyExact: true, bytesExact: true });
	expect(result.original.sha256).toMatch(/^[a-f0-9]{64}$/u);
	expect(result.donor).toEqual({ catalogExact: true, photoExact: true, originalMetadataExact: true,
		originalRecordExact: true, custodyExact: true, bytesExact: true, cacheExact: true });
	expect(result.previewNativeWriterOpens).toBe(0);
});
