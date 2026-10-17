/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { restorePhotoLibraryArchiveV1 } from '../src/lightscaper/controller/photo-library-archive-restore-v1.ts';
import { createPhotoLibrarySessionV2 } from '../src/lightscaper/photo-library-session-runtime-v2.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { photoDevelopPresetsKeyV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 as POINTER } from '../src/lightscaper/storage/photo-library-catalog-pointer.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { savedArchiveFixtureV3 } from './helpers/lightscaper-saved-collection-archive-fixture.ts';
import { developPresetArchiveFixture as archive, developPresetArchiveRow as row, developPresetArchiveRichRow } from './helpers/lightscaper-develop-preset-archive-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';

const previous = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (previous) Object.defineProperty(globalThis, 'IDBKeyRange', previous); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const key = photoDevelopPresetsKeyV1('catalog-1'), old = { schemaVersion: 1, kind: 'photo-library', catalogId: 'catalog-1' };

async function fixture() {
	const f = mediaRestoreFixture(), active = new Set<string>();
	const locks = { async request(name: string, _options: unknown, run: (lock: Lock | null) => Promise<unknown>) {
		assert.equal(active.has(name), false); active.add(name);
		try { return await run({ name, mode: 'exclusive' }); } finally { active.delete(name); }
	} } as unknown as LockManager;
	const anchor = new PhotoMediaStoreV1({ indexedDB: f.factory, locks, preferOpfs: false }); await anchor.ready();
	await anchor.settingsRepository.put(POINTER, old); await anchor.settingsRepository.put(key, row(7, 1, 'Old anchor'));
	let allocated = 0; const settings = { ...anchor.settingsRepository };
	return { ...f, anchor, settings, locks, active, options: { indexedDB: f.factory, locks, settings, name: 'Library',
		allocateToken: () => (++allocated === 1 ? 'a' : 'b').repeat(32) } };
}

test('Actual V4 restore selects full preset bodies in the fresh namespace through Session, reopen, and original custody', async () => {
	const f = await fixture(), expected = row(Number.MAX_SAFE_INTEGER, 16);
	try {
		const receipt = await restorePhotoLibraryArchiveV1(await archive(expected), f.options);
		assert.equal(receipt.originalByteLength, 6); assert.deepEqual(receipt.notices, []);
		assert.deepEqual(await f.settings.get(key), row(7, 1, 'Old anchor'));
		for (let reopen = 0; reopen < 2; reopen++) {
			const session = await createPhotoLibrarySessionV2({ name: 'Library', indexedDB: f.factory, locks: f.locks });
			try {
				const list = await session.develop.presets!.list({ schemaVersion: 1, catalogId: 'catalog-1' }); assert.equal(list.revision, expected.revision);
				assert.equal(list.presets.length, 16);
				assert.deepEqual((await session.develop.presets!.read({ schemaVersion: 1, catalogId: 'catalog-1', presetId: 'preset-1', expectedRevision: expected.revision })).preset, expected.presets[0]);
				assert.equal((await session.readPage()).rows.length, 2);
			} finally { await session.close(); }
		}
		const media = f.raw(f.names.mediaDatabaseName);
		assert.deepEqual(media.records(f.names.mediaDatabaseName, 'mediaAssetChunks').map(value => [...new Uint8Array(value.payloadBytes)]), [[1, 2, 3], [1, 2, 3]]);
		assert.ok(media.records(f.names.mediaDatabaseName, 'catalogOriginalRoots').every(value => value.importId === null));
		assert.deepEqual(f.deleted, []); assert.equal([...f.active].some(name => name.startsWith('lightscaper-')), false);
	} finally { await f.anchor.close(); }
});

test('V3/V4 absence and retained positive empty state remain distinct through real selected Session reads', async () => {
	for (const source of [await savedArchiveFixtureV3(), await archive(null), await archive(row(29, 0))]) {
		const f = await fixture();
		try {
			await restorePhotoLibraryArchiveV1(source, f.options);
			const session = await createPhotoLibrarySessionV2({ name: 'Library', indexedDB: f.factory, locks: f.locks });
			try {
				const snapshot = await session.develop.presets!.list({ schemaVersion: 1, catalogId: 'catalog-1' }), records = f.raw(f.names.mediaDatabaseName).records(f.names.mediaDatabaseName, 'settings');
				assert.equal(snapshot.revision, records.some(value => value.key === key) ? 29 : 0);
				assert.deepEqual(snapshot.presets, []); assert.deepEqual(await f.settings.get(key), row(7, 1, 'Old anchor'));
			} finally { await session.close(); }
		} finally { await f.anchor.close(); }
	}
});

test('Full and partial recipes preserve nondefault parameters, enabled state, geometry and local mask bindings through selected Session', async () => {
	const f = await fixture(), expected = developPresetArchiveRichRow();
	try {
		await restorePhotoLibraryArchiveV1(await archive(expected), f.options);
		const session = await createPhotoLibrarySessionV2({ name: 'Library', indexedDB: f.factory, locks: f.locks });
		try {
			const menu = await session.develop.presets!.list({ schemaVersion: 1, catalogId: 'catalog-1' });
			assert.deepEqual(menu.presets.map(value => value.scope), ['full', 'partial']);
			for (const preset of expected.presets) assert.deepEqual((await session.develop.presets!.read({ schemaVersion: 1,
				catalogId: 'catalog-1', presetId: preset.identity.id, expectedRevision: expected.revision })).preset, preset);
		} finally { await session.close(); }
	} finally { await f.anchor.close(); }
});

test('Coherent same-revision preset drift at the final native settings fence prevents pointer ACK and retains the old library', async () => {
	const f = await fixture(); let changed = false;
	f.observeTransactions((_transaction, stores, mode) => {
		if (mode !== 'readwrite' || changed || typeof stores === 'string' || ![...stores].includes('mediaAssetChunks') || [...stores].length !== 4) return;
		changed = true; f.raw(f.names.mediaDatabaseName).seedRecord(f.names.mediaDatabaseName, 'settings', { key, value: row(91, 2, 'Changed') });
	});
	try {
		await assert.rejects(restorePhotoLibraryArchiveV1(await archive(), f.options)); assert.equal(changed, true);
		assert.deepEqual(await f.settings.get(POINTER), old); assert.deepEqual(await f.settings.get(key), row(7, 1, 'Old anchor'));
		assert.equal(f.deleted.length, 2);
	} finally { await f.anchor.close(); }
});

test('Known pointer ACK survives native cancellation and cleanup failure with presets and originals retained', async () => {
	const f = await fixture(), stop = new AbortController(), publish = f.settings.replaceIfCurrentAndPutIfAbsent;
	f.settings.replaceIfCurrentAndPutIfAbsent = async (...args) => { const ack = await publish(...args); stop.abort(null); return ack; };
	f.settings.deleteIfCurrent = () => Promise.reject(new Error('Retire journal failed'));
	try {
		const receipt = await restorePhotoLibraryArchiveV1(await archive(), { ...f.options, signal: stop.signal });
		assert.deepEqual(receipt.notices, ['cleanup-failed']); assert.deepEqual(f.deleted, []);
		assert.deepEqual(f.raw(f.names.mediaDatabaseName).records(f.names.mediaDatabaseName, 'settings').find(value => value.key === key), { key, value: row() });
		assert.equal(f.raw(f.names.mediaDatabaseName).records(f.names.mediaDatabaseName, 'catalogOriginalRoots').length, 2);
	} finally { await f.anchor.close(); }
});
