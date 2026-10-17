/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoHistoryV2, commitPhotoHistoryV2, undoPhotoHistoryV2, redoPhotoHistoryV2, createPhotoVersionV2 } from '../src/lightscaper/catalog/photo-history-v2.ts';
import { serializePhotoDocumentV1OrV2, upgradePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { createPhotoHistoryV1 } from '../src/lightscaper/catalog/photo-history.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

test('mixed history keeps monotonic revisions and aggregate2 through undo to original aggregate1', () => {
	const original = photoArchiveFixture().photo, initial = createPhotoHistoryV2(original, 2);
	let history = commitPhotoHistoryV2(initial, upgradePhotoDocumentV2(original));
	assert.equal(history.present.schemaVersion, 2); assert.equal(history.present.revision, 1);
	history = undoPhotoHistoryV2(history);
	assert.equal(history.present.schemaVersion, 2); assert.equal(history.present.revision, 2);
	history = redoPhotoHistoryV2(history);
	assert.equal(history.present.schemaVersion, 2); assert.equal(history.present.revision, 3);
	assert.deepEqual(history.present.original, original.original); assert.deepEqual(history.present.extractedMetadata, original.extractedMetadata);
	assert.equal(createPhotoHistoryV1(original).present.schemaVersion, 1);
	assert.throws(() => createPhotoHistoryV1(history.present));
});

test('history retains old capacity/no-op semantics and refuses identity, original, facts or stale revision changes', () => {
	const photo = photoArchiveFixture().photo;
	let history = createPhotoHistoryV2(photo, 2);
	for (const rating of [1, 2, 3, 4]) history = commitPhotoHistoryV2(history, { ...history.present, rating });
	assert.equal(history.past.length, 2); assert.equal(history.present.revision, 4);
	const empty = createPhotoHistoryV2(photo); assert.equal(undoPhotoHistoryV2(empty), empty); assert.equal(redoPhotoHistoryV2(empty), empty);
	for (const patch of [{ id: 'other' }, { original: { ...photo.original, name: 'changed' } }, { extractedMetadata: {} }, { revision: 0 }]) {
		assert.throws(() => commitPhotoHistoryV2(history, { ...history.present, ...patch }));
	}
	const copy = createPhotoVersionV2(upgradePhotoDocumentV2(photo), { id: 'copy', name: 'Copy', createdAt: '2026-10-09T00:00:00.000Z' });
	assert.equal(copy.schemaVersion, 2); assert.equal(copy.activeVersionId, 'copy'); assert.equal(copy.versions[1]?.kind, 'virtual-copy');
	assert.deepEqual(copy.versions[1]?.develop, photo.versions[0]?.develop);
});

test('history byte eviction retains present plus bounded real whole photos without reducing original facts', () => {
	const base = photoArchiveFixture().photo, initialDevelop = base.versions[0]!.develop;
	const develop = { ...initialDevelop, masks: [{ schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], outputNodeId: 'node',
		nodes: [{ id: 'node', kind: 'vector-path', fillRule: 'nonzero', paths: [{ id: 'outline', closed: true,
			points: Array.from({ length: 16_384 }, () => ({ position: { x: 0.1234567890123456, y: 0.1234567890123456 }, inHandle: null, outHandle: null })) }] }] }] };
	let history = createPhotoHistoryV2({ ...base, versions: [{ ...base.versions[0], develop }] }, 100);
	for (let index = 0; index < 12; index++) history = commitPhotoHistoryV2(history, { ...history.present, metadata: { ...history.present.metadata, title: String(index) } });
	assert.equal(history.present.revision, 12); assert.ok(history.past.length < 12);
	const bytes = [history.present, ...history.past, ...history.future].reduce((sum, photo) => sum + new TextEncoder().encode(serializePhotoDocumentV1OrV2(photo)).byteLength, 0);
	assert.ok(bytes <= 16_777_216); assert.deepEqual(history.present.original, base.original);
	assert.throws(() => createPhotoHistoryV2(base, 101));
	assert.throws(() => commitPhotoHistoryV2(createPhotoHistoryV2({ ...base, revision: Number.MAX_SAFE_INTEGER }), { ...base, revision: Number.MAX_SAFE_INTEGER }));
});
