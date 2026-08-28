/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * What the sender page is allowed to offer, and what it must not hide.
 *
 * The selection module is the only thing standing between "the projects you
 * ticked" and "everything this origin stores", so its listing has to be a
 * faithful account of the store: a row it drops is a project the visitor never
 * learns about, and this page exists precisely because the visitor is about to
 * leave this origin's storage behind.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { selectProjectTransferProjects } from '../src/common/transfer/project-transfer-bundle-admission.ts';
import {
	describeTransferProduct,
	listTransferProjects,
	TRANSFER_UNIDENTIFIED_ROW_REFUSAL,
} from '../src/common/transfer/transfer-project-selection.ts';

const store = (projects: readonly unknown[]): { listProjects(): readonly unknown[] } => ({
	listProjects: () => projects,
});

test('a listing row with no id is offered, not silently dropped', async () => {
	const listing = await listTransferProjects({
		store: store([
			{ id: 'audio-1', title: 'Field recording', schemaFamily: 'soundscaper', schemaVersion: 1 },
			{ title: 'Nameless', schemaFamily: 'framescaper', schemaVersion: 1 },
			{ id: 'video-1', title: 'Interview cut', schemaFamily: 'framescaper', schemaVersion: 1 },
		]),
		product: 'framescaper',
	});
	assert.deepEqual(listing.map((offer) => offer.title), ['Field recording', 'Nameless', 'Interview cut']);
	assert.deepEqual(listing.map((offer) => offer.refusal), [
		null,
		TRANSFER_UNIDENTIFIED_ROW_REFUSAL,
		null,
	]);
	// It carries no id to be addressed by, and it is never ticked for the
	// visitor even though its schema is the peer product's. It still gets a
	// selection key of its own: rows that shared the empty string were ticked
	// and unticked together, and the page keys its checkboxes by this string.
	assert.equal(listing[1].storeProjectId, null);
	assert.notEqual(listing[1].projectId, '');
	assert.equal(new Set(listing.map((offer) => offer.projectId)).size, listing.length);
	assert.equal(listing[1].product, 'framescaper');
	assert.deepEqual(listing.map((offer) => offer.preselected), [false, false, true]);
	assert.equal(describeTransferProduct(listing[1]), TRANSFER_UNIDENTIFIED_ROW_REFUSAL);
});

test('a malformed numeric-only row keeps a label without inferring a product', async () => {
	const listing = await listTransferProjects({ store: store([{ schemaVersion: 999 }]), product: null });
	assert.equal(listing.length, 1);
	assert.equal(listing[0].title, 'Untitled project');
	assert.equal(listing[0].schemaVersion, null);
	assert.equal(listing[0].product, null);
	assert.equal(listing[0].refusal, TRANSFER_UNIDENTIFIED_ROW_REFUSAL);
});

test('the refusal the offer reports is the one the exporter actually raises', () => {
	// Not selection-dependent: the admission layer rejects the row before the
	// caller's `select` is consulted, so one unidentified row stops the whole
	// run whether or not the visitor ticked it. That is what makes hiding the
	// row a defect rather than a tidy-up.
	assert.throws(
		() => selectProjectTransferProjects([{ id: 'audio-1' }, { title: 'Nameless' }], () => false, 10),
		/non-empty string id/u,
	);
});

test('an addressable row reports no refusal', async () => {
	const listing = await listTransferProjects({
		store: store([{
			id: 'audio-1', title: 'Field recording', schemaFamily: 'soundscaper', schemaVersion: 1,
		}]),
		product: 'soundscaper',
	});
	assert.deepEqual(listing.map((offer) => [offer.projectId, offer.refusal, offer.preselected]), [
		['soundscaper:audio-1', null, true],
	]);
	assert.equal(describeTransferProduct(listing[0]), 'Soundscaper project');
});

test('a generated key yields to a real project id, whichever is listed first', async () => {
	// The generated key is built from the store's name and the row's position, so
	// a real project whose id happens to read like one collides with it. The
	// collision used to be resolved by renaming whichever row arrived *later* -
	// which, when the unidentified row came first, renamed the real project to
	// `origin-storage#0~`. The page keys its checkboxes by that string and hands
	// the ticked set to the exporter as project ids, so the visitor ticked a
	// project that nothing then matched: it was reported as chosen and never
	// crossed. A generated key matches no project and can move; a real id cannot.
	const listing = await listTransferProjects({
		store: store([
			{ title: 'Nameless', schemaVersion: 31 },
			{ id: 'origin-storage#0', title: 'Deliberate', schemaVersion: 31 },
		]),
		product: 'framescaper',
	});
	assert.deepEqual(listing.map((offer) => offer.projectId), [
		'origin-storage#0~',
		'origin-storage#0',
	]);
	assert.deepEqual(listing.map((offer) => offer.storeProjectId), [null, 'origin-storage#0']);
	// The real row keeps the id the exporter is addressed by, and the two rows are
	// still separately selectable.
	assert.equal(listing[1].projectId, listing[1].storeProjectId);
	assert.equal(new Set(listing.map((offer) => offer.projectId)).size, 2);
});

test('a real id keeps its key even when several generated keys crowd around it', async () => {
	const listing = await listTransferProjects({
		store: store([
			{ title: 'Nameless one', schemaVersion: 31 },
			{ title: 'Nameless two', schemaVersion: 31 },
			{ id: 'origin-storage#1', title: 'Deliberate', schemaVersion: 31 },
		]),
		product: 'framescaper',
	});
	assert.deepEqual(listing.map((offer) => offer.projectId), [
		'origin-storage#0',
		'origin-storage#1~',
		'origin-storage#1',
	]);
	assert.equal(new Set(listing.map((offer) => offer.projectId)).size, 3);
});
