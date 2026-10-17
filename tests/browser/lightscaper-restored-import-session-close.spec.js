/* SPDX-License-Identifier: AGPL-3.0-only */

import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { expect, installNativeImageHandoffRuntime, qualifyNativePhotoRestoredImportSessionClose, test } from './helpers/lightscaper-image-handoff-native-fixture.js';

const PHASES = ['intent', 'original', 'stage', 'publish', 'promote', 'retire'];
const CUTS = ['mutation-success', 'completed-ack'];
const MUTATIONS = { intent: 'settings.put', original: 'mediaAssets.add', stage: 'catalogOriginalRoots.put',
	publish: 'photos.put', promote: 'catalogOriginalRoots.put', retire: 'settings.delete' };
// Digest of the distinct encoded 2×3 PNG, independent of production hashing.
const CURRENT_SHA256 = 'fdfe0f7d2f827ae8200625a0d5f4c21ee47a2e037b6f6a22fcd36c5012e5614c';
const PRIOR_SHA256 = '6b7133bd00dcce5a18b890560894cb0524df4047c04d1d7fd9a64d2a12d2689b';
// Independent durable ledger: body, Photo, staged custody, retained custody, intent.
const LEDGERS = {
	intent: [[false, false, false, false, true], [false, false, false, false, true]],
	original: [[true, false, false, false, true], [true, false, false, false, true]],
	stage: [[true, false, false, false, true], [true, false, true, false, true]],
	publish: [[true, false, true, false, true], [true, true, true, false, true]],
	promote: [[true, true, true, false, true], [true, true, false, true, true]],
	retire: [[true, true, false, true, false], [true, true, false, true, false]],
};
const ledger = values => Object.fromEntries(['body', 'photo', 'staged', 'retained', 'journal'].map((key, index) => [key, values[index]]));

for (const phase of PHASES) for (const boundary of CUTS) {
	const cut = `${phase}-${boundary}`;
	test(`restored import Session.close at ${cut} preserves actual publication and recovery`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'Restored-library native qualification is maintained for Chromium and Firefox.');
		await installNativeImageHandoffRuntime(page);
		const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
		await page.goto(`${origin}/?lang=en`);
		await expect(page.getByRole('region', { name: 'Lightscaper', exact: true })).toBeVisible();
		const result = await qualifyNativePhotoRestoredImportSessionClose(page, cut);
		const expected = ledger(LEDGERS[phase][CUTS.indexOf(boundary)]);
		const aborted = boundary === 'mutation-success' && ['stage', 'publish', 'promote'].includes(phase);
		const fulfilled = phase === 'retire';
		expect(result.schemaVersion).toBe(1); expect(result.cut).toBe(cut); expect(result.selectedRestoredProfile).toBe(true);
		expect(result.allocation).toMatchObject({ committedPointer: true, namespaceToken: expect.any(String),
			catalogDatabaseName: expect.any(String), mediaDatabaseName: expect.any(String) });
		expect(result.allocation.namespaceToken.length).toBeGreaterThan(0);
		expect(result.allocation.catalogDatabaseName).not.toBe(result.allocation.mediaDatabaseName);
		expect(result.close).toEqual({ samePromise: true, newWorkRefused: true, heldPending: true, fulfilled: true,
			resourceClosesWhileHeld: 0, resourceClosesBeforeTerminal: 0, selectedResourceClosesAfterRelease: { catalog: 1, media: 1 } });
		expect(result.transaction).toMatchObject({ phase, complete: aborted ? 0 : 1, abort: aborted ? 1 : 0, terminalBeforeResources: true });
		expect(result.transaction.mutationSuccesses).toEqual([MUTATIONS[phase]]);
		expect(result.import).toMatchObject({ fulfilled, receiptCount: fulfilled ? 1 : 0, importedReceiptCount: fulfilled ? 1 : 0,
			acknowledgedCount: expected.photo ? 1 : 0 });
		expect(result.import.acknowledgedPhotoId).toEqual(expected.photo ? expect.any(String) : null);
		expect(result.import.returnedPhotoId).toEqual(fulfilled ? result.import.acknowledgedPhotoId : null);
		expect(result.afterCut).toEqual(expected);
		expect(result.recovered).toEqual({ ...expected, staged: false, retained: expected.photo, journal: false });
		expect(result.reopened).toEqual({ idempotent: true, pagePhotoCount: expected.photo ? 2 : 1 });
		expect(result.original).toMatchObject({ photoExact: true, metadataExact: true, recordExact: true,
			contentTokenExact: true, custodyExact: true, bytesExact: true });
		expect(result.original.sha256).toBe(PRIOR_SHA256);
		expect(result.donor).toEqual({ catalogExact: true, photoExact: true, originalMetadataExact: true,
			originalRecordExact: true, custodyExact: true, bytesExact: true, cacheExact: true });
		expect(result.resources).toEqual({ developPresetExact: true, disabledLutBodyExact: true, disabledLutReferenceExact: true });
		expect(result.current).toMatchObject({ storage: expected.body ? 'indexeddb-blob' : null, path: null,
			photoSchemaVersion: expected.photo ? 2 : null, processVersion: expected.photo ? 2 : null,
			photoAndRecipeExact: true, metadataOptionsExact: true, bytesExact: true, custodyExact: true });
		expect(result.current.contentToken).toEqual(expected.body ? expect.any(String) : null);
		expect(result.current.bodySha256).toBe(expected.body ? CURRENT_SHA256 : null);
		expect(result.allocatedOriginalNativeWriterOpens).toBe(0);
	});
}
