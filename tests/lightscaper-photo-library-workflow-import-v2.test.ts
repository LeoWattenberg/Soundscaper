/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { detachPhotoLibraryImportGestureV2 } from '../src/common/editor/ui/lightscaper/photo-library-workflow-import-v2.ts';

const preset = () => ({ schemaVersion: 2, catalogId: 'catalog-1', presetId: 'preset-1', expectedRevision: 3 });

test('current import admission detaches scalar preset choice, metadata and source names before a lazy factory can yield', () => {
	const file = new File(['original'], 'Source.png'), files = [file];
	const options = { developPreset: preset(), settings: { rename: null, metadata: { title: 'First' }, keywordIds: ['keyword-1'] } };
	const draft = detachPhotoLibraryImportGestureV2(files, options);
	options.developPreset.expectedRevision = 99; options.settings.metadata.title = 'Later'; options.settings.keywordIds[0] = 'later';
	files[0] = new File(['replacement'], 'Later.png');
	assert.equal(draft.selected[0], file); assert.equal(draft.developPreset?.expectedRevision, 3);
	assert.equal(draft.settings?.metadata.title, 'First'); assert.deepEqual(draft.settings?.keywordIds, ['keyword-1']);
	assert.ok(Object.isFrozen(draft.developPreset)); assert.ok(Object.isFrozen(draft.selected));
	draft.collector.acknowledge({ index: 0, fileName: 'Source.png', photoId: 'photo-1', status: 'imported',
		reusedOriginal: false, message: null, hasMetadataNotices: false });
	assert.equal(draft.collector.snapshot()[0]?.fileName, 'Source.png');
});

test('current import choices remain closed schema2 identities without embedded recipes or authority', () => {
	const files = [new File(['x'], 'Source.png')];
	for (const choice of [{ ...preset(), schemaVersion: 1 }, { ...preset(), expectedRevision: -0 },
		{ ...preset(), develop: {} }, { ...preset(), source: {} }, { ...preset(), presetId: '../foreign' }]) {
		assert.throws(() => detachPhotoLibraryImportGestureV2(files, { developPreset: choice }));
	}
	let reads = 0;
	assert.throws(() => detachPhotoLibraryImportGestureV2(files, { get settings() { reads++; return {}; } }));
	assert.equal(reads, 0);
});

test('native pre-abort retains its opaque reason before reflecting selected files or other option payloads', () => {
	const controller = new AbortController(), reason = new Proxy({}, { get() { assert.fail('Do not reflect an opaque reason'); } });
	controller.abort(reason); let payloadReads = 0;
	const files = new Proxy([new File(['x'], 'Source.png')], { getOwnPropertyDescriptor() { payloadReads++; assert.fail('Pre-aborted selection was read'); } });
	Object.defineProperty(controller.signal, 'throwIfAborted', { value() { assert.fail('Use the native signal method'); } });
	try { detachPhotoLibraryImportGestureV2(files, { signal: controller.signal }); assert.fail('Admission must abort'); }
	catch (error) { assert.equal(error, reason); }
	assert.equal(payloadReads, 0);
});

test('selected Files use native source names and bounded dense own entries rather than caller iterators', () => {
	const file = new File(['x'], 'Source.png'); Object.defineProperty(file, 'name', { get() { assert.fail('Use the native source name'); } });
	const files = new Proxy([file], { get() { assert.fail('Do not borrow array properties or iterators'); } });
	assert.equal(detachPhotoLibraryImportGestureV2(files).selected[0], file);
	assert.throws(() => detachPhotoLibraryImportGestureV2([]), /1 through 64/u);
	assert.throws(() => detachPhotoLibraryImportGestureV2(Array.from({ length: 65 }, () => file)), /1 through 64/u);
	assert.throws(() => detachPhotoLibraryImportGestureV2([{ name: 'Source.png' }]));
});

test('abort during payload reflection wins over a subsequent validation error', () => {
	const controller = new AbortController(), reason = Object.freeze({ cancelled: true });
	const choice = new Proxy(preset(), { ownKeys() { controller.abort(reason); throw new Error('Later validation'); } });
	try { detachPhotoLibraryImportGestureV2([new File(['x'], 'Source.png')], { signal: controller.signal, developPreset: choice }); assert.fail('Admission must abort'); }
	catch (error) { assert.equal(error, reason); }
});
