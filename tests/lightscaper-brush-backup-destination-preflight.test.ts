/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PhotoLibraryBackupSaveV1 } from '../src/common/editor/controller/shared/photo-library-backup-save-v1.ts';
import { createFileSystemPreparedSave } from '../src/common/editor/file-save-stream.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { createPhotoLibrarySessionV3 } from '../src/lightscaper/photo-library-session-runtime-v3.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { normalizePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { commitPhotoDevelopWorkspaceV2, createPhotoDevelopWorkspaceV2, selectPhotoDevelopHistoryV2 } from '../src/lightscaper/catalog/photo-develop-workspace-v2.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { admitPhotoLibraryBackupRequestV1 } from '../src/lightscaper/controller/photo-library-backup-request.ts';
import { importPhotoCatalogArchiveV5 } from '../src/lightscaper/archive/catalog-archive-import-v5.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
function lockManager(): LockManager {
	const active = new Set<string>();
	return { async request(name: string, _options: unknown, run: (lock: unknown) => Promise<unknown>) {
		if (active.has(name)) return run(null);
		active.add(name);
		try { return await run({ name, mode: 'exclusive' }); } finally { active.delete(name); }
	} } as unknown as LockManager;
}
function brushBody() {
	const bytes = new Uint8Array([83, 67, 77, 65, 83, 75, 48, 49, 2, 0, 0, 0, 2, 0, 0, 0, 0, 64, 128, 255]);
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	return { bytes, reference: { storageKey: `brush-mask-v1:2:2:${sha256}`, sha256, width: 2, height: 2, byteLength: 20 } };
}
async function fixture(withBrush: boolean) {
	const raw = createInstrumentedIndexedDB(), indexedDB = raw as unknown as IDBFactory;
	const session = await createPhotoLibrarySessionV3({ name: 'Brush backup', indexedDB, locks: lockManager() });
	const media = new PhotoMediaStoreV1({ indexedDB, locks: null, preferOpfs: false });
	const resources = await media.getMaskRasterResources(), input = brushBody(); await resources.put(input.reference, input.bytes);
	const catalog = new PhotoCatalogRepositoryV2({ indexedDB, verifyOriginal: media.verifyOriginal, verifyResources: resources.verifyPhoto });
	assert.ok(session.exportJournal); const journal = await session.exportJournal.open();
	const records = [photoArchiveFixture(1), photoArchiveFixture(2)];
	const neutral = normalizePhotoDocumentV2({ ...records[0]!.photo, schemaVersion: 2, catalogId: journal.catalogId });
	let second = normalizePhotoDocumentV2({ ...records[1]!.photo, schemaVersion: 2, catalogId: journal.catalogId });
	if (withBrush) {
		const develop = { ...defaultImageDevelopStateV1(), processVersion: 2, masks: [{ schemaVersion: 1, id: 'brush', kind: 'mask',
			inputs: [{ name: 'Brush', kind: 'raster', sourceRef: input.reference.storageKey }],
			nodes: [{ id: 'alpha', kind: 'raster', inputName: 'Brush', channel: 'alpha' }], outputNodeId: 'alpha' }] };
		let workspace = createPhotoDevelopWorkspaceV2(second.versions[0]!.develop, { label: 'Original', createdAt: '2026-10-11T00:00:00.000Z' });
		workspace = commitPhotoDevelopWorkspaceV2(workspace, develop, { label: 'Brush', createdAt: '2026-10-11T00:00:00.000Z' });
		workspace = selectPhotoDevelopHistoryV2(workspace, 0);
		second = normalizePhotoDocumentV2({ ...second, versions: [{ ...second.versions[0], workspace }] });
	}
	for (const record of records) await media.mediaRepository.writeAsset(record.photo.original.storageKey, record.original);
	const root = await catalog.loadCatalog(journal.catalogId); assert.ok(root);
	await catalog.publishPhotos(root.id, root.revision, [neutral, second]);
	const before = await catalog.readSnapshot(root.id), reads = () =>
		(raw.stats.getRequests as readonly { store: string }[]).filter(row => row.store === 'mediaAssets').length;
	return { raw, session, media, catalog, root, records, before, reads, photos: [neutral, second],
		async close() { await catalog.close(); await session.close(); await media.close(); } };
}
function destination(f: Awaited<ReturnType<typeof fixture>>) {
	const controller = new PhotoLibraryBackupSaveV1(), events: string[] = [], parts: Uint8Array<ArrayBuffer>[] = [];
	const input = { catalogName: 'Brush backup', fileTypeDescription: 'Photo catalog', maximumStreamingBytes: 64 * 1024 * 1024,
		prepareSave: () => { events.push('picker'); const direct = createFileSystemPreparedSave({ fileName: 'Brush backup.liscape', target: {
			createWritable: async () => { events.push('open'); return { write(value: Uint8Array | { readonly data: Uint8Array }) {
				events.push('write'); parts.push(new Uint8Array(value instanceof Uint8Array ? value : value.data));
			}, close() { events.push('commit'); }, abort() { events.push('native-abort'); } }; },
		} }); return { ...direct, async abort(reason?: unknown) { events.push('prepared-abort'); await direct.abort(reason); } }; },
		saveFile: async () => assert.fail('Streaming backup acquired Blob delivery'),
		backupCatalog: f.session.backupCatalog.bind(f.session) };
	return { controller, input, events, parts };
}

test('actual selected Runtime3 and Save refuse a retained later brush before originals or native writable, preserving picker and catalog', async () => {
	const f = await fixture(true), target = destination(f), reads = f.reads();
	try {
		const work = target.controller.start(target.input); assert.deepEqual(target.events, ['picker']);
		await assert.rejects(work, /brush|portable|transport/iu);
		assert.deepEqual(target.events, ['picker', 'prepared-abort']); assert.equal(f.reads(), reads);
		assert.equal(target.parts.length, 0); assert.equal(target.controller.isPending(), false);
		assert.deepEqual(await f.catalog.readSnapshot(f.root.id), f.before);
		assert.deepEqual(await f.catalog.loadPhoto(f.root.id, f.photos[1]!.id), f.photos[1]);
	} finally { await target.controller.cancelAndJoin(); await f.close(); }
});

test('deferred writable factory pins its real receiver before awaiting the selected backend and admits exact native output', async () => {
	const f = await fixture(false), events: string[] = [], parts: Uint8Array<ArrayBuffer>[] = [];
	const request = { createWritable: new Proxy(async function (this: unknown) { assert.equal(this, request); events.push('open');
		return new WritableStream<Uint8Array>({ write(bytes) { parts.push(new Uint8Array(bytes)); }, close() { events.push('close'); } });
	}, { get() { throw new Error('Callable metadata was borrowed'); } }) };
	const captured = admitPhotoLibraryBackupRequestV1(request);
	request.createWritable = async () => assert.fail('Replaced destination factory was called');
	try {
		const result = await f.session.backupCatalog(captured); assert.equal(result.blob, null); assert.deepEqual(events, ['open', 'close']);
		const blob = new Blob(parts); assert.equal(result.byteLength, blob.size); let consumed = 0, published = 0;
		await importPhotoCatalogArchiveV5(blob, async () => ({ async writePhoto(photo, original) {
			assert.deepEqual(photo, f.photos[consumed]); for await (const _chunk of original) { /* drain the authenticated original */ } consumed++;
		}, async writeStack() {}, async writeSavedCollection() {}, async writeDevelopPresets() {}, async writeLut() {},
			async publish() { published++; }, async rollback() { assert.fail('Valid backup rolled back'); } }));
		assert.equal(consumed, 2); assert.equal(published, 1);
	} finally { await f.close(); }
});

test('actual Save preserves stream bytes and durable commit ACK after backend preflight', async () => {
	const f = await fixture(false), target = destination(f);
	try {
		const result = await target.controller.start(target.input);
		assert.equal(result.status, 'saved'); assert.equal(target.events[0], 'picker'); assert.equal(target.events[1], 'open');
		assert.equal(target.events.at(-1), 'commit'); assert.equal(target.events.includes('prepared-abort'), false);
		assert.ok(target.parts.length > 0); assert.equal('blob' in result, false);
	} finally { await target.controller.cancelAndJoin(); await f.close(); }
});

test('preflight refusal joins unacquired prepared cleanup and preserves distinct opaque primary and cleanup failures', async () => {
	const controller = new PhotoLibraryBackupSaveV1(), primary = Proxy.revocable({}, {}); primary.revoke();
	const cleanup = Object.freeze({ cleanup: 'prepared' }), entered = deferred<void>(), release = deferred<void>(); let opens = 0;
	const direct = createFileSystemPreparedSave({ fileName: 'brush.liscape', target: { createWritable: async () => {
		opens++; return { write() {}, close() {} };
	} } });
	const work = controller.start({ catalogName: 'Brush', fileTypeDescription: 'Photo catalog', maximumStreamingBytes: 1024,
		prepareSave: () => ({ ...direct, async abort() { entered.resolve(); await release.promise; throw cleanup; } }),
		saveFile: async () => assert.fail('Unexpected delivery'), backupCatalog: async () => { throw primary.proxy; } });
	const outcome = work.then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
	try {
		await entered.promise; const joining = controller.cancelAndJoin(); assert.equal(await remainsPending(joining), true); assert.equal(opens, 0);
		release.resolve(); const error = (await outcome).error; assert.ok(error instanceof AggregateError);
		assert.equal(Object.is(error.errors[0], primary.proxy), true); assert.equal(Object.is(error.errors[1], cleanup), true);
		await joining; assert.equal(controller.isPending(), false);
	} finally { release.resolve(); await outcome; await controller.cancelAndJoin(); }
});

test('factory admission rejects conflict, accessors and pre-aborted opaque cancellation before callback or native writer acquisition', async () => {
	let calls = 0, getters = 0; const writable = new WritableStream<Uint8Array>();
	const createWritable = async () => { calls++; return writable; };
	assert.throws(() => admitPhotoLibraryBackupRequestV1({ writable, createWritable }));
	assert.throws(() => admitPhotoLibraryBackupRequestV1(Object.defineProperty({}, 'createWritable', { enumerable: true, get() { getters++; return createWritable; } })));
	assert.throws(() => admitPhotoLibraryBackupRequestV1({ createWritable: {} }));
	const reason = Proxy.revocable({}, {}); reason.revoke(); const stop = new AbortController(); stop.abort(reason.proxy);
	let failure: unknown; try { admitPhotoLibraryBackupRequestV1({ createWritable, signal: stop.signal }); } catch (error) { failure = error; }
	assert.equal(Object.is(failure, reason.proxy), true); assert.equal(calls, 0); assert.equal(getters, 0); assert.equal(writable.locked, false);
});

test('Save joins a forgotten held writable factory before opaque cancellation cleanup and retirement', async () => {
	const controller = new PhotoLibraryBackupSaveV1(), entered = deferred<void>(), release = deferred<void>(), events: string[] = [];
	const reason = Proxy.revocable({}, {}); reason.revoke(); let returned = false;
	const direct = createFileSystemPreparedSave({ fileName: 'joined.liscape', target: { createWritable: async () => {
		events.push('open'); entered.resolve(); await release.promise;
		return { write() { assert.fail('Cancelled creation wrote bytes'); }, close() { assert.fail('Cancelled creation committed'); }, abort() { events.push('native-abort'); } };
	} } });
	const work = controller.start({ catalogName: 'Joined', fileTypeDescription: 'Photo catalog', maximumStreamingBytes: 1024,
		prepareSave: () => ({ ...direct, async abort(primary?: unknown) { events.push('prepared-abort'); await direct.abort(primary); } }),
		saveFile: async () => assert.fail('Unexpected delivery'), backupCatalog: async options => {
			assert.equal(typeof options.createWritable, 'function'); void options.createWritable!().catch(() => undefined); returned = true;
			return { catalogId: 'catalog-1', catalogName: 'Joined', photoCount: 0, byteLength: 1, blob: null, notices: [] };
		} });
	const outcome = work.then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
	try {
		await Promise.race([entered.promise, outcome]); assert.equal(returned, true);
		const joining = controller.cancelAndJoin(reason.proxy); assert.equal(await remainsPending(joining), true);
		assert.deepEqual(events, ['open']); release.resolve(); const result = await outcome;
		assert.equal(Object.is(result.error, reason.proxy), true); await joining;
		assert.equal(events.includes('prepared-abort'), true); assert.equal(controller.isPending(), false);
	} finally { release.resolve(); await outcome; await controller.cancelAndJoin(); }
});

test('Save refuses repeated writable callback claims even if a backend ignores the second refusal', async () => {
	const controller = new PhotoLibraryBackupSaveV1(); let opens = 0, commits = 0;
	const direct = createFileSystemPreparedSave({ fileName: 'once.liscape', target: { createWritable: async () => {
		opens++; return { write() {}, close() { commits++; }, abort() {} };
	} } });
	await assert.rejects(controller.start({ catalogName: 'Once', fileTypeDescription: 'Photo catalog', maximumStreamingBytes: 1024,
		prepareSave: () => direct, saveFile: async () => assert.fail('Unexpected delivery'), backupCatalog: async options => {
			const stream = await options.createWritable!(); await options.createWritable!().catch(() => undefined);
			const writer = stream.getWriter(); try { await writer.write(new Uint8Array([1])); await writer.close(); } finally { writer.releaseLock(); }
			return { catalogId: 'catalog-1', catalogName: 'Once', photoCount: 0, byteLength: 1, blob: null, notices: [] };
		} }), /once|already|repeated/iu);
	assert.equal(opens, 1); assert.equal(commits, 0); assert.equal(controller.isPending(), false);
});

test('retired unclaimed writable callback cannot open a late destination after a refused archive receipt', async () => {
	const controller = new PhotoLibraryBackupSaveV1(); let opens = 0, late: (() => Promise<WritableStream<Uint8Array>>) | undefined;
	const direct = createFileSystemPreparedSave({ fileName: 'late.liscape', target: { createWritable: async () => {
		opens++; return { write() {}, close() {}, abort() {} };
	} } });
	await assert.rejects(controller.start({ catalogName: 'Late', fileTypeDescription: 'Photo catalog', maximumStreamingBytes: 1024,
		prepareSave: () => direct, saveFile: async () => assert.fail('Unexpected delivery'), backupCatalog: async options => {
			late = options.createWritable;
			return { catalogId: 'catalog-1', catalogName: 'Late', photoCount: 0, byteLength: 1, blob: null, notices: [] };
		} }));
	assert.equal(typeof late, 'function'); await assert.rejects(late!(), /retired|closed/iu); assert.equal(opens, 0);
});

test('selected deferred factory must produce a native stream before any original acquisition', async () => {
	const f = await fixture(false), reads = f.reads(); let calls = 0;
	try {
		await assert.rejects(f.session.backupCatalog({ createWritable: async () => { calls++; return undefined as unknown as WritableStream<Uint8Array>; } }), /writable|stream|destination/iu);
		assert.equal(calls, 1); assert.equal(f.reads(), reads);
	} finally { await f.close(); }
});

test('direct factory caller retains its unclaimed stream through joined opaque cancellation before ZIP acquisition', async () => {
	const f = await fixture(false), entered = deferred<void>(), release = deferred<void>(), abortEntered = deferred<void>(), abortRelease = deferred<void>();
	const stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke(); let writes = 0;
	const writable = new WritableStream<Uint8Array>({ write() { writes++; }, async abort(value) {
		assert.equal(Object.is(value, reason.proxy), true); abortEntered.resolve(); await abortRelease.promise;
	} });
	const work = f.session.backupCatalog({ signal: stop.signal, createWritable: async () => { entered.resolve(); await release.promise; return writable; } });
	const outcome = work.then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
	try {
		await entered.promise; stop.abort(reason.proxy); assert.equal(await remainsPending(work), true); release.resolve();
		assert.equal(Object.is((await outcome).error, reason.proxy), true); assert.equal(writes, 0); assert.equal(writable.locked, false);
		const retiring = writable.abort(reason.proxy); await abortEntered.promise; assert.equal(await remainsPending(retiring), true);
		abortRelease.resolve(); await retiring;
	} finally { release.resolve(); abortRelease.resolve(); await outcome; await f.close(); }
});
