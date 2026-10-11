/* SPDX-License-Identifier: AGPL-3.0-only */

import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { expect, installNativeImageHandoffRuntime, qualifyNativePhotoDefaultImportSessionClose, test } from './helpers/lightscaper-image-handoff-native-fixture.js';

const PHASES = ['intent', 'original', 'stage', 'publish', 'promote', 'retire'];
const BOUNDARIES = ['mutation-success', 'completed-ack'];
const CUTS = ['writer-open-ack', 'writer-write-ack', 'writer-close-ack', ...PHASES.flatMap(phase => BOUNDARIES.map(boundary => `${phase}-${boundary}`))];
const MUTATIONS = { intent: 'settings.put', original: 'mediaAssets.add', stage: 'catalogOriginalRoots.put',
	publish: 'photos.put', promote: 'catalogOriginalRoots.put', retire: 'settings.delete' };
// Literal encoded originals; these digests do not use production hash helpers.
const CURRENT_SHA256 = 'fdfe0f7d2f827ae8200625a0d5f4c21ee47a2e037b6f6a22fcd36c5012e5614c';
const PRIOR_SHA256 = '6b7133bd00dcce5a18b890560894cb0524df4047c04d1d7fd9a64d2a12d2689b';
// Independent durable ledger: original metadata/body, Photo, staged/permanent custody, intent.
const LEDGERS = {
	intent: [[false, false, false, false, true], [false, false, false, false, true]],
	original: [[true, false, false, false, true], [true, false, false, false, true]],
	stage: [[true, false, false, false, true], [true, false, true, false, true]],
	publish: [[true, false, true, false, true], [true, true, true, false, true]],
	promote: [[true, true, true, false, true], [true, true, false, true, true]],
	retire: [[true, true, false, true, false], [true, true, false, true, false]],
};
const ledger = values => Object.fromEntries(['body', 'photo', 'staged', 'retained', 'journal'].map((key, index) => [key, values[index]]));

for (const cut of CUTS) test(`default import Session.close at ${cut} joins native OPFS and recovers actual publication`, async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'Default-library native qualification is maintained for Chromium and Firefox.');
	await installNativeImageHandoffRuntime(page);
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/?lang=en`);
	await expect(page.getByRole('region', { name: 'Lightscaper', exact: true })).toBeVisible();
	const result = await qualifyNativePhotoDefaultImportSessionClose(page, cut);
	const writer = cut.startsWith('writer-'), phase = writer ? null : PHASES.find(value => cut.startsWith(`${value}-`));
	const boundary = writer ? null : BOUNDARIES.find(value => cut.endsWith(value));
	const expected = ledger(writer ? LEDGERS.intent[0] : LEDGERS[phase][BOUNDARIES.indexOf(boundary)]);
	const aborted = boundary === 'mutation-success' && ['stage', 'publish', 'promote'].includes(phase), fulfilled = phase === 'retire';
	const opened = writer || phase !== 'intent', written = opened && cut !== 'writer-open-ack', closed = written && cut !== 'writer-write-ack';
	expect(result.schemaVersion).toBe(1); expect(result.cut).toBe(cut); expect(result.selectedDefaultProfile).toBe(true);
	expect(result.selection).toMatchObject({ pointerSchemaVersion: 1, allocationNull: true, pointerExact: true,
		catalogId: expect.any(String), catalogDatabaseName: expect.any(String), mediaDatabaseName: expect.any(String) });
	expect(result.selection.catalogDatabaseName).not.toBe(result.selection.mediaDatabaseName);
	expect(result.close).toEqual({ samePromise: true, newWorkRefused: true, heldPending: true, fulfilled: true,
		resourceClosesWhileHeld: 0, resourceClosesBeforeTerminal: 0, selectedResourceClosesAfterRelease: { catalog: 1, media: 1 } });
	expect(result.transaction).toEqual({ phase, mutationSuccesses: writer ? [] : [MUTATIONS[phase]],
		complete: writer ? 0 : aborted ? 0 : 1, abort: aborted ? 1 : 0, terminalBeforeResources: true });
	expect(result.native).toMatchObject({ operationId: 'media-asset-chunk-write', writerOpens: opened ? 1 : 0,
		writeBytes: written ? 85 : 0, writeAcks: written ? 1 : 0, closeAcks: closed ? 1 : 0,
		abortAcks: writer && !closed ? 1 : 0, removeAcks: writer ? 1 : 0, workerProof: true });
	expect(result.import).toMatchObject({ fulfilled, receiptCount: fulfilled ? 1 : 0, importedReceiptCount: fulfilled ? 1 : 0,
		acknowledgedCount: expected.photo ? 1 : 0 });
	expect(result.import.acknowledgedPhotoId).toEqual(expected.photo ? expect.any(String) : null);
	expect(result.import.returnedPhotoId).toEqual(fulfilled ? result.import.acknowledgedPhotoId : null);
	expect(result.afterCut).toEqual(expected);
	expect(result.recovered).toEqual({ ...expected, staged: false, retained: expected.photo, journal: false });
	expect(result.file.path).toEqual(opened ? expect.any(String) : null);
	if (opened) expect(result.file.path).toMatch(/\.blob$/u);
	const file = { present: expected.body, sha256: expected.body ? CURRENT_SHA256 : null, byteLength: expected.body ? 85 : null };
	expect(result.file.afterCut).toEqual(file); expect(result.file.recovered).toEqual(file);
	expect(result.file.ownerRemoved).toBe(opened && !expected.body);
	expect(result.reopened).toEqual({ idempotent: true, pagePhotoCount: expected.photo ? 2 : 1 });
	expect(result.original).toEqual({ photoExact: true, metadataExact: true, recordExact: true,
		contentTokenExact: true, custodyExact: true, bytesExact: true, sha256: PRIOR_SHA256 });
	expect(result.resources).toEqual({ developPresetExact: true, disabledLutBodyExact: true, disabledLutReferenceExact: true });
	expect(result.projections).toEqual({ summariesExact: true, queryRowsExact: true, membershipsExact: true, buildStatesExact: true, expectedRevisionDeltas: true });
	expect(result.current).toMatchObject({ storage: expected.body ? 'opfs' : null, path: expected.body ? result.file.path : null,
		photoSchemaVersion: expected.photo ? 2 : null, processVersion: expected.photo ? 2 : null,
		photoAndRecipeExact: true, metadataOptionsExact: true, bytesExact: true, custodyExact: true });
	expect(result.current.contentToken).toEqual(expected.body ? expect.any(String) : null);
	expect(result.current.bodySha256).toBe(expected.body ? CURRENT_SHA256 : null);
});
