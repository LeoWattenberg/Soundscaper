/* SPDX-License-Identifier: AGPL-3.0-only */

import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { expect, test } from './helpers/browser-coverage-fixture.js';

// This routed native qualification bundle is test-only executable code.
test.use({ browserCoverage: false });

const MODULE = '/__lightscaper_smart_collections.js';
const ENTRY = new URL('../helpers/lightscaper-smart-collections-native-fixture.ts', import.meta.url);

test('native DB4 to5 adds saved-query stores without reading or changing existing records', async ({ page }) => {
	const result = await qualify(page, 'migration');
	expect(result).toMatchObject({ forbiddenRequests: 0, activeTransactions: 0, result: { oldVersion: 4, version: 5,
		upgradeRequests: 0, legacyTransactionsBeforeUpgrade: 0, unchanged: true, noDurableState: true,
		emptyState: { revision: 0, collectionCount: 0 }, persisted: { revision: 0, collectionCount: 0 } } });
	const { oldInventory, newInventory } = result.result;
	expect(newInventory).toHaveLength(15);
	expect(oldInventory).toEqual(newInventory.filter(value => !['photoSmartCollections', 'photoSmartCollectionSummaries', 'photoSmartCollectionStates'].includes(value.name)));
	expect(newInventory.find(value => value.name === 'photoSmartCollections')).toEqual({ name: 'photoSmartCollections', keyPath: 'key', indexes: [
		{ name: 'catalogId', keyPath: 'catalogId', multiEntry: false, unique: false },
		{ name: 'referenceKey', keyPath: 'referenceKeys', multiEntry: true, unique: false },
	] });
	expect(newInventory.find(value => value.name === 'photoSmartCollectionSummaries')).toEqual({ name: 'photoSmartCollectionSummaries', keyPath: 'key',
		indexes: [{ name: 'catalogId', keyPath: 'catalogId', multiEntry: false, unique: false }] });
	expect(newInventory.find(value => value.name === 'photoSmartCollectionStates')).toEqual({ name: 'photoSmartCollectionStates', keyPath: 'catalogId', indexes: [] });
});

test('native scalar saved-query paging and full-load preserve complete criteria and refuse broken hierarchy authority', async ({ page }) => {
	const result = await qualify(page, 'paging');
	expect(result).toMatchObject({ forbiddenRequests: 0, activeTransactions: 0, result: { total: 66,
		firstSize: 64, secondSize: 2, finished: true, fullQueryReads: 0, fullLoadReads: 1, exactQuery: true,
		missingFolderRefused: true, falseBranchRefused: true, laterIdRefused: true, negativeIndex: true,
		corruptProjectionRefused: true, unchangedRoot: true, bodyUnchanged: true } });
	expect(result.result.ids).toEqual([...Array.from({ length: 65 }, (_, index) => `saved-${String(index).padStart(3, '0')}`), 'saved-maximum']);
	expect(result.result.maximumSummaryRows).toBeLessThanOrEqual(64);
	expect(result.result.maximumSummaryBytes).toBeLessThanOrEqual(262_144);
	expect(result.result.maximalBytes).toBeGreaterThan(400_000);
	expect(result.result.maximalBytes).toBeLessThanOrEqual(603_424);
});

test('native saved-query cancellation rolls back every store and a late abort preserves durable acknowledgement and tombstone revision', async ({ page }) => {
	const result = await qualify(page, 'cancellation');
	expect(result).toMatchObject({ forbiddenRequests: 0, activeTransactions: 0, result: { exactReason: true, reasonInspections: 0,
		rolledBack: true, empty: { revision: 0, collectionCount: 0 }, lateAborted: true, acknowledged: true,
		receipt: { catalogRevision: 1, indexRevision: 1, state: { revision: 1, collectionCount: 1 }, definition: { id: 'acknowledged', revision: 0 } },
		deleted: { catalogRevision: 2, indexRevision: 2, state: { revision: 2, collectionCount: 0 }, definition: null },
		tombstone: { revision: 2, collectionCount: 0 }, staleRefused: true } });
	expect(result.result.successfulPuts).toBe(5);
});

test('native canonical audit bounds maximal saved-query source pages while allowing a legal large-root edit', async ({ page }) => {
	const result = await qualify(page, 'capacity');
	expect(result).toMatchObject({ forbiddenRequests: 0, activeTransactions: 0, result: { savedRevision: 1,
		savedState: { revision: 1, collectionCount: 12 } } });
	expect(result.result.rootBytes).toBeGreaterThan(1_800_000);
	expect(result.result.rootBytes).toBeLessThanOrEqual(2_097_152);
	expect(result.result.definitionBytes).toBeGreaterThan(400_000);
	expect(result.result.pageCount).toBeGreaterThanOrEqual(2);
	expect(result.result.maximumDefinitions).toBeLessThan(10);
	expect(result.result.maximumChargedBytes).toBeLessThanOrEqual(8_388_608);
	expect(result.result.maximumKeyDeliveries).toBeLessThanOrEqual(64);
});

async function qualify(page, mode) {
	test.setTimeout(180_000);
	const bundle = await build({ entryPoints: [fileURLToPath(ENTRY)], bundle: true, write: false,
		format: 'esm', platform: 'browser', external: ['module'] });
	await page.route(`**${MODULE}`, route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }));
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/en/`); await expect(page.locator('[data-lightscaper-bound="true"]')).toBeVisible();
	return page.evaluate(async ({ path, mode }) => (await import(new URL(path, location.href).href)).qualifyNativeSmartCollectionsV1(mode), { path: MODULE, mode });
}
