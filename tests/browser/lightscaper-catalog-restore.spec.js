/* SPDX-License-Identifier: AGPL-3.0-only */

import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { expect, test } from './helpers/browser-coverage-fixture.js';

// The routed catalog qualification entry is test-only executable code.
test.use({ browserCoverage: false });
const MODULE = '/__lightscaper_catalog_restore.js';
const ENTRY = new URL('../helpers/lightscaper-catalog-restore-native-fixture.ts', import.meta.url);
const MAXIMUM = Number.MAX_SAFE_INTEGER;

test('native restore candidate preserves archived revisions, ordered stacks and exact saved-state presence', async ({ page }) => {
	const report = await qualify(page, 'preservation');
	expect(report.result).toMatchObject({
		ready: { catalogId: 'catalog', catalogRevision: MAXIMUM, photoCount: 66, stackCount: 1,
			savedCollectionCount: 1, indexRevision: 0 },
		rootUnchanged: true, firstPhotoExact: true, lastPhotoExact: true, stackExact: true, fullSavedExact: true,
		savedState: { revision: MAXIMUM, collectionCount: 1 },
		index: { rootRevision: MAXIMUM, indexRevision: 0, photoCount: 66 },
		stackState: { revision: 0, stackCount: 1 }, queryReady: { schemaVersion: 2, ready: true, indexedCount: 66, afterKey: null },
		legacyReady: { schemaVersion: 1, ready: true, indexedCount: 66, afterKey: null },
		absentSavedState: true, zeroSavedState: { revision: 0, collectionCount: 0 },
		tombstoneSavedState: { revision: MAXIMUM, collectionCount: 0 },
		rich: { exact: true, legacy: { ready: false, indexedCount: 0 }, current: { ready: true, indexedCount: 1 } },
	});
	expect(report.result.rich.sourceBytes).toBeGreaterThan(524_288);
});

test('native restore collision leaves the complete existing database unchanged', async ({ page }) => {
	const report = await qualify(page, 'collision');
	expect(report.result).toEqual({ collisionRefused: true, existingUnchanged: true, version: 5 });
});

test('native restore final audit binds delivery and refuses coherent rewrites and foreign rows beyond64 photos', async ({ page }) => {
	const report = await qualify(page, 'corruption');
	expect(report.result).toEqual({ refusals: ['projection', 'coherent-photo', 'saved-query', 'foreign-row'], auditDidNotRepair: true });
});

test('native restore lifetime refuses overlap, joins cancelled audit and preserves completed readiness acknowledgement', async ({ page }) => {
	const report = await qualify(page, 'cancellation');
	expect(report.result).toEqual({ overlapRefused: true, overlapSourceReads: 0, exactCancellation: true, cancelledJoined: true,
		cancellationUnchanged: true, candidateRollbackDeleted: true,
		lateAborted: true, readinessAcknowledged: true, readyRevision: MAXIMUM });
});

async function qualify(page, mode) {
	test.setTimeout(180_000);
	const bundle = await build({ entryPoints: [fileURLToPath(ENTRY)], bundle: true, write: false,
		format: 'esm', platform: 'browser', logLevel: 'silent' });
	await page.route(`**${MODULE}`, route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }));
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS
		? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/en/`); await expect(page.locator('[data-lightscaper-bound="true"]')).toBeVisible();
	const report = await page.evaluate(async ({ path, mode }) => (await import(new URL(path, location.href).href))
		.qualifyNativeCatalogRestoreV1(mode), { path: MODULE, mode });
	expect(report).toMatchObject({ activeTransactions: 0, forbiddenRequests: 0 });
	expect(report.maximumKeyDeliveries).toBeLessThanOrEqual(64);
	expect(report.maximumCountRequests).toBeLessThanOrEqual(15);
	return report;
}
