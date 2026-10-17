/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoLibraryImportCollectorV1, detachPhotoLibraryImportSettingsV1 } from '../src/common/editor/controller/shared/photo-library-import-gesture-v1.ts';

const item = { index: 0, fileName: '東京 é source.png', photoId: 'photo', status: 'imported', reusedOriginal: false, message: null, hasMetadataNotices: false };

test('authored snapshots preserve blank versus omission, Unicode, and all1024 IDs without shared references', () => {
	const input = { rename: { template: '{stem}-東京.{extension}', sequenceStart: 2, sequencePadding: 4 },
		metadata: { creator: '', caption: 'é\n東京' }, keywordIds: Array.from({ length: 1_024 }, (_, index) => `keyword${String(index)}`) };
	const snapshot = detachPhotoLibraryImportSettingsV1(input); input.metadata.creator = 'Changed'; input.keywordIds.pop(); input.rename.template = 'Changed';
	assert.equal(snapshot.metadata.creator, ''); assert.equal(Object.hasOwn(snapshot.metadata, 'title'), false);
	assert.equal(snapshot.metadata.caption, 'é\n東京'); assert.equal(snapshot.keywordIds.length, 1_024); assert.equal(snapshot.rename?.template, '{stem}-東京.{extension}');
	for (const value of [snapshot, snapshot.metadata, snapshot.rename, snapshot.keywordIds]) assert.ok(Object.isFrozen(value));
	assert.throws(() => detachPhotoLibraryImportSettingsV1({ ...input, keywordIds: Array(1_025).fill('keyword') }));
});

test('settings and receipt admission reject accessors, unknown fields and sparse arrays without evaluating them', () => {
	let reads = 0; const metadata = Object.defineProperty({}, 'title', { enumerable: true, get() { reads++; throw new Error('getter'); } });
	assert.throws(() => detachPhotoLibraryImportSettingsV1({ rename: null, metadata, keywordIds: [] }));
	assert.throws(() => detachPhotoLibraryImportSettingsV1({ rename: null, metadata: {}, keywordIds: ['keyword'], original: 'body' }));
	assert.throws(() => detachPhotoLibraryImportSettingsV1({ rename: null, metadata: {}, keywordIds: Array(1) }));
	const collector = createPhotoLibraryImportCollectorV1([item.fileName]);
	assert.throws(() => collector.acknowledge(Object.defineProperty({ ...item }, 'photoId', { enumerable: true, get() { reads++; throw new Error('getter'); } })));
	assert.throws(() => collector.acknowledge({ ...item, original: 'body' })); assert.equal(reads, 0); assert.deepEqual(collector.snapshot(), []);
});

test('64 indexed publications are sorted, detached and source-bound;65 sources are refused', () => {
	const names = Array.from({ length: 64 }, (_, index) => `原本 ${String(index)}.JPG`), collector = createPhotoLibraryImportCollectorV1(names);
	for (let index = 63; index >= 0; index--) collector.acknowledge({ ...item, index, fileName: names[index], photoId: `photo${String(index)}` });
	assert.deepEqual(collector.snapshot().map(value => value.index), Array.from({ length: 64 }, (_, index) => index));
	assert.ok(collector.snapshot().every(value => Object.isFrozen(value))); assert.ok(Object.isFrozen(collector.snapshot()));
	assert.throws(() => createPhotoLibraryImportCollectorV1([...names, '65.png']));
	assert.throws(() => collector.acknowledge({ ...item, fileName: 'renamed display name.png' }));
	assert.throws(() => collector.acknowledge({ ...item, index: 64 }));
});

test('duplicate callbacks never duplicate or replace durable identity and failed final entries cannot erase acknowledgements', () => {
	const collector = createPhotoLibraryImportCollectorV1([item.fileName]); collector.acknowledge(item); collector.acknowledge(item);
	assert.throws(() => collector.acknowledge({ ...item, photoId: 'different' }));
	collector.finish([{ ...item, status: 'failed', photoId: null, message: 'Later cleanup failed' }]);
	assert.deepEqual(collector.snapshot(), [item]); assert.equal(collector.hasAcknowledgement(), true);
	assert.throws(() => collector.finish([item, item])); assert.deepEqual(collector.snapshot(), [item]);
});

test('incomplete finals retain known publications and never claim every selected file finished', () => {
	const collector = createPhotoLibraryImportCollectorV1([item.fileName, 'second.png']);
	assert.throws(() => collector.finish([item]), /incomplete/u); assert.deepEqual(collector.snapshot(), [item]);
	assert.throws(() => collector.finish(Array(2))); assert.deepEqual(collector.snapshot(), [item]);
});

test('source names share the existing256-unit admission bound before receipt retention', () => {
	assert.doesNotThrow(() => createPhotoLibraryImportCollectorV1(['東'.repeat(256)]));
	assert.throws(() => createPhotoLibraryImportCollectorV1(['東'.repeat(257)]));
	assert.throws(() => createPhotoLibraryImportCollectorV1(['x'.repeat(1_000_000)]));
});
