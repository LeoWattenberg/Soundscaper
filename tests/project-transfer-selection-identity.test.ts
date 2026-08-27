/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * One row, one identity - and one refusal that stops one row.
 *
 * The sender page keys its checkboxes by `offer.projectId` and reads the ticked
 * set back as a set of those strings (`transfer-page-entry.ts`). Two defects
 * followed from that directly:
 *
 *   Every row the store listed without an id carried `projectId: ''`, so all of
 *   them shared one checkbox value. Ticking one ticked them all, and the
 *   confirmation panel then named projects the visitor had not chosen.
 *
 *   And a single such row refused the *whole* export run - handshake and
 *   download alike, ticked or not - because `selectProjectTransferProjects()`
 *   admits every listed row before it consults the caller's selection. One
 *   unaddressable project stopped every other project from crossing, on the last
 *   page a visitor sees before their work has to survive an origin move.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	describeTransferProduct,
	listTransferProjects,
	transferShadowedRowRefusal,
	TRANSFER_UNIDENTIFIED_ROW_REFUSAL,
	type TransferProjectOffer,
} from '../src/common/transfer/transfer-project-selection.ts';
import { createTransferStoreFederation } from '../src/common/transfer/transfer-store-federation.ts';

const store = (projects: readonly unknown[]): { listProjects(): readonly unknown[] } => ({
	listProjects: () => projects,
});

/** What the page does with the ticked set: `requireChosen()` in the page entry. */
function chosenFrom(
	offers: readonly TransferProjectOffer[],
	ticked: readonly string[],
): readonly string[] {
	const set = new Set(ticked);
	return offers.filter((offer) => set.has(offer.projectId)).map((offer) => offer.title);
}

test('every unidentified row gets an identity of its own', async () => {
	const listing = await listTransferProjects({
		store: store([
			{ title: 'Nameless one', schemaVersion: 31 },
			{ title: 'Nameless two', schemaVersion: 31 },
			{ id: 'video-1', title: 'Interview cut', schemaVersion: 31 },
		]),
		product: 'framescaper',
	});
	const keys = listing.map((offer) => offer.projectId);
	assert.equal(new Set(keys).size, keys.length, 'rows sharing one key are selected together');
	assert.equal(keys.filter((key) => key === '').length, 0, 'an empty key is a shared key');
	assert.deepEqual(listing.map((offer) => offer.storeProjectId), [null, null, 'video-1']);
	// Ticking one unidentified row selects that row and nothing else.
	assert.deepEqual(chosenFrom(listing, [keys[0]]), ['Nameless one']);
	assert.deepEqual(chosenFrom(listing, [keys[1]]), ['Nameless two']);
	assert.deepEqual(chosenFrom(listing, [keys[2]]), ['Interview cut']);
});

test('a generated key never collides with a real project id', async () => {
	// The generated key is derived from the store's own name, so a project whose
	// id happens to look like one must still be a row of its own.
	const listing = await listTransferProjects({
		store: store([
			{ id: 'origin-storage#1', title: 'Deliberate', schemaVersion: 31 },
			{ title: 'Nameless', schemaVersion: 31 },
		]),
		product: 'framescaper',
	});
	const keys = listing.map((offer) => offer.projectId);
	assert.equal(new Set(keys).size, 2);
	assert.deepEqual(chosenFrom(listing, [keys[1]]), ['Nameless']);
});

test('an unidentified row is offered, refused by name, and never preselected', async () => {
	const listing = await listTransferProjects({
		store: store([
			{ id: 'audio-1', title: 'Field recording', schemaVersion: 30 },
			{ title: 'Nameless', schemaVersion: 31 },
			{ id: 'video-1', title: 'Interview cut', schemaVersion: 31 },
		]),
		product: 'framescaper',
	});
	assert.deepEqual(listing.map((offer) => offer.title), ['Field recording', 'Nameless', 'Interview cut']);
	assert.deepEqual(listing.map((offer) => offer.refusal), [
		null,
		TRANSFER_UNIDENTIFIED_ROW_REFUSAL,
		null,
	]);
	assert.deepEqual(listing.map((offer) => offer.preselected), [false, false, true]);
	assert.equal(describeTransferProduct(listing[1]), TRANSFER_UNIDENTIFIED_ROW_REFUSAL);
	// The refusal says what now happens to it: it is left behind, and the rest go.
	assert.match(TRANSFER_UNIDENTIFIED_ROW_REFUSAL, /every other project still crosses/u);
});

test('the older of two copies sharing one id is offered, refused, and named', async () => {
	// A V27 project reimported into V28 keeps its identity. Sending both would
	// put two archives on the wire under one entry id, and the receiving origin
	// would take the second for a duplicate of the first.
	const newest = store([{ id: 'video-1', title: 'Interview cut', schemaVersion: 32 }]);
	const older = store([{ id: 'video-1', title: 'Interview cut (V27)', schemaVersion: 27 }]);
	const federation = createTransferStoreFederation({
		writer: newest,
		sources: [
			{ id: 'framescaper-v32', label: 'Framescaper V32 project storage', store: newest },
			{ id: 'framescaper-v27', label: 'Framescaper V27 project storage', store: older },
		],
	});
	const listing = await listTransferProjects({
		store: federation.store as Parameters<typeof listTransferProjects>[0]['store'],
		product: 'framescaper',
	});
	assert.deepEqual(listing.map((offer) => offer.title), ['Interview cut', 'Interview cut (V27)']);
	assert.deepEqual(listing.map((offer) => offer.storeId), ['framescaper-v32', 'framescaper-v27']);
	assert.deepEqual(listing.map((offer) => offer.refusal), [
		null,
		transferShadowedRowRefusal('Framescaper V32 project storage'),
	]);
	assert.deepEqual(listing.map((offer) => offer.preselected), [true, false]);
	assert.notEqual(listing[0].projectId, listing[1].projectId);
	// Only the newest is handed to the exporter; the older one is reported, not sent.
	const exported = await (federation.store as { listProjects(): Promise<readonly { id: string }[]> })
		.listProjects();
	assert.equal(exported.length, 1);
	await federation.close();
});

test('a store the page could not read is a row of its own, not a silence', async () => {
	const shared = store([{ id: 'audio-1', title: 'Field recording', schemaVersion: 30 }]);
	const federation = createTransferStoreFederation({
		writer: shared,
		sources: [{ id: 'shared-editor-storage', label: 'Shared editor storage', store: shared }],
		unreadable: [{
			storeId: 'framescaper-v31',
			storeLabel: 'Framescaper V31 project storage',
			reason: 'the database is corrupt',
		}],
	});
	const listing = await listTransferProjects({
		store: federation.store as Parameters<typeof listTransferProjects>[0]['store'],
		product: 'framescaper',
	});
	assert.deepEqual(listing.map((offer) => offer.kind), ['project', 'store']);
	assert.equal(listing[1].title, 'Framescaper V31 project storage');
	assert.match(listing[1].refusal ?? '', /could not be read.*the database is corrupt/u);
	assert.equal(listing[1].preselected, false);
	assert.notEqual(listing[0].projectId, listing[1].projectId);
	await federation.close();
});

test('an offer says which of this origin\'s stores holds it', async () => {
	const v31 = store([{ id: 'video-1', title: 'Interview cut', schemaVersion: 31 }]);
	const federation = createTransferStoreFederation({
		writer: v31,
		sources: [{ id: 'framescaper-v31', label: 'Framescaper V31 project storage', store: v31 }],
	});
	const listing = await listTransferProjects({
		store: federation.store as Parameters<typeof listTransferProjects>[0]['store'],
		product: 'framescaper',
	});
	assert.equal(listing[0].storeLabel, 'Framescaper V31 project storage');
	assert.equal(
		describeTransferProduct(listing[0]),
		'Framescaper project, in Framescaper V31 project storage',
	);
	await federation.close();
});
