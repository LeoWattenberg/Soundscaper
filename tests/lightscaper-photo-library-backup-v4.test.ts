/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js/index-native.js';
import { exportPhotoLibraryBackupV4, type PhotoLibraryBackupPortsV4 } from '../src/lightscaper/controller/photo-library-backup-v4.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { createImageDevelopPresetV1 } from '../src/common/editor/imaging/image-develop-preset-v1.ts';
import { copyImageDevelopSettingsV1 } from '../src/common/editor/imaging/image-develop-settings-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizePhotoDevelopPresetRowV1, photoDevelopPresetsKeyV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { smartCollectionAuditFixtureV1, AUDIT_DATABASE } from './helpers/lightscaper-smart-collection-audit-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

function presetRow(name = 'Evening', partial = false) {
	return normalizePhotoDevelopPresetRowV1({ schemaVersion: 1, kind: 'photo-develop-presets', catalogId: 'catalog', revision: 37,
		presets: [createImageDevelopPresetV1({ schemaVersion: 1, id: 'preset', name,
			settings: copyImageDevelopSettingsV1({ schemaVersion: 1, develop: defaultImageDevelopStateV1(),
				selection: { effectTypes: partial ? ['tone-ladder-v1'] : 'all', geometry: !partial, localAdjustments: !partial } }) })] }, 'catalog');
}
async function fixture(withPhoto = true) {
	const f = await smartCollectionAuditFixtureV1(), catalog = new PhotoCatalogRepositoryV1({ indexedDB: f.factory,
		databaseName: AUDIT_DATABASE, verifyOriginal: async () => undefined });
	const source = photoArchiveFixture(), settings = new KeyValueRepository({ memory: getMemoryDatabase(`backup-preset-${crypto.randomUUID()}`), database: async () => null }, 'settings');
	const root = withPhoto ? await catalog.publishPhotos(f.root.id, f.root.revision, [normalizePhotoDocumentV1({ ...source.photo, catalogId: f.root.id })]) : f.root;
	const calls = { originals: 0 }, ports: PhotoLibraryBackupPortsV4 = { catalog, stacks: catalog, developPresetSettings: settings,
		async loadOriginal() { calls.originals++; return source.original; } };
	return { ...f, catalog, root, source, settings, ports, calls, key: photoDevelopPresetsKeyV1(root.id),
		close: async () => { await catalog.close(); f.close(); } };
}
function destination(onClose?: () => void) {
	const parts: Uint8Array<ArrayBuffer>[] = [], events: string[] = [];
	const writable = new WritableStream<Uint8Array>({ write(bytes) { parts.push(new Uint8Array(bytes)); events.push('write'); },
		close() { events.push('close'); onClose?.(); }, abort() { events.push('abort'); parts.length = 0; } });
	return { parts, events, writable };
}
function hasFailure(value: unknown, reason: unknown): boolean {
	return value === reason || value instanceof AggregateError && (value.errors as unknown[]).some(error => hasFailure(error, reason));
}

test('actual V4 backup reads the selected preset row and preserves catalog, photo and original bytes', async () => {
	const f = await fixture(), expected = presetRow(); await f.settings.put(f.key, expected);
	try {
		const before = f.snapshot(), result = await exportPhotoLibraryBackupV4(f.root.id, f.ports); assert.ok(result.blob);
		assert.equal(result.document.schemaVersion, 4); assert.equal(result.document.developPresetPack?.revision, 37);
		const reader = new ZipReader(new BlobReader(result.blob), { useWebWorkers: false });
		try {
			const entry = (await reader.getEntries()).find(entry => entry.filename === 'assets/develop-presets-v1.bin');
			assert.ok(entry && !entry.directory);
			assert.deepEqual(JSON.parse(new TextDecoder().decode(await entry.getData(new Uint8ArrayWriter()))), expected);
		} finally { await reader.close(); }
		assert.equal(f.calls.originals, 1); assert.deepEqual(f.snapshot(), before); assert.deepEqual(await f.settings.get(f.key), expected);
	} finally { await f.close(); }
});

for (const drift of ['name', 'selection', 'presence', 'removal'] as const) test(`unchanged catalog revisions cannot hide late preset ${drift} drift`, async () => {
	const f = await fixture(), target = destination();
	if (drift !== 'presence') await f.settings.put(f.key, presetRow());
	try {
		const before = await f.catalog.readSnapshot(f.root.id);
		await assert.rejects(exportPhotoLibraryBackupV4(f.root.id, { ...f.ports, async loadOriginal(...args) {
			if (drift === 'removal') await f.settings.delete(f.key);
			else await f.settings.put(f.key, presetRow(drift === 'name' ? 'Later without revision' : 'Evening', drift === 'selection'));
			return f.ports.loadOriginal(...args);
		} }, { writable: target.writable }), error => hasFailureCode(error, 'DEVELOP_PRESET_REVISION_CONFLICT'));
		assert.deepEqual(await f.catalog.readSnapshot(f.root.id), before); assert.equal(target.events.at(-1), 'abort');
		assert.equal(target.events.includes('close'), false); assert.equal(target.writable.locked, false);
	} finally { await f.close(); }
});
function hasFailureCode(error: unknown, code: string): boolean {
	return error instanceof Error && (Reflect.get(error, 'code') === code
		|| error instanceof AggregateError && (error.errors as unknown[]).some(value => hasFailureCode(value, code)));
}

test('foreign or malformed initial rows refuse before original reads or destination acquisition', async () => {
	const f = await fixture();
	try {
		for (const value of [null, { ...presetRow(), catalogId: 'foreign' }, { ...presetRow(), revision: 0 }]) {
			await f.settings.put(f.key, value); const target = destination();
			await assert.rejects(exportPhotoLibraryBackupV4(f.root.id, f.ports, { writable: target.writable }));
			assert.equal(f.calls.originals, 0); assert.deepEqual(target.events, []); assert.equal(target.writable.locked, false);
		}
	} finally { await f.close(); }
});

test('physical absence and retained empty revisions remain distinct through live backup', async () => {
	const f = await fixture(false);
	try {
		for (const revision of [0, 1, 91]) {
			if (revision > 0) await f.settings.put(f.key, { ...presetRow(), revision, presets: [] });
			const result = await exportPhotoLibraryBackupV4(f.root.id, f.ports);
			assert.equal(result.document.developPresetPack?.revision ?? 0, revision);
			assert.equal(result.document.developPresetPack?.presetCount ?? 0, 0); assert.equal(f.calls.originals, 0);
		}
	} finally { await f.close(); }
});

test('borrowed preset readEntry identity and receiver are pinned before held originals allow replacement', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(); await f.settings.put(f.key, presetRow());
	let reads = 0;
	const settings = { async readEntry(key: string) { assert.equal(this, settings); reads++; return f.settings.readEntry(key); } };
	const work = exportPhotoLibraryBackupV4(f.root.id, { ...f.ports, developPresetSettings: settings,
		async loadOriginal(...args) { entered.resolve(); await release.promise; return f.ports.loadOriginal(...args); } });
	try {
		await entered.promise; settings.readEntry = async () => { assert.fail('Replaced readEntry must not run'); }; release.resolve();
		assert.equal((await work).document.developPresetPack?.revision, 37); assert.equal(reads, 2);
	} finally { release.resolve(); await work; await f.close(); }
});

for (const phase of ['capture', 'verify'] as const) test(`held preset ${phase} cancellation joins before destination settlement`, async () => {
	const f = await fixture(), target = destination(), stop = new AbortController(), entered = deferred<void>(), release = deferred<void>();
	await f.settings.put(f.key, presetRow()); let reads = 0;
	const reason = Object.freeze({ cancelled: phase });
	const work = exportPhotoLibraryBackupV4(f.root.id, { ...f.ports, developPresetSettings: { async readEntry(key) {
		reads++; if (reads === (phase === 'capture' ? 1 : 2)) { entered.resolve(); await release.promise; } return f.settings.readEntry(key);
	} } }, { signal: stop.signal, writable: target.writable });
	const joined = work.catch(() => undefined);
	try {
		await entered.promise; stop.abort(reason); assert.equal(await remainsPending(joined), true);
		assert.equal(target.events.includes('abort'), false); assert.equal(target.writable.locked, phase === 'verify');
		release.resolve(); await assert.rejects(work, error => hasFailure(error, reason));
		assert.equal(target.writable.locked, false); assert.equal(target.events.includes('close'), false);
		assert.equal(target.events.includes('abort'), phase === 'verify');
	} finally { release.resolve(); await joined; await f.close(); }
});

test('a missing preset reader refuses before initial catalog capture and never silently exports a partial format', async () => {
	const f = await fixture(false), target = destination(); let snapshots = 0;
	try {
		const read = f.catalog.readSnapshot.bind(f.catalog); f.catalog.readSnapshot = async (...args) => { snapshots++; return read(...args); };
		let legacyReads = 0;
		for (const settings of [undefined, { async get() { legacyReads++; return undefined; } }]) {
			await assert.rejects(exportPhotoLibraryBackupV4(f.root.id, { ...f.ports, developPresetSettings: settings } as unknown as PhotoLibraryBackupPortsV4,
				{ writable: target.writable }), /capabilit/iu);
		}
		assert.equal(legacyReads, 0);
		assert.equal(snapshots, 0); assert.deepEqual(target.events, []); assert.equal(target.writable.locked, false);
	} finally { await f.close(); }
});

test('opaque final preset cancellation survives a distinct failed destination abort without reason reflection', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	await f.settings.put(f.key, presetRow()); let reads = 0, inspections = 0;
	const reason = new Proxy({}, { get() { inspections++; throw new Error('Opaque read'); }, getPrototypeOf() { inspections++; throw new Error('Opaque prototype'); } });
	const cleanup = new Error('Destination abort failed');
	const writable = new WritableStream<Uint8Array>({ write() {}, abort() { throw cleanup; } });
	const work = exportPhotoLibraryBackupV4(f.root.id, { ...f.ports, developPresetSettings: { async readEntry(key) {
		reads++; if (reads === 2) { entered.resolve(); await release.promise; } return f.settings.readEntry(key);
	} } }, { signal: stop.signal, writable });
	let failure: unknown; const joined = work.catch((error: unknown) => { failure = error; });
	try {
		await entered.promise; stop.abort(reason); assert.equal(await remainsPending(joined), true); release.resolve(); await joined;
		assert.equal(inspections, 0); assert.ok(failure instanceof AggregateError); assert.equal(failure.name, 'AbortError');
		const flattened = (value: unknown): unknown[] => value === reason || value === cleanup ? [value]
			: value instanceof AggregateError ? (value.errors as unknown[]).flatMap(flattened) : [value];
		assert.ok(flattened(failure).includes(reason)); assert.ok(flattened(failure).includes(cleanup));
		assert.equal(writable.locked, false);
	} finally { release.resolve(); await joined; await f.close(); }
});
