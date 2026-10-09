/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { exportPhotoLibraryBackupV5 } from '../src/lightscaper/controller/photo-library-backup-v5.ts';
import { importPhotoCatalogArchiveV5 } from '../src/lightscaper/archive/catalog-archive-import-v5.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { normalizePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { PhotoCubeLutRepositoryV1 } from '../src/lightscaper/storage/photo-cube-lut-repository-v1.ts';
import { normalizePhotoDevelopPresetRowV2 } from '../src/lightscaper/storage/photo-develop-preset-row-v2.ts';
import { photoDevelopPresetsKeyV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { smartCollectionAuditFixtureV1, AUDIT_DATABASE } from './helpers/lightscaper-smart-collection-audit-fixture.ts';
import { LUT_BODY, LUT_REFERENCE, lutArchiveFixture } from './helpers/lightscaper-lut-archive-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

async function fixture() {
	const f = await smartCollectionAuditFixtureV1(), catalog = new PhotoCatalogRepositoryV2({ indexedDB: f.factory,
		databaseName: AUDIT_DATABASE, verifyOriginal: async () => undefined, verifyResources: async () => undefined });
	const current = lutArchiveFixture(), old = photoArchiveFixture(2);
	const records = [{ photo: normalizePhotoDocumentV2({ ...current.record.photo, catalogId: f.root.id }), original: current.record.original },
		{ photo: normalizePhotoDocumentV1({ ...old.photo, catalogId: f.root.id }), original: old.original }];
	const root = await catalog.publishPhotos(f.root.id, f.root.revision, records.map(record => record.photo));
	const memory = getMemoryDatabase(`backup5-${crypto.randomUUID()}`), settings = new KeyValueRepository({ memory, database: async () => null }, 'settings');
	const resources = new PhotoCubeLutRepositoryV1({ memory, database: async () => null }); await resources.put(LUT_REFERENCE, LUT_BODY);
	const row = normalizePhotoDevelopPresetRowV2({ ...current.row, catalogId: root.id }, root.id);
	const key = photoDevelopPresetsKeyV1(root.id); await settings.put(key, row);
	const ports = { catalog, stacks: catalog, developPresetSettings: settings, lutResources: resources,
		async loadOriginal(original: { id: string }) { const record = records.find(record => record.photo.original.id === original.id); return record?.original; } };
	return { ...f, catalog, root, records, row, key, settings, resources, ports,
		async close() { await resources.close(); await catalog.close(); f.close(); } };
}
function destination() {
	const events: string[] = [];
	const writable = new WritableStream<Uint8Array>({ write() { events.push('write'); }, close() { events.push('close'); }, abort() { events.push('abort'); } });
	return { events, writable };
}

test('current backup authenticates every mixed source and unique LUT body without changing original or preset state', async () => {
	const f = await fixture(), photos: unknown[] = [], originals: Uint8Array[] = [], luts: Uint8Array[] = []; let row: unknown;
	try {
		const before = f.snapshot(), result = await exportPhotoLibraryBackupV5(f.root.id, f.ports);
		assert.equal(result.document.schemaVersion, 5); assert.equal(result.document.lutResources.length, 1);
		assert.equal(result.document.developPresetPack?.rowSchemaVersion, 2); assert.equal(result.document.developPresetPack?.revision, 29);
		assert.ok(result.blob);
		await importPhotoCatalogArchiveV5(result.blob, async () => ({ async writePhoto(photo, original) {
			photos.push(photo); const bytes: number[] = []; for await (const chunk of original) bytes.push(...chunk); originals.push(new Uint8Array(bytes));
		}, async writeStack() {}, async writeSavedCollection() {}, async writeDevelopPresets(value) { row = value; },
		async writeLut(reference, bytes) { assert.deepEqual(reference, LUT_REFERENCE); luts.push(bytes.slice()); }, async publish() {}, async rollback() {} }));
		assert.deepEqual(photos, f.records.map(record => record.photo)); assert.deepEqual(row, f.row); assert.deepEqual(luts, [LUT_BODY]);
		assert.deepEqual(originals, await Promise.all(f.records.map(async record => new Uint8Array(await record.original.arrayBuffer()))));
		assert.deepEqual(f.snapshot(), before); assert.deepEqual(await f.settings.get(f.key), f.row);
	} finally { await f.close(); }
});

test('preset schema, complete same-revision body and physical absence are final source fences', async () => {
	for (const drift of ['body', 'version', 'removal'] as const) {
		const f = await fixture(), target = destination();
		try {
			await assert.rejects(exportPhotoLibraryBackupV5(f.root.id, { ...f.ports, async loadOriginal(...args) {
				if (drift === 'removal') await f.settings.delete(f.key);
				else if (drift === 'version') await f.settings.put(f.key, { ...f.row, schemaVersion: 1 });
				else await f.settings.put(f.key, { ...f.row, presets: [] });
				return Reflect.apply(f.ports.loadOriginal, f.ports, args);
			} }, { writable: target.writable }));
			assert.equal(target.events.at(-1), 'abort'); assert.equal(target.events.includes('close'), false); assert.equal(target.writable.locked, false);
		} finally { await f.close(); }
	}
});

test('all borrowed methods and receivers are captured without bind metadata before held source demand', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(); let traps = 0, reads = 0;
	const settings = { readEntry: new Proxy(async function (this: unknown, key: string) { assert.equal(this, settings); reads++; return f.settings.readEntry(key); },
		{ get() { traps++; throw new Error('Callable metadata inspected'); } }) };
	const ports = { ...f.ports, developPresetSettings: settings, async loadOriginal(...args: Parameters<typeof f.ports.loadOriginal>) {
		assert.equal(this, ports); entered.resolve(); await release.promise; return Reflect.apply(f.ports.loadOriginal, f.ports, args);
	} };
	const work = exportPhotoLibraryBackupV5(f.root.id, ports);
	try { await Promise.race([entered.promise, work]); settings.readEntry = async () => { assert.fail('Replaced method used'); }; release.resolve();
		assert.equal((await work).document.developPresetPack?.revision, 29); assert.ok(reads >= 2); assert.equal(traps, 0);
	} finally { release.resolve(); await work; await f.close(); }
});

test('held final resource cancellation joins the exact consumer and source retirement before output abort', async () => {
	const f = await fixture(), stop = new AbortController(), entered = deferred<void>(), release = deferred<void>(), target = destination();
	const reason = Object.freeze({ cancelled: 'final LUT' }); let calls = 0, failure: unknown;
	const source = { async withBytes<T>(reference: unknown, consume: (bytes: Uint8Array<ArrayBuffer>) => Promise<T>, options?: { signal?: AbortSignal }) {
		calls++; return f.resources.withBytes(reference, async bytes => { if (calls === 2) { entered.resolve(); await release.promise; } return consume(bytes); }, options);
	} };
	const work = exportPhotoLibraryBackupV5(f.root.id, { ...f.ports, lutResources: source }, { writable: target.writable, signal: stop.signal });
	const joined = work.catch((error: unknown) => { failure = error; });
	try { await Promise.race([entered.promise, work]); stop.abort(reason); assert.equal(await remainsPending(joined), true); assert.equal(target.events.includes('abort'), false);
		release.resolve(); await joined; assert.ok(failure); assert.equal(target.events.includes('close'), false); assert.equal(target.writable.locked, false);
	} finally { release.resolve(); await joined; await f.close(); }
});

test('complete preset body is reverified after held final LUT authentication and before destination Close', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), target = destination(); let calls = 0;
	const source = { async withBytes<T>(reference: unknown, consume: (bytes: Uint8Array<ArrayBuffer>) => Promise<T>, options?: { signal?: AbortSignal }) {
		calls++; return f.resources.withBytes(reference, async bytes => { if (calls === 2) { entered.resolve(); await release.promise; } return consume(bytes); }, options);
	} };
	const work = exportPhotoLibraryBackupV5(f.root.id, { ...f.ports, lutResources: source }, { writable: target.writable });
	try {
		await Promise.race([entered.promise, work]); await f.settings.put(f.key, { ...f.row, presets: [] }); release.resolve();
		await assert.rejects(work); assert.equal(target.events.includes('close'), false);
		assert.equal(target.events.at(-1), 'abort'); assert.equal(target.writable.locked, false);
	} finally { release.resolve(); await work.catch(() => undefined); await f.close(); }
});
