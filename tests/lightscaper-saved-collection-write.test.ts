/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { admitPhotoLibrarySavedCommandV1 } from '../src/lightscaper/controller/photo-library-saved-collection-admission-v1.ts';
import { applyPhotoLibrarySavedCollectionV1 } from '../src/lightscaper/controller/photo-library-saved-collection-write-v1.ts';
import { smartCollectionDefinitionV1 as definition, smartCollectionRepositoryFixtureV1 as fixture } from './helpers/lightscaper-smart-collection-repository-fixture.ts';
import { normalizePhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';

test('actual create update delete retain CAS truth and expose no recipe in public ACK', async () => {
	const f = await fixture();
	let context = { catalogId: 'catalog', catalogRevision: 0, indexRevision: 0, collectionStateRevision: 0, collectionCount: 0 };
	const queryJson = JSON.stringify(definition().query);
	try {
		const create = admitPhotoLibrarySavedCommandV1({ type: 'create', context, name: 'Saved', queryJson }, () => 'saved');
		let ack = await applyPhotoLibrarySavedCollectionV1(f.repository, 'catalog', create);
		assert.equal(ack.outcome, 'created'); assert.equal(ack.summary?.revision, 0); assert.equal(ack.context.collectionCount, 1);
		assert.equal(Object.hasOwn(ack, 'definition'), false); context = ack.context;
		const update = admitPhotoLibrarySavedCommandV1({ type: 'update', context, collectionId: 'saved', expectedDefinitionRevision: 0, name: 'Edited', queryJson }, () => { throw new Error('No create'); });
		ack = await applyPhotoLibrarySavedCollectionV1(f.repository, 'catalog', update);
		assert.equal(ack.outcome, 'updated'); assert.equal(ack.summary?.revision, 1); assert.equal(ack.context.catalogRevision, 2);
		const remove = admitPhotoLibrarySavedCommandV1({ type: 'delete', context: ack.context, collectionId: 'saved', expectedDefinitionRevision: 1 }, () => { throw new Error('No create'); });
		ack = await applyPhotoLibrarySavedCollectionV1(f.repository, 'catalog', remove);
		assert.equal(ack.outcome, 'deleted'); assert.equal(ack.summary, null); assert.equal(ack.context.collectionCount, 0);
	} finally { f.database.close(); await f.repository.close(); }
});

test('late cancellation cannot erase the completed exact candidate acknowledgement', async () => {
	const context = { catalogId: 'catalog', catalogRevision: 0, indexRevision: 0, collectionStateRevision: 0, collectionCount: 0 };
	const command = admitPhotoLibrarySavedCommandV1({ type: 'create', context, name: 'Saved', queryJson: JSON.stringify(definition().query) }, () => 'saved');
	const stop = new AbortController(); let candidate: unknown;
	const repository = { saveSmartCollection: async (value: unknown) => {
		candidate = value; stop.abort(17);
		return { schemaVersion: 1, kind: 'photo-smart-collection-write', catalogId: 'catalog', catalogRevision: 1, indexRevision: 1,
			state: { schemaVersion: 1, kind: 'photo-smart-collections-state', catalogId: 'catalog', revision: 1, collectionCount: 1 }, definition: command.definition };
	}, deleteSmartCollection: async () => { throw new Error('Wrong operation'); } };
	const ack = await applyPhotoLibrarySavedCollectionV1(repository, 'catalog', command, stop.signal);
	assert.equal(candidate, command.definition); assert.equal(ack.outcome, 'created'); assert.equal(ack.summary?.name, 'Saved');
});

test('forged or mismatched completed receipts never manufacture an acknowledgement', async () => {
	const context = { catalogId: 'catalog', catalogRevision: 4, indexRevision: 5, collectionStateRevision: 6, collectionCount: 1 };
	const command = admitPhotoLibrarySavedCommandV1({ type: 'update', context, collectionId: 'saved', expectedDefinitionRevision: 0,
		name: 'Edited', queryJson: JSON.stringify(definition().query) }, () => { throw new Error('No create'); });
	const document = normalizePhotoSmartCollectionV1({ ...command.definition, revision: 1 });
	const receipt = { schemaVersion: 1, kind: 'photo-smart-collection-write', catalogId: 'catalog', catalogRevision: 5, indexRevision: 6,
		state: { schemaVersion: 1, kind: 'photo-smart-collections-state', catalogId: 'catalog', revision: 7, collectionCount: 1 }, definition: document };
	for (const value of [
		{ ...receipt, catalogRevision: 4 }, { ...receipt, indexRevision: 7 }, { ...receipt, catalogId: 'foreign' },
		{ ...receipt, state: { ...receipt.state, revision: 6 } }, { ...receipt, state: { ...receipt.state, collectionCount: 2 } },
		{ ...receipt, definition: { ...document, revision: 0 } }, { ...receipt, definition: { ...document, id: 'other' } },
		{ ...receipt, definition: { ...document, name: 'Unintended' } },
		{ ...receipt, definition: { ...document, query: { ...document.query, predicate: null } } }, { ...receipt, future: true },
	]) await assert.rejects(applyPhotoLibrarySavedCollectionV1({ saveSmartCollection: async () => value,
		deleteSmartCollection: async () => { throw new Error('No delete'); } }, 'catalog', command));
	let calls = 0;
	await assert.rejects(applyPhotoLibrarySavedCollectionV1({ saveSmartCollection: async () => { calls++; return receipt; },
		deleteSmartCollection: async () => { throw new Error('No delete'); } }, 'foreign', command));
	assert.equal(calls, 0);
});

test('forged admitted commands and exact native pre-cancellation refuse before any write port', async () => {
	let calls = 0;
	const repository = { saveSmartCollection: async () => { calls++; throw new Error('No write'); },
		deleteSmartCollection: async () => { calls++; throw new Error('No write'); } };
	const context = { catalogId: 'catalog', catalogRevision: 0, indexRevision: 0, collectionStateRevision: 0, collectionCount: 0 };
	const command = admitPhotoLibrarySavedCommandV1({ type: 'create', context, name: 'Saved', queryJson: JSON.stringify(definition().query) }, () => 'saved');
	await assert.rejects(applyPhotoLibrarySavedCollectionV1(repository, 'catalog', { ...command }));
	const signal = AbortSignal.abort(17); let invoked = 0;
	Object.defineProperty(signal, 'throwIfAborted', { get() { invoked++; return () => undefined; } });
	await assert.rejects(applyPhotoLibrarySavedCollectionV1(repository, 'catalog', command, signal), error => error === 17);
	assert.equal(calls, 0); assert.equal(invoked, 0);
});
