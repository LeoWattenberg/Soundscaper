/* SPDX-License-Identifier: AGPL-3.0-only */

import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { expect, test } from './helpers/browser-coverage-fixture.js';

// This routed native qualification entry contains test-only executable code.
test.use({ browserCoverage: false });
const MODULE = '/__lightscaper_library_restore.js';
const ENTRY = new URL('../helpers/lightscaper-library-restore-native-fixture.ts', import.meta.url);

test('native archive3 restore installs exact original bodies, grouping and full saved queries in authenticated namespaces', async ({ page }) => {
	const result = await qualify(page, 'preservation');
	expect(result).toMatchObject({ archivedDocumentsExact: true, originalBytesExact: true, originalShaExact: true,
		ownerMarkersExact: true, membershipRowsExact: true, selectedSessionReopened: true, savedOrdinaryAndCollapsedExact: true,
		photoRevisions: [11, 19], rootRevision: 37, stackRevision: 23, savedRevision: 29, savedStateRevision: 41,
		chunks: [2, 1], previousPointerPreserved: true, selectedNamespaces: 2,
		receipt: { photoCount: 2, stackCount: 1, savedCollectionCount: 1, originalCount: 2, notices: [] },
		inventory: { catalogs: 1, catalogStates: 1, photos: 2, summaries: 2, memberships: 12,
			photoQueryRows: 2, photoQueryBuildStates: 1, photoQueryRowsV2: 2, photoQueryBuildStatesV2: 1,
			photoStacks: 1, photoStackMemberships: 2, photoStackStates: 1, photoSmartCollections: 1,
			photoSmartCollectionSummaries: 1, photoSmartCollectionStates: 1, photoCatalogRestoreOwners: 1 } });
	expect(result.mediaOriginalByteLength).toBeGreaterThan(4 * 1024 * 1024);
	expect(result.receipt.originalByteLength).toBe(result.mediaOriginalByteLength);
	expect(result.tokens[0]).not.toBe(result.tokens[1]);
	expect(result.catalogFingerprint).toMatch(/^[a-f0-9]{64}$/u);
});

test('authenticated corrupt archived original refuses publication and reopens the untouched previous library', async ({ page }) => {
	expect(await qualify(page, 'corruption')).toEqual({ corruptOriginalRefused: true, previousPointerUnchanged: true,
		permanentHistoryUnchanged: true, oldLibraryExact: true, reopenedOldLibrary: true, candidateNamespacesCleaned: true });
});

test('native original cancellation joins candidate cleanup and a completed pointer publication keeps its ACK', async ({ page }) => {
	const result = await qualify(page, 'cancellation');
	expect(result).toMatchObject({ exactCancellation: true, oldLibraryUnchanged: true, cancelledCandidateDeleted: true,
		lateAborted: true, publicationAcknowledged: true, distinctReplacementNamespace: true, previousCommitPreserved: true });
	expect(result.nativeOriginalDeliveries).toBeGreaterThan(0);
});

async function qualify(page, mode) {
	const diagnostics = [];
	page.on('console', message => { if (message.type() === 'error') diagnostics.push(message.text()); });
	page.on('requestfailed', request => { if (request.url().includes('__lightscaper_library_restore')) diagnostics.push(request.failure()?.errorText); });
	const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('.', ENTRY)), contents:
		`export { qualifyNativeLibraryRestoreV1 } from ${JSON.stringify(fileURLToPath(ENTRY))};` },
		bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent' });
	const headers = { 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' };
	await page.context().route(`**${MODULE}`, route => route.fulfill({ contentType: 'text/javascript', headers, body: bundle.outputFiles[0].text }));
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS
		? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/en/`); await expect(page.locator('[data-lightscaper-bound="true"]')).toBeVisible();
	try { return await page.evaluate(async ({ path, mode }) => (await import(new URL(path, location.href).href))
		.qualifyNativeLibraryRestoreV1(mode), { path: MODULE, mode }); }
	catch (error) { throw new Error(`Native library restore qualification failed: ${diagnostics.join('\n')}`, { cause: error }); }
}
