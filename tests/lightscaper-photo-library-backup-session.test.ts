/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoLibraryBackupPortV1 } from '../src/common/editor/photo-library-backup-port-v1.ts';
import { PhotoLibrarySessionV1 } from '../src/lightscaper/controller/photo-library-session.ts';
import type { PhotoLibrarySessionPortsV1 } from '../src/lightscaper/controller/photo-library-session-ports.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoStackV1 } from '../src/lightscaper/catalog/photo-stack-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { importPhotoCatalogArchiveV4 } from '../src/lightscaper/archive/catalog-archive-import-v4.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { developPresetArchiveRow, developPresetArchiveDestination } from './helpers/lightscaper-develop-preset-archive-fixture.ts';
import { photoDevelopPresetsKeyV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { value: InstrumentedKeyRange, configurable: true });

async function fixture(count = 1, stacked = false, withPresetSettings = true) {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const suffix = crypto.randomUUID();
	const media = new PhotoMediaStoreV1({ indexedDB, databaseName: `lightscaper-backup-session-${suffix}`, preferOpfs: false, locks: null });
	const catalog = new PhotoCatalogRepositoryV1({ indexedDB, databaseName: `lightscaper-backup-session-catalog-${suffix}`, verifyOriginal: media.verifyOriginal });
	const sources = Array.from({ length: count }, (_, index) => photoArchiveFixture(index + 1)), source = sources[0]!;
	for (const selected of sources) {
		await media.mediaRepository.writeAsset(selected.photo.original.storageKey, selected.original);
		await media.mediaRepository.catalogOriginals.retain(selected.photo.catalogId, [{ photoId: selected.photo.id, sourceId: selected.photo.original.id,
			assetId: selected.photo.original.storageKey, sha256: selected.photo.original.contentSha256, size: selected.photo.original.byteLength }]);
	}
	await catalog.createCatalog(normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1',
		name: 'Été Library', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] }));
	let root = await catalog.publishPhotos('catalog-1', 0, sources.map(selected => selected.photo));
	if (stacked) {
		await catalog.saveStack(normalizePhotoStackV1({ schemaVersion: 1, kind: 'photo-stack', catalogId: root.id,
			id: 'stack', revision: 0, photoIds: sources.map(selected => selected.photo.id), coverPhotoId: source.photo.id }), null,
		{ expectedCatalogRevision: root.revision, expectedStateRevision: 0 });
		const current = await catalog.loadCatalog(root.id); assert.ok(current); root = current;
	}
	const calls: string[] = [];
	let beforeLoad = async () => undefined;
	let cleanup: (() => undefined) | undefined;
	const ports: { -readonly [Key in keyof PhotoLibrarySessionPortsV1]: PhotoLibrarySessionPortsV1[Key] } = {
		catalog, stacks: catalog, developPresetSettings: withPresetSettings ? { ...media.settingsRepository } : undefined, journal: media.settingsRepository, media: { writeAsset: media.mediaRepository.writeAsset, custody: media.mediaRepository.catalogOriginals },
		initialize: async () => { calls.push('initialize'); return root; },
		exclusive: async (_id, run, signal) => { calls.push('lease'); const result = await run(signal); cleanup?.(); return result; },
		closeResources: async () => { calls.push('close'); await Promise.all([catalog.close(), media.close()]); },
		backup: { readSnapshot: (...args) => catalog.readSnapshot(...args),
			captureSmartCollectionArchiveV1: (...args) => catalog.captureSmartCollectionArchiveV1(...args), loadOriginal: async (original, signal) => {
			calls.push('original'); await beforeLoad(); await media.verifyOriginal(original, signal);
			return media.mediaRepository.loadAsset(original.storageKey, { signal, expectedSize: original.byteLength });
		} },
	};
	const session: PhotoLibrarySessionV1 & PhotoLibraryBackupPortV1 = new PhotoLibrarySessionV1(ports);
	return { session, ports, catalog, media, root, source, sources, calls, beforeLoad: (run: typeof beforeLoad) => { beforeLoad = run; },
		cleanup: (run: () => undefined) => { cleanup = run; } };
}

function destination() {
	const parts: Uint8Array<ArrayBuffer>[] = [];
	let aborts = 0, closes = 0;
	const writable = new WritableStream<Uint8Array>({ write: value => { parts.push(new Uint8Array(value)); },
		abort: () => { aborts++; parts.length = 0; }, close: () => { closes++; } });
	return { writable, parts, aborts: () => aborts, closes: () => closes };
}

test('Session backup returns only completed output and scalar catalog facts while preserving durable rows and custody', async () => {
	const f = await fixture();
	try {
		const before = await f.catalog.readSnapshot(f.root.id), roots = await f.media.mediaRepository.catalogOriginals.readPage({ catalogId: f.root.id });
		assert.deepEqual(f.calls, []);
		const result = await f.session.backupCatalog();
		assert.deepEqual(Object.keys(result).sort(), ['blob', 'byteLength', 'catalogId', 'catalogName', 'notices', 'photoCount']);
		assert.deepEqual(result.notices, []);
		assert.equal(result.catalogId, f.root.id); assert.equal(result.catalogName, f.root.name); assert.equal(result.photoCount, 1);
		assert.ok(result.blob instanceof Blob); assert.equal(result.blob.size, result.byteLength); assert.equal(Object.isFrozen(result), true);
		let imported = 0;
		await importPhotoCatalogArchiveV4(result.blob, async (_root, state) => ({ writePhoto: async (photo, chunks) => {
			assert.equal(state, null);
			assert.deepEqual(photo, f.source.photo); const parts = [];
			for await (const chunk of chunks) parts.push(new Uint8Array(chunk));
			assert.deepEqual(new Uint8Array(await new Blob(parts).arrayBuffer()), new Uint8Array(await f.source.original.arrayBuffer())); imported++;
		}, writeStack: async () => { assert.fail('No stacks'); }, writeDevelopPresets: async () => { assert.fail('No Develop presets'); }, writeSavedCollection: async () => { assert.fail('No saved filters'); },
		publish: async () => undefined, rollback: async () => { assert.fail('Valid output'); } }));
		assert.equal(imported, 1); assert.deepEqual(await f.catalog.readSnapshot(f.root.id), before);
		assert.deepEqual(await f.media.mediaRepository.catalogOriginals.readPage({ catalogId: f.root.id }), roots);
	} finally { await f.session.close(); }
});

test('admission and unavailable backup refuse before initialization and leave unacquired destination cleanup to the caller', async () => {
	const f = await fixture(), target = destination(); let getters = 0;
	try {
		await assert.rejects(f.session.backupCatalog({ maximumBlobBytes: 0, writable: target.writable }));
		await assert.rejects(f.session.backupCatalog({ signal: AbortSignal.abort(), writable: target.writable }), { name: 'AbortError' });
		await assert.rejects(f.session.backupCatalog(Object.defineProperty({}, 'writable', { enumerable: true,
			get: () => { getters++; throw new Error('getter'); } })));
		delete f.ports.backup; await assert.rejects(f.session.backupCatalog({ writable: target.writable }), /unavailable/iu);
		assert.equal(getters, 0); assert.deepEqual(f.calls, []); assert.equal(target.writable.locked, false);
		assert.equal(target.aborts(), 0); assert.equal(target.closes(), 0);
	} finally { await target.writable.abort(); await f.session.close(); }
});

test('Session refuses unavailable selected preset storage before initialization or destination acquisition', async () => {
	const f = await fixture(1, false, false), target = destination();
	try {
		await assert.rejects(f.session.backupCatalog({ writable: target.writable }), /unavailable/iu);
		assert.deepEqual(f.calls, []); assert.equal(target.writable.locked, false);
		assert.equal(target.aborts() + target.closes(), 0);
	} finally { await target.writable.abort(); await f.session.close(); }
});

test('Session requires a presence-aware preset reader before initialization instead of silently exporting an incomplete archive', async () => {
	const f = await fixture(), target = destination();
	try {
		assert.ok(f.ports.developPresetSettings); Reflect.deleteProperty(f.ports.developPresetSettings, 'readEntry');
		await assert.rejects(f.session.backupCatalog({ writable: target.writable }), /unavailable/iu);
		assert.deepEqual(f.calls, []); assert.equal(target.writable.locked, false); assert.equal(target.aborts() + target.closes(), 0);
	} finally { await target.writable.abort(); await f.session.close(); }
});

test('Session backup and Develop retain the same constructor-selected preset repository after a flat port replacement', async () => {
	const f = await fixture(), row = developPresetArchiveRow(11, 1, 'Selected library');
	try {
		await f.media.settingsRepository.put(photoDevelopPresetsKeyV1('catalog-1'), row);
		f.ports.developPresetSettings = { get: () => { assert.fail('A later flat port cannot retarget selected settings.'); },
			putIfAbsent: () => { assert.fail('Unexpected preset write.'); }, replaceIfCurrent: () => { assert.fail('Unexpected preset write.'); } };
		assert.equal((await f.session.develop.presets!.list({ schemaVersion: 1, catalogId: 'catalog-1' })).revision, 11);
		const output = await f.session.backupCatalog(), witness = developPresetArchiveDestination(); assert.ok(output.blob);
		await importPhotoCatalogArchiveV4(output.blob, async () => witness.stage); assert.deepEqual(witness.row, row);
	} finally { await f.session.close(); }
});

test('streaming Session backup reports no Blob and releases the acquired destination', async () => {
	const f = await fixture(), target = destination();
	try {
		const result = await f.session.backupCatalog({ writable: target.writable });
		assert.equal(result.blob, null); assert.equal(target.closes(), 1); assert.equal(target.aborts(), 0); assert.equal(target.writable.locked, false);
		assert.equal(result.byteLength, target.parts.reduce((total, part) => total + part.length, 0));
	} finally { await f.session.close(); }
});

test('Session refuses missing saved archive or stack capabilities before initialization instead of exporting a partial format', async () => {
	for (const capability of ['saved', 'stacks']) {
		const f = await fixture(), target = destination();
		try {
			if (capability === 'saved') { assert.ok(f.ports.backup); Reflect.deleteProperty(f.ports.backup, 'captureSmartCollectionArchiveV1'); }
			else delete f.ports.stacks;
			await assert.rejects(f.session.backupCatalog({ writable: target.writable }), /unavailable/iu);
			assert.deepEqual(f.calls, []); assert.equal(target.writable.locked, false);
			assert.equal(target.aborts() + target.closes(), 0);
		} finally { await target.writable.abort(); await f.session.close(); }
	}
});

for (const method of ['readStackState', 'readStackPage', 'loadStack'] as const) {
	test(`Session refuses missing ${method} before initialization or destination acquisition`, async () => {
		const f = await fixture(), target = destination();
		try {
			assert.ok(f.ports.stacks); Object.defineProperty(f.ports.stacks, method, { value: undefined, configurable: true });
			await assert.rejects(f.session.backupCatalog({ writable: target.writable }), /unavailable|capabilities/iu);
			assert.deepEqual(f.calls, []); assert.equal(target.writable.locked, false);
			assert.equal(target.aborts() + target.closes(), 0);
		} finally { await target.writable.abort(); await f.session.close(); }
	});
}

test('Session captures borrowed method identities and receivers before a held original allows replacement', async () => {
	const f = await fixture(2, true), entered = deferred<void>(), held = deferred<void>();
	assert.ok(f.ports.backup); const backup = f.ports.backup, catalog = f.catalog;
	assert.ok(f.ports.developPresetSettings); const presets = f.ports.developPresetSettings;
	const reads = new Map<string, number>(), restore: Array<() => void> = [];
	function bindWitness<Args extends unknown[], Result>(owner: object, key: string, original: (...args: Args) => Result): void {
		const descriptor = Object.getOwnPropertyDescriptor(owner, key);
		Object.defineProperty(owner, key, { configurable: true, writable: true, value: function (this: unknown, ...args: Args) {
			assert.equal(this, owner); reads.set(key, (reads.get(key) ?? 0) + 1); return original.apply(owner, args);
		} });
		restore.push(() => { if (descriptor) Object.defineProperty(owner, key, descriptor); else Reflect.deleteProperty(owner, key); });
	}
	bindWitness(backup, 'readSnapshot', backup.readSnapshot); bindWitness(backup, 'loadOriginal', backup.loadOriginal);
	bindWitness(catalog, 'readSummaryPage', catalog.readSummaryPage); bindWitness(catalog, 'loadPhoto', catalog.loadPhoto);
	bindWitness(catalog, 'readStackState', catalog.readStackState); bindWitness(catalog, 'readStackPage', catalog.readStackPage);
	bindWitness(catalog, 'loadStack', catalog.loadStack);
	assert.ok(presets.readEntry); bindWitness(presets, 'readEntry', presets.readEntry);
	f.beforeLoad(async () => { entered.resolve(); await held.promise; });
	const work = f.session.backupCatalog(), settled = work.catch(() => undefined);
	try {
		await entered.promise;
		for (const [owner, keys] of [[backup, ['readSnapshot', 'loadOriginal']],
			[catalog, ['readSummaryPage', 'loadPhoto', 'readStackState', 'readStackPage', 'loadStack']], [presets, ['readEntry']]] as const) {
			for (const key of keys) Object.defineProperty(owner, key, { configurable: true, writable: true,
				value: () => { assert.fail(`Late ${key} replacement must not run.`); } });
		}
		held.resolve(); const result = await work; assert.ok(result.blob); assert.deepEqual(result.notices, []);
		assert.equal(reads.get('loadOriginal'), 2); assert.equal(reads.get('loadPhoto'), 2);
		assert.ok((reads.get('readSnapshot') ?? 0) >= 2); assert.ok((reads.get('readStackState') ?? 0) >= 2);
		assert.equal(reads.get('readSummaryPage'), 1); assert.equal(reads.get('readStackPage'), 1); assert.equal(reads.get('loadStack'), 1);
		assert.equal(reads.get('readEntry'), 2);
		let photos = 0, stacks = 0;
		await importPhotoCatalogArchiveV4(result.blob, async (_root, state) => ({
			writePhoto: async (photo, chunks) => {
				assert.equal(state, null); const selected = f.sources.find(value => value.photo.id === photo.id); assert.ok(selected);
				assert.deepEqual(photo, selected.photo); const parts = []; for await (const chunk of chunks) parts.push(new Uint8Array(chunk));
				assert.deepEqual(new Uint8Array(await new Blob(parts).arrayBuffer()), new Uint8Array(await selected.original.arrayBuffer())); photos++;
			}, writeStack: async stack => { assert.deepEqual(stack.photoIds, ['photo-1', 'photo-2']); stacks++; },
			writeDevelopPresets: async () => { assert.fail('No Develop presets'); }, writeSavedCollection: async () => { assert.fail('No saved filters'); }, publish: async () => undefined,
			rollback: async () => { assert.fail('Valid output'); },
		}));
		assert.equal(photos, 2); assert.equal(stacks, 1);
	} finally { held.resolve(); await settled; for (const reset of restore) reset(); await f.session.close(); }
});

test('backup holds the existing single writer until a cancelled original load and destination cleanup settle', async () => {
	const f = await fixture(), target = destination(), entered = deferred<void>(), held = deferred<undefined>(), stop = new AbortController();
	f.beforeLoad(async () => { entered.resolve(); return held.promise; });
	const work = f.session.backupCatalog({ writable: target.writable, signal: stop.signal }), settled = work.catch(() => undefined);
	try {
		await entered.promise; stop.abort(); assert.equal(await remainsPending(work), true);
		await assert.rejects(f.session.backupCatalog(), /already pending/iu); await assert.rejects(f.session.setRating('photo-1', 5), /already pending/iu);
		held.resolve(undefined); await assert.rejects(work, { name: 'AbortError' });
		assert.equal(target.writable.locked, false); assert.equal(target.aborts(), 1); assert.equal(target.closes(), 0);
		f.beforeLoad(async () => undefined); await f.session.setRating('photo-1', 5); assert.equal((await f.catalog.loadPhoto(f.root.id, 'photo-1'))?.rating, 5);
	} finally { held.resolve(undefined); await settled; await f.session.close(); }
});

test('close joins a pending nonabortable original load and aborts acquired output before releasing storage', async () => {
	const f = await fixture(), target = destination(), entered = deferred<void>(), held = deferred<undefined>();
	f.beforeLoad(async () => { entered.resolve(); return held.promise; });
	const work = f.session.backupCatalog({ writable: target.writable }), settled = work.catch(() => undefined);
	try {
		await entered.promise; const closing = f.session.close(); assert.equal(closing, f.session.close());
		assert.equal(await remainsPending(closing), true); assert.equal(f.calls.includes('close'), false);
		held.resolve(undefined); await assert.rejects(work, { name: 'AbortError' }); await closing;
		assert.equal(target.writable.locked, false); assert.equal(target.aborts(), 1); assert.equal(f.calls.at(-1), 'close');
		await assert.rejects(f.session.backupCatalog(), /closed/iu);
	} finally { held.resolve(undefined); await settled; await f.session.close(); }
});

test('failed backup aborts output, leaves source custody intact and releases its writer for a later retry', async () => {
	const f = await fixture(), target = destination();
	try {
		const before = await f.catalog.readSnapshot(f.root.id);
		f.beforeLoad(async () => { throw new Error('original unavailable'); });
		await assert.rejects(f.session.backupCatalog({ writable: target.writable }), error => contains(error, /original unavailable/iu));
		assert.equal(target.writable.locked, false); assert.equal(target.aborts(), 1); assert.equal(target.closes(), 0);
		assert.deepEqual(await f.catalog.readSnapshot(f.root.id), before);
		f.beforeLoad(async () => undefined); assert.ok((await f.session.backupCatalog()).blob);
	} finally { await f.session.close(); }
});

test('completed external backup survives a late abort and failing lease cleanup with an explicit bounded notice', async () => {
	const f = await fixture(), target = destination(), stop = new AbortController();
	try {
		await f.session.readPage();
		f.cleanup(() => { stop.abort(); throw new Error('Lease cleanup failed after destination close'); });
		const result = await f.session.backupCatalog({ writable: target.writable, signal: stop.signal });
		assert.equal(target.closes(), 1); assert.equal(target.aborts(), 0); assert.equal(target.writable.locked, false);
		assert.equal(result.blob, null); assert.equal(result.byteLength, target.parts.reduce((total, part) => total + part.length, 0));
		assert.deepEqual(result.notices, ['cleanup-failed']); assert.equal(Object.isFrozen(result.notices), true);
	} finally { await f.session.close(); }
});

test('completed Blob backup retains its sole output artifact if surrounding lease cleanup rejects', async () => {
	const f = await fixture();
	try {
		await f.session.readPage(); f.cleanup(() => { throw new Error('Late cleanup'); });
		const result = await f.session.backupCatalog();
		assert.ok(result.blob); assert.equal(result.blob.size, result.byteLength); assert.deepEqual(result.notices, ['cleanup-failed']);
	} finally { await f.session.close(); }
});

test('a destination write failure before completion cannot fabricate a saved acknowledgment', async () => {
	const f = await fixture(); let closes = 0;
	const writable = new WritableStream<Uint8Array>({ write: () => { throw new Error('Destination refused bytes'); }, close: () => { closes++; } });
	try {
		await assert.rejects(f.session.backupCatalog({ writable }), error => contains(error, /Destination refused bytes/u));
		assert.equal(closes, 0); assert.equal(writable.locked, false);
	} finally { await f.session.close(); }
});

test('initial snapshot refusal leaves the prepared target unacquired and caller-owned', async () => {
	const f = await fixture(), target = destination();
	try {
		assert.ok(f.ports.backup); f.ports.backup = { ...f.ports.backup, readSnapshot: async () => { throw new Error('Snapshot unavailable'); } };
		await assert.rejects(f.session.backupCatalog({ writable: target.writable }), /Snapshot unavailable/u);
		assert.equal(target.writable.locked, false); assert.equal(target.aborts(), 0); assert.equal(target.closes(), 0);
		assert.equal(f.calls.includes('original'), false);
	} finally { await target.writable.abort(); await f.session.close(); }
});

test('close joins an outstanding destination close and returns its truthful completed output after late cancellation', async () => {
	const f = await fixture(), entered = deferred<void>(), held = deferred<void>();
	let destinationClosed = false;
	const writable = new WritableStream<Uint8Array>({ close: async () => { entered.resolve(); await held.promise; destinationClosed = true; } });
	const work = f.session.backupCatalog({ writable }), settled = work.catch(() => undefined);
	try {
		await entered.promise; const closing = f.session.close();
		assert.equal(await remainsPending(closing), true); assert.equal(f.calls.includes('close'), false);
		assert.equal(destinationClosed, false); assert.equal(writable.locked, true);
		held.resolve(); const result = await work; await closing;
		assert.equal(destinationClosed, true); assert.equal(writable.locked, false); assert.equal(result.blob, null);
		assert.ok(result.byteLength > 0); assert.deepEqual(result.notices, []); assert.equal(f.calls.at(-1), 'close');
	} finally { held.resolve(); await settled; await f.session.close(); }
});

test('held native destination abort retains writer admission, output lock and storage ownership until cleanup settles', async () => {
	const f = await fixture(), entered = deferred<void>(), held = deferred<void>();
	let aborted = false;
	const writable = new WritableStream<Uint8Array>({ abort: async () => { entered.resolve(); await held.promise; aborted = true; } });
	f.beforeLoad(async () => { throw new Error('Original load refused'); });
	const work = f.session.backupCatalog({ writable }), settled = work.catch(() => undefined);
	try {
		await entered.promise; assert.equal(await remainsPending(work), true);
		await assert.rejects(f.session.setRating('photo-1', 5), /already pending/iu);
		assert.equal(writable.locked, true); assert.equal(aborted, false);
		const closing = f.session.close(); assert.equal(await remainsPending(closing), true); assert.equal(f.calls.includes('close'), false);
		held.resolve(); await assert.rejects(work, error => contains(error, /Original load refused/u)); await closing;
		assert.equal(aborted, true); assert.equal(writable.locked, false); assert.equal(f.calls.at(-1), 'close');
	} finally { held.resolve(); await settled; await f.session.close(); }
});

function contains(value: unknown, pattern: RegExp): boolean {
	return value instanceof Error && (pattern.test(value.message) || (value instanceof AggregateError && value.errors.some(error => contains(error, pattern))));
}
