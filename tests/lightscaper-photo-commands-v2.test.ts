/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPhotoCommandV2 } from '../src/lightscaper/controller/photo-commands-v2.ts';
import { applyPhotoCommandV1 } from '../src/lightscaper/controller/photo-commands.ts';
import { createPhotoDevelopClipboardV2, normalizePhotoDevelopClipboardV1OrV2, parsePhotoDevelopClipboardV1OrV2, serializePhotoDevelopClipboardV1OrV2 } from '../src/lightscaper/controller/photo-develop-clipboard-v2.ts';
import { createPhotoDevelopClipboardV1, normalizePhotoDevelopClipboardV1, serializePhotoDevelopClipboardV1 } from '../src/lightscaper/controller/photo-develop-clipboard.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { createPhotoCubeLutReachabilityV1 } from '../src/lightscaper/catalog/photo-cube-lut-reachability-v1.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

const TIME = '2026-10-09T00:00:00.000Z';
function cube(lut: unknown = { storageKey: `lut-sha256:${'4'.repeat(64)}`, sha256: '4'.repeat(64), byteLength: 88, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] }, enabled = false) {
	return { ...defaultPhotoDevelopV1(), processVersion: 2, effects: [{ id: 'profile', type: 'cube-lut-profile-v1', enabled, params: { lut } }] };
}

test('first LUT history edit promotes actual workspace/aggregate and retained redo/snapshots survive legacy selection', () => {
	const photo = photoArchiveFixture().photo;
	let next = applyPhotoCommandV2(photo, { type: 'record-develop', develop: cube(), label: 'LUT', createdAt: TIME });
	assert.equal(next.schemaVersion, 2); assert.equal(next.versions[0]?.workspace?.schemaVersion, 2);
	assert.equal(next.versions[0]?.workspace?.entries.length, 2);
	next = applyPhotoCommandV2(next, { type: 'save-develop-snapshot', id: 'snapshot', name: 'Snapshot', createdAt: TIME });
	const captured = next.versions[0]?.workspace?.snapshots[0]?.develop;
	next = applyPhotoCommandV2(next, { type: 'select-develop-history', cursor: 0 });
	assert.equal(next.schemaVersion, 2); assert.equal(next.versions[0]?.develop.processVersion, 1);
	assert.equal(next.versions[0]?.workspace?.entries[1]?.develop.processVersion, 2);
	const reachability = createPhotoCubeLutReachabilityV1(); reachability.addPhoto(next); assert.equal(reachability.finish().length, 1);
	next = applyPhotoCommandV2(next, { type: 'restore-develop-snapshot', snapshotId: 'snapshot', label: 'Restored', createdAt: TIME });
	assert.deepEqual(next.versions[0]?.develop, captured);
	const copy = applyPhotoCommandV2(next, { type: 'create-virtual-copy', id: 'copy', name: 'Copy', createdAt: TIME });
	assert.deepEqual(copy.versions[1]?.develop, captured); assert.deepEqual(copy.original, photo.original);
	assert.throws(() => applyPhotoCommandV1(photo, { type: 'set-develop', develop: cube() }));
	assert.throws(() => applyPhotoCommandV1(next, { type: 'set-attributes', changes: { rating: 1 } }));
});

test('legacy commands preserve exact V1 bytes; null and disabled profiles remain explicit process2 recipes', () => {
	const photo = photoArchiveFixture().photo;
	for (const command of [{ type: 'set-attributes', changes: { rating: 3 } }, { type: 'set-metadata', changes: { title: 'Authored' } }, { type: 'record-develop', develop: defaultPhotoDevelopV1(), label: 'Same', createdAt: TIME }]) {
		assert.deepEqual(applyPhotoCommandV2(photo, command), applyPhotoCommandV1(photo, command));
	}
	for (const develop of [cube(), cube(null, true)]) {
		const result = applyPhotoCommandV2(photo, { type: 'set-develop', develop });
		assert.equal(result.schemaVersion, 2); assert.deepEqual(result.versions[0]?.develop.effects, develop.effects);
	}
});

test('clipboard explicit2 and mixed dispatch retain closed refs and old literal bytes without resource IO', () => {
	const old = createPhotoDevelopClipboardV1(defaultPhotoDevelopV1());
	assert.equal(serializePhotoDevelopClipboardV1OrV2(old), serializePhotoDevelopClipboardV1(old));
	const raw = cube(), packet = createPhotoDevelopClipboardV2(raw);
	assert.equal(packet.schemaVersion, 2); assert.throws(() => normalizePhotoDevelopClipboardV1(packet));
	const text = serializePhotoDevelopClipboardV1OrV2(packet);
	assert.deepEqual(parsePhotoDevelopClipboardV1OrV2(text), packet);
	raw.effects[0]!.params.lut = null;
	assert.notEqual(packet.develop.effects[0]?.params.lut, null);
	assert.throws(() => normalizePhotoDevelopClipboardV1OrV2({ ...packet, body: 'raw' }));
	assert.throws(() => parsePhotoDevelopClipboardV1OrV2(' '.repeat(2_097_153)));
});

test('commands retain every real version and workspace identity while rename/activate/delete and snapshot deletion stay local', () => {
	let photo = applyPhotoCommandV2(photoArchiveFixture().photo, { type: 'record-develop', develop: cube(), label: 'LUT', createdAt: TIME });
	photo = applyPhotoCommandV2(photo, { type: 'save-develop-snapshot', id: 'snapshot', name: 'Captured', createdAt: TIME });
	photo = applyPhotoCommandV2(photo, { type: 'create-virtual-copy', id: 'copy', name: 'Copy', createdAt: TIME });
	photo = applyPhotoCommandV2(photo, { type: 'rename-virtual-copy', versionId: 'copy', name: 'Renamed' });
	assert.equal(photo.versions[1]?.name, 'Renamed'); assert.equal(photo.versions[1]?.workspace, undefined);
	photo = applyPhotoCommandV2(photo, { type: 'activate-version', versionId: 'version-1' });
	const develop = photo.versions[0]?.develop;
	photo = applyPhotoCommandV2(photo, { type: 'delete-develop-snapshot', snapshotId: 'snapshot' });
	assert.deepEqual(photo.versions[0]?.develop, develop); assert.equal(photo.versions[0]?.workspace?.snapshots.length, 0);
	photo = applyPhotoCommandV2(photo, { type: 'delete-virtual-copy', versionId: 'copy' });
	assert.equal(photo.versions.length, 1); assert.equal(photo.schemaVersion, 2);
	for (const command of [{ type: 'delete-virtual-copy', versionId: 'version-1' }, { type: 'activate-version', versionId: 'missing' }, { type: 'set-develop', develop: cube(), versionId: 'missing' }]) assert.throws(() => applyPhotoCommandV2(photo, command));
});

test('closed commands and clipboards reject raw body/accessors/future versions and preserve mixed clipboard schema2', () => {
	let traps = 0;
	const getter = Object.defineProperty({}, 'develop', { enumerable: true, get() { traps++; throw Error('Getter ran'); } });
	assert.throws(() => applyPhotoCommandV2(photoArchiveFixture().photo, Object.defineProperty({ type: 'set-develop' }, 'develop', Object.getOwnPropertyDescriptor(getter, 'develop')!)));
	assert.equal(traps, 0);
	assert.throws(() => createPhotoDevelopClipboardV2({ ...cube(), effects: [{ ...cube().effects[0], params: { lut: null, body: 'raw' } }] }));
	const explicit = createPhotoDevelopClipboardV2(defaultPhotoDevelopV1());
	assert.equal(explicit.schemaVersion, 2); assert.equal(normalizePhotoDevelopClipboardV1OrV2(explicit).schemaVersion, 2);
	assert.throws(() => normalizePhotoDevelopClipboardV1OrV2({ ...explicit, schemaVersion: 3 }));
	const raw = cube();
	const closed = applyPhotoCommandV2(photoArchiveFixture().photo, { type: 'set-develop', develop: raw });
	raw.effects[0]!.params.lut = null;
	assert.notEqual(closed.versions[0]?.develop.effects[0]?.params.lut, null);
});
