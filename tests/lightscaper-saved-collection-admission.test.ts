/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { admitPhotoSmartCollectionSaveV1 } from '../src/lightscaper/catalog/photo-smart-collection-repository-types-v1.ts';
import { admitPhotoLibrarySavedCommandV1, admitPhotoLibrarySavedPageRequestV1,
	admitPhotoLibrarySavedSnapshotRequestV1, admitPhotoLibrarySavedQueryRequestV1,
	admitPhotoLibrarySavedSignalV1 } from '../src/lightscaper/controller/photo-library-saved-collection-admission-v1.ts';

const context = { catalogId: 'catalog', catalogRevision: 0, indexRevision: 0, collectionStateRevision: 0, collectionCount: 0 };
const queryJson = JSON.stringify(normalizePhotoCatalogQueryV2());

test('saved command admission retains one branded candidate and no query JSON copy', () => {
	let ids = 0;
	const command = admitPhotoLibrarySavedCommandV1({ type: 'create', context, name: 'Saved', queryJson }, () => { ids++; return 'saved'; });
	assert.equal(command.collectionId, 'saved'); assert.equal(command.definition?.query.schemaVersion, 2);
	assert.equal(Object.hasOwn(command, 'queryJson'), false); assert.equal(ids, 1);
	assert.ok(Object.isFrozen(command)); assert.ok(Object.isFrozen(command.definition?.query));
	assert.equal(admitPhotoLibrarySavedCommandV1(command, () => { throw new Error('No new ID'); }), command);
});

test('closed saved options refuse accessors, unknown fields and malformed selection before allocation', () => {
	let invoked = 0;
	const bad = Object.defineProperty({}, 'signal', { enumerable: true, get() { invoked++; return undefined; } });
	for (const admit of [admitPhotoLibrarySavedPageRequestV1, admitPhotoLibrarySavedSignalV1]) {
		assert.throws(() => admit(bad)); assert.throws(() => admit({ future: true }));
	}
	assert.throws(() => admitPhotoLibrarySavedSnapshotRequestV1({ collectionId: undefined }));
	assert.throws(() => admitPhotoLibrarySavedQueryRequestV1({ collectionId: 'saved', mode: 'ordinary', query: {} }));
	assert.throws(() => admitPhotoLibrarySavedPageRequestV1({ cursor: 'x'.repeat(4097) }));
	assert.throws(() => admitPhotoLibrarySavedCommandV1({ type: 'create', context, name: 'Saved', queryJson: '{' }, () => { invoked++; return 'id'; }));
	assert.equal(invoked, 0);
});

test('native opaque cancellation takes precedence and shadow methods are never called', () => {
	let invoked = 0;
	const reason = new Proxy({}, { get() { invoked++; throw new Error('Opaque'); }, getPrototypeOf() { invoked++; throw new Error('Opaque'); } });
	const stopped = AbortSignal.abort(reason);
	Object.defineProperty(stopped, 'throwIfAborted', { get() { invoked++; return () => undefined; } });
	try { admitPhotoLibrarySavedSignalV1({ signal: stopped }); assert.fail('Expected exact cancellation'); }
	catch (error) { assert.equal(error, reason); }
	const live = new AbortController().signal;
	Object.defineProperty(live, 'reason', { get() { invoked++; return null; } });
	assert.throws(() => admitPhotoLibrarySavedSignalV1({ signal: live })); assert.equal(invoked, 0);
});

test('descriptor snapshots preserve opaque Unicode names without running Proxy gets', () => {
	let gets = 0;
	const raw = new Proxy({ type: 'create', context: new Proxy(context, { get() { gets++; throw new Error('No property get'); } }),
		name: '\ud800'.repeat(256), queryJson }, { get() { gets++; throw new Error('No property get'); } });
	const admitted = admitPhotoLibrarySavedCommandV1(raw, () => 'saved');
	assert.equal(admitted.definition?.name, '\ud800'.repeat(256)); assert.equal(gets, 0);
});

test('all full-query semantics and advancing CAS bounds refuse before private ID allocation', () => {
	let ids = 0;
	const allocate = () => { ids++; return 'saved'; };
	const valid = { type: 'create', context, name: 'Saved', queryJson };
	for (const invalid of [
		{ ...valid, name: ' ' }, { ...valid, name: 'x'.repeat(257) }, { ...valid, future: true },
		{ ...valid, queryJson: JSON.stringify({ schemaVersion: 2, kind: 'photo-catalog-query' }) },
		{ ...valid, queryJson: JSON.stringify({ ...normalizePhotoCatalogQueryV2(), schemaVersion: 3 }) },
		{ ...valid, queryJson: JSON.stringify({ ...normalizePhotoCatalogQueryV2(), predicate: { kind: 'future' } }) },
		{ ...valid, queryJson: ' '.repeat(524289) }, { ...valid, context: { ...context, catalogRevision: Number.MAX_SAFE_INTEGER } },
		{ ...valid, context: { ...context, collectionCount: 10000 } }, { ...valid, context: { ...context, indexRevision: -0 } },
		{ type: 'delete', context, collectionId: 'saved', expectedDefinitionRevision: 0 },
	]) assert.throws(() => admitPhotoLibrarySavedCommandV1(invalid, allocate));
	assert.equal(ids, 0);
});

test('a full maximum-node escaped Query2 remains one reusable branded candidate', () => {
	const query = { ...normalizePhotoCatalogQueryV2(), predicate: { kind: 'all', terms: Array.from({ length: 255 }, () => ({
		kind: 'text', column: 'camera-make', operator: 'equals', value: '\ud800'.repeat(256),
	})) } };
	const json = JSON.stringify(query), bytes = new TextEncoder().encode(json).byteLength;
	assert.ok(bytes > 390000 && bytes <= 524288);
	const command = admitPhotoLibrarySavedCommandV1({ type: 'create', context, name: 'Full grammar', queryJson: json }, () => 'saved');
	assert.equal(admitPhotoSmartCollectionSaveV1(command.definition, null), command.definition);
	assert.deepEqual(command.definition?.query.predicate, query.predicate);
});
