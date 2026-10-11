/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { normalizePhotoDocumentV3 } from '../src/lightscaper/catalog/photo-document-v3.ts';
import { serializePhotoDocumentCurrentV1, upgradePhotoDocumentV3 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { serializePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { createPhotoHistoryV2 } from '../src/lightscaper/catalog/photo-history-v2.ts';
import { createPhotoHistoryV1 } from '../src/lightscaper/catalog/photo-history.ts';
import { createPhotoHistoryCurrentV1, commitPhotoHistoryCurrentV1, undoPhotoHistoryCurrentV1, redoPhotoHistoryCurrentV1,
	createPhotoVersionCurrentV1, type PhotoHistoryCurrentV1 } from '../src/lightscaper/catalog/photo-history-current-v1.ts';

const CREATED = '2026-10-09T00:00:00.000Z';
function repaired() {
	return replaceImageDevelopRepairSpotsV1(defaultImageDevelopStateV1(), { schemaVersion: 1, spots: [{ id: 'heal', mode: 'heal', enabled: false,
		target: { x: 0.7, y: 0.5 }, source: { x: 0.2, y: 0.5 }, radius: 0.15, feather: 0, opacity: 1 }] });
}
function inactivePhoto() {
	const base = photoArchiveFixture().photo, develop = repaired();
	return normalizePhotoDocumentV3({ ...base, schemaVersion: 3, versions: [{ ...base.versions[0],
		workspace: { schemaVersion: 3, kind: 'photo-develop-workspace', entries: [{ label: 'Original', createdAt: CREATED, develop: base.versions[0]!.develop },
			{ label: 'Heal redo', createdAt: CREATED, develop }], cursor: 0, snapshots: [{ id: 'saved', name: 'Heal', createdAt: CREATED, develop }] } },
		{ id: 'repair-copy', kind: 'virtual-copy', name: 'Inactive repair', createdAt: CREATED, develop }] });
}

test('current whole-photo history keeps legacy admission, bytes and empty undo/redo identity unchanged', () => {
	const photo = photoArchiveFixture().photo, initial = createPhotoHistoryCurrentV1(photo, 2);
	assert.deepEqual(initial, createPhotoHistoryV2(photo, 2));
	assert.equal(serializePhotoDocumentCurrentV1(initial.present), serializePhotoDocumentV1OrV2(photo));
	assert.equal(initial.present.schemaVersion, 1); assert.equal(undoPhotoHistoryCurrentV1(initial), initial); assert.equal(redoPhotoHistoryCurrentV1(initial), initial);
	const edited = commitPhotoHistoryCurrentV1(initial, { ...photo, rating: 1 });
	assert.equal(edited.present.schemaVersion, 1); assert.equal(edited.present.revision, 1);
	assert.equal(undoPhotoHistoryCurrentV1(edited).present.schemaVersion, 1);
});

test('explicit aggregate3 remains sticky through undo to original1 and redo with monotonic native revisions', () => {
	const original = photoArchiveFixture().photo;
	let history = commitPhotoHistoryCurrentV1(createPhotoHistoryCurrentV1(original, 2), upgradePhotoDocumentV3(original));
	assert.equal(history.present.schemaVersion, 3); assert.equal(history.present.revision, 1);
	history = undoPhotoHistoryCurrentV1(history);
	assert.equal(history.present.schemaVersion, 3); assert.equal(history.present.revision, 2);
	assert.equal(history.present.versions[0]?.develop.processVersion, 1);
	history = redoPhotoHistoryCurrentV1(history);
	assert.equal(history.present.schemaVersion, 3); assert.equal(history.present.revision, 3);
	assert.deepEqual(history.present.original, original.original); assert.deepEqual(history.present.extractedMetadata, original.extractedMetadata);
	assert.throws(() => createPhotoHistoryV1(history.present)); assert.throws(() => createPhotoHistoryV2(history.present));
});

test('metadata edits and history moves retain every inactive repaired version, redo entry and snapshot', () => {
	const original = inactivePhoto(); let history = createPhotoHistoryCurrentV1(original, 3);
	history = commitPhotoHistoryCurrentV1(history, { ...original, rating: 2 });
	history = commitPhotoHistoryCurrentV1(history, { ...history.present, metadata: { ...history.present.metadata, title: 'Retained repair' } });
	history = undoPhotoHistoryCurrentV1(history);
	assert.deepEqual(history.present.versions, original.versions); assert.equal(history.present.schemaVersion, 3);
	assert.equal(history.present.versions[0]?.develop.processVersion, 1);
	assert.equal(history.future[0]?.versions[0]?.workspace?.entries[1]?.develop.processVersion, 3);
	assert.equal(history.present.versions[0]?.workspace?.snapshots[0]?.develop.processVersion, 3);
	assert.equal(history.present.versions[1]?.develop.processVersion, 3);
	assert.deepEqual(redoPhotoHistoryCurrentV1(history).present.versions, original.versions);
});

test('current history derives sticky3 from the complete retained closure before branch truncation or capacity eviction', () => {
	const original = photoArchiveFixture().photo, repair = inactivePhoto();
	for (const position of ['past', 'future'] as const) {
		const history: PhotoHistoryCurrentV1 = Object.freeze({ present: original,
			past: Object.freeze(position === 'past' ? [repair] : []), future: Object.freeze(position === 'future' ? [repair] : []), capacity: 1 });
		const branched = commitPhotoHistoryCurrentV1(history, { ...original, rating: 1 });
		assert.equal(branched.present.schemaVersion, 3); assert.equal(branched.present.revision, 1);
		assert.equal(branched.future.length, 0); assert.equal(branched.past.length, 1);
		assert.equal(undoPhotoHistoryCurrentV1(branched).present.schemaVersion, 3);
	}
});

test('current virtual copies preserve repaired settings and aggregate3 without body capabilities or new original identity', () => {
	const original = inactivePhoto();
	const copy = createPhotoVersionCurrentV1(original, { id: 'copy', name: 'Repair copy', createdAt: CREATED, sourceVersionId: 'repair-copy' });
	assert.equal(copy.schemaVersion, 3); assert.equal(copy.activeVersionId, 'copy');
	assert.deepEqual(copy.versions.find(version => version.id === 'copy')?.develop, original.versions[1]?.develop);
	assert.deepEqual(copy.original, original.original); assert.deepEqual(copy.versions[0], original.versions[0]);
	assert.throws(() => createPhotoVersionCurrentV1(original, { id: 'copy', name: 'Missing', createdAt: CREATED, sourceVersionId: 'missing' }));
	assert.throws(() => createPhotoVersionCurrentV1(original, { id: original.versions[0]!.id, name: 'Duplicate', createdAt: CREATED }));
	let invoked = 0;
	const request = Object.defineProperty({ id: 'copy', name: 'Accessor', createdAt: CREATED }, 'sourceVersionId', { enumerable: true, get() { invoked++; return 'repair-copy'; } });
	assert.throws(() => createPhotoVersionCurrentV1(original, request)); assert.equal(invoked, 0);
});

test('current history refuses original/import identity changes and stale revisions without mutating admitted history', () => {
	const original = inactivePhoto(); const history = commitPhotoHistoryCurrentV1(createPhotoHistoryCurrentV1(original, 2), { ...original, rating: 1 });
	const before = serializePhotoDocumentCurrentV1(history.present);
	for (const patch of [{ id: 'other' }, { catalogId: 'other' }, { original: { ...original.original, name: 'Changed' } },
		{ extractedMetadata: {} }, { revision: 0 }]) assert.throws(() => commitPhotoHistoryCurrentV1(history, { ...history.present, ...patch }));
	assert.equal(serializePhotoDocumentCurrentV1(history.present), before);
	assert.throws(() => commitPhotoHistoryCurrentV1(createPhotoHistoryCurrentV1({ ...original, revision: Number.MAX_SAFE_INTEGER }), { ...original, revision: Number.MAX_SAFE_INTEGER }));
});

test('current history capacity and real complete-photo byte eviction remain bounded while preserving current3', () => {
	const base = photoArchiveFixture().photo;
	const develop = replaceImageDevelopRepairSpotsV1({ ...base.versions[0]!.develop, masks: [{ schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], outputNodeId: 'node',
		nodes: [{ id: 'node', kind: 'vector-path', fillRule: 'nonzero', paths: [{ id: 'outline', closed: true,
			points: Array.from({ length: 16_384 }, () => ({ position: { x: 0.1234567890123456, y: 0.1234567890123456 }, inHandle: null, outHandle: null })) }] }] }] }, { schemaVersion: 1, spots: [] });
	let history = createPhotoHistoryCurrentV1({ ...base, schemaVersion: 3, versions: [{ ...base.versions[0], develop }] }, 100);
	for (let index = 0; index < 12; index++) history = commitPhotoHistoryCurrentV1(history, { ...history.present, metadata: { ...history.present.metadata, title: String(index) } });
	assert.equal(history.present.revision, 12); assert.equal(history.present.schemaVersion, 3); assert.ok(history.past.length < 12);
	const bytes = [history.present, ...history.past, ...history.future].reduce((sum, photo) => sum + new TextEncoder().encode(serializePhotoDocumentCurrentV1(photo)).byteLength, 0);
	assert.ok(bytes <= 16_777_216); assert.deepEqual(history.present.original, base.original);
	assert.throws(() => createPhotoHistoryCurrentV1(base, 0)); assert.throws(() => createPhotoHistoryCurrentV1(base, 101));
	let small = createPhotoHistoryCurrentV1(upgradePhotoDocumentV3(base), 2);
	for (const rating of [1, 2, 3, 4]) small = commitPhotoHistoryCurrentV1(small, { ...small.present, rating });
	assert.equal(small.past.length, 2); assert.equal(small.present.revision, 4);
});

test('current history closed admission refuses accessor-bearing retained metadata before invoking getters', () => {
	const base = inactivePhoto(); let invoked = 0;
	const value = Object.defineProperty({ ...base }, 'versions', { enumerable: true, get() { invoked++; return base.versions; } });
	assert.throws(() => createPhotoHistoryCurrentV1(value));
	const history = createPhotoHistoryCurrentV1(base);
	const accessor = Object.defineProperty({ ...history }, 'future', { enumerable: true, get() { invoked++; return []; } });
	assert.throws(() => commitPhotoHistoryCurrentV1(accessor, base)); assert.equal(invoked, 0);
});
