/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhotoLibraryMetadataPatchV1 } from '../src/lightscaper/controller/photo-library-metadata.ts';

test('own-data metadata Proxy snapshots preserve title, multiline caption and unknown capture offset without invoking get traps', () => {
	let getters = 0;
	const values = { title: 'Authored title', caption: 'First line\nSecond line',
		captureTime: { local: '2026-10-08T11:12:13', offsetMinutes: null } };
	const metadata = new Proxy(values, { get: () => { getters++; throw new Error('Metadata get trap executed'); } });
	const result = normalizePhotoLibraryMetadataPatchV1(metadata);
	assert.equal(getters, 0);
	assert.deepEqual(result, { title: 'Authored title', caption: 'First line\nSecond line',
		captureTime: { local: '2026-10-08T11:12:13.000', offsetMinutes: null } });
	assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.captureTime), true);
	values.title = 'Replaced'; values.captureTime.local = '2026-10-09T12:13:14';
	assert.equal(result.title, 'Authored title'); assert.equal(result.captureTime?.local, '2026-10-08T11:12:13.000');
});

test('ordinary patches retain omission versus explicit blank/clear and never invent capture offsets', () => {
	assert.deepEqual(normalizePhotoLibraryMetadataPatchV1({ title: 'Title', caption: 'Caption' }), { title: 'Title', caption: 'Caption' });
	assert.deepEqual(normalizePhotoLibraryMetadataPatchV1({ title: '', caption: '', captureTime: null }), { title: '', caption: '', captureTime: null });
	assert.deepEqual(normalizePhotoLibraryMetadataPatchV1({ captureTime: { local: '2026-10-08T11:12:13.4', offsetMinutes: null } }),
		{ captureTime: { local: '2026-10-08T11:12:13.400', offsetMinutes: null } });
	assert.deepEqual(normalizePhotoLibraryMetadataPatchV1({ captureTime: { local: '2026-10-08T11:12:13', offsetMinutes: 120 } }),
		{ captureTime: { local: '2026-10-08T11:12:13.000', offsetMinutes: 120 } });
});

test('nested capture records remain descriptor-safe and accessor/foreign patches still refuse without running getters', () => {
	let getters = 0;
	const capture = new Proxy({ local: '2026-10-08T11:12:13', offsetMinutes: null },
		{ get: () => { getters++; throw new Error('Capture get trap executed'); } });
	assert.deepEqual(normalizePhotoLibraryMetadataPatchV1({ captureTime: capture }),
		{ captureTime: { local: '2026-10-08T11:12:13.000', offsetMinutes: null } });
	const accessor = Object.defineProperty({}, 'title', { enumerable: true, get: () => { getters++; return 'Bad'; } });
	assert.throws(() => normalizePhotoLibraryMetadataPatchV1(accessor), TypeError);
	assert.throws(() => normalizePhotoLibraryMetadataPatchV1({ original: {} }), TypeError);
	assert.throws(() => normalizePhotoLibraryMetadataPatchV1({ captureTime: { local: '2026-02-30T11:12:13', offsetMinutes: null } }), /timestamp/iu);
	assert.throws(() => normalizePhotoLibraryMetadataPatchV1({ title: undefined }), TypeError);
	assert.equal(getters, 0);
});
