/* SPDX-License-Identifier: AGPL-3.0-only */

import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { expect, test } from './helpers/browser-coverage-fixture.js';

// The routed native qualification entry is test-only executable code.
test.use({ browserCoverage: false });

const MODULE = '/__lightscaper_saved_query_execution.js';
const ENTRY = new URL('../helpers/lightscaper-saved-query-native-fixture.ts', import.meta.url);

test('native saved full Query2 preserves live text and compound metadata through sparse and capture-bucket pages', async ({ page }) => {
	const report = await qualify(page, 'ordinary');
	expect(report).toMatchObject({ forbiddenRequests: 0, activeTransactions: 0, result: {
		fullCriteriaPreserved: true, liveKeywordRenameRemovedMatches: true, sparseFirstPagesEmpty: true,
		knownBeforeUnknownBothDirections: true, clocksOrderedBothDirections: true, unionReadonly: true, storesUnchanged: true,
	} });
	expect(report.result.fullIds).toEqual(Array.from({ length: 130 }, (_, index) => index)
		.filter(index => index % 2 === 0 && index % 6 >= 2).map(photoId));
	expect(report.result.sparseIds).toEqual([photoId(129)]);
	assertBounds(report.result);
});

test('native saved authority and distinct-connection MAC refuse stale or corrupt definitions before Row2', async ({ page }) => {
	const report = await qualify(page, 'authority');
	expect(report).toMatchObject({ forbiddenRequests: 0, activeTransactions: 0, result: {
		distinctNativeConnections: true, ordinaryForeignTransactions: 0, collapsedForeignTransactions: 0,
		ordinaryForeignRefused: true, collapsedForeignRefused: true, allRefusalsBeforeRows: true, storesUnchanged: true,
	} });
	expect(report.result.refusals).toEqual(['edited', 'recreated', 'same-revision-query', 'summary', 'hidden-reference', 'orphan']);
});

test('native saved collapsed pages authenticate130 members before cover output and reject counterfeit pending or late member loss', async ({ page }) => {
	const report = await qualify(page, 'collapsed');
	expect(report).toMatchObject({ forbiddenRequests: 0, activeTransactions: 0, result: {
		first: { items: 0, scanned: 64, pending: true }, eligibleIds: [photoId(0)],
		counterfeitTransactions: 0, counterfeitRefused: true, laterMemberRefused: true, storesUnchanged: true,
	} });
	expect(report.result.fallbackIds).toEqual([photoId(0)]);
	expect(report.result.authenticatedMembers).toBe(130);
	expect(report.result.steps).toBeGreaterThanOrEqual(3);
	assertBounds(report.result);
});

test('native saved65-stack key audit resumes before any representative or Row2 delivery', async ({ page }) => {
	const report = await qualify(page, 'audit');
	expect(report).toMatchObject({ forbiddenRequests: 0, activeTransactions: 0, result: {
		first: { items: 0, scanned: 64, auditCount: 64, rowRequests: 0, rowDeliveries: 0 }, storesUnchanged: true,
	} });
	expect(report.result.ids).toEqual(Array.from({ length: 65 }, (_, index) => photoId(index * 2)));
	assertBounds(report.result);
});

test('native saved read cancellation joins opaque reasons and large legal roots and recipes execute intact', async ({ page }) => {
	const report = await qualify(page, 'lifetime');
	expect(report).toMatchObject({ forbiddenRequests: 0, activeTransactions: 0, result: {
		cancellations: 8, exactReasons: true, reasonInspections: 0, signalShadowsRead: 0,
		postCompleteRejected: true, storesUnchanged: true, large: { items: 0, intact: true, unionReadonly: true },
	} });
	expect(report.result.large.rootBytes).toBe(2_097_152);
	expect(report.result.large.definitionBytes).toBeGreaterThan(400_000);
	expect(report.result.large.definitionBytes).toBeLessThanOrEqual(528_384);
	expect(report.result.large.privateRowBytes).toBeLessThanOrEqual(603_424);
	// Serialized compiler input; compiled closures and folded needles have their own owning bounds.
	expect(report.result.large.predicateSourceBytes).toBeLessThanOrEqual(524_288);
});

function photoId(index) { return `photo-${String(index).padStart(6, '0')}`; }
function assertBounds(result) {
	expect(result.maximumScanned).toBeLessThanOrEqual(64);
	expect(result.maximumRowWorkAndAuditKeys).toBeLessThanOrEqual(64);
	expect(result.maximumItems).toBeLessThanOrEqual(64);
	expect(result.maximumSummaryBytes).toBeLessThanOrEqual(4096);
	expect(result.maximumContinuationBytes).toBeLessThanOrEqual(4096);
	expect(result.maximumEmptySeeks).toBeLessThanOrEqual(2);
}

async function qualify(page, mode) {
	test.setTimeout(180_000);
	const bundle = await build({ entryPoints: [fileURLToPath(ENTRY)], bundle: true, write: false,
		format: 'esm', platform: 'browser', logLevel: 'silent' });
	await page.route(`**${MODULE}`, route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }));
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/en/`); await expect(page.locator('[data-lightscaper-bound="true"]')).toBeVisible();
	return page.evaluate(async ({ path, mode }) => (await import(new URL(path, location.href).href)).qualifyNativeSavedQueryExecutionV1(mode), { path: MODULE, mode });
}
