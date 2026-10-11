/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoMediaStoreV1, PHOTO_MEDIA_NAMESPACES_V1 as MEDIA } from '../src/lightscaper/storage/photo-media-store.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { controlledLocks, installAcquisitionPlatform, observed, WriterAcquisitionFixture } from './helpers/lightscaper-opfs-writer-acquisition-fixture.ts';
import { openDatabase, request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { assertPriorUnchanged, captureOriginalPrefix, digest, enteredOrOutcome, enumerableFactory, installDirectoryModel,
	ORIGINAL_BYTES, pathLeases, replayOriginalPrefix, taskTurns } from './helpers/lightscaper-opfs-original-staging-fixture.ts';
import { deferred } from './helpers/async-test-control.ts';
import { BrowserFileStorageError } from '../src/common/editor/web-file-limit-failure.ts';

const OPTIONS = { concurrency: false, timeout: 5_000 };
const BYTES = Uint8Array.of(17, 61, 149, 233);

// Real selected PhotoMediaStore/MediaRepository and Worker runtime, with explicit
// Node IDB/FileSystem/Worker ports. This is not a native browser crash proof.
test('whole-Blob ownership records its directory witness before actual OPFS path creation returns', OPTIONS, async () => {
	const fixture = new WriterAcquisitionFixture(), native = mediaRestoreFixture(), locks = controlledLocks();
	const reset = installAcquisitionPlatform(fixture, locks), media = new PhotoMediaStoreV1({ indexedDB: enumerableFactory(native), locks });
	const model = installDirectoryModel(fixture);
	let writing: ReturnType<typeof observed<Record<string, unknown>>> | undefined;
	try {
		await media.ready(); fixture.arm('file');
		writing = observed(media.mediaRepository.writeAsset('original-new', new Blob([BYTES], { type: 'application/octet-stream' }),
			{ name: 'original-new.bin', mimeType: 'application/octet-stream' }));
		await Promise.race([fixture.entered.promise, writing.then(result => {
			if (!result.ok) throw result.error;
			throw new Error('Actual original write settled without entering path creation.');
		})]);
		assert.ok(fixture.path); assert.equal(fixture.files.has(fixture.path), true);
		assert.equal(fixture.file().bytes.byteLength, 0); assert.deepEqual(fixture.file().calls, []);
		const records = native.raw(MEDIA.databaseName).records(MEDIA.databaseName, 'mediaAssetStaging') as unknown[];
		const leases = records.filter(value => value !== null && typeof value === 'object' && 'kind' in value && value.kind === 'lease');
		assert.equal(leases.length, 1, 'An actual created path must already have exactly one durable owner lease.');
		const lease = leases[0]; assert.ok(lease !== null && typeof lease === 'object');
		assert.ok('path' in lease); assert.equal(lease.path, fixture.path);
		assert.ok('sourceId' in lease); assert.equal(lease.sourceId, 'original-new');
		assert.ok('leaseId' in lease); assert.equal(typeof lease.leaseId, 'string');
		assert.ok('key' in lease); assert.equal(lease.key, `lease:${String(lease.leaseId)}`);
		assert.ok('generation' in lease); assert.equal(typeof lease.generation, 'string');
		const witnessKey = `audio-editor-opfs-directory-binding-v1:${String(lease.leaseId)}`;
		const settings = native.raw(MEDIA.databaseName).records(MEDIA.databaseName, 'settings') as Record<string, unknown>[];
		const witness = settings.find(record => record.key === witnessKey);
		assert.ok(witness, 'The actual path lease must already own its immutable persisted directory witness.');
		assert.deepEqual(Object.keys(witness).sort(), ['key', 'value']);
		const value = witness.value; assert.ok(value !== null && typeof value === 'object');
		assert.ok('directoryHandle' in value && value.directoryHandle !== null && typeof value.directoryHandle === 'object');
		assert.deepEqual(value, { schemaVersion: 1, kind: 'media-asset-opfs-directory-binding',
			leaseId: lease.leaseId, sourceId: 'original-new', path: fixture.path, directoryHandle: value.directoryHandle });
		const same: unknown = await Reflect.apply(FileSystemHandle.prototype.isSameEntry, fixture.directory, [value.directoryHandle]);
		assert.equal(same, true);
		assert.deepEqual(native.raw(MEDIA.databaseName).records(MEDIA.databaseName, 'mediaAssets'), []);
		fixture.release.resolve(); const result = await writing; assert.equal(result.ok, true);
		assert.deepEqual(fixture.file().bytes, BYTES);
		assert.deepEqual(pathLeases(native), []);
	} finally {
		fixture.releaseAll(); if (writing) await writing;
		try { await media.close(); } finally { try { await fixture.dispose(); } finally { model.reset(); reset(); } }
	}
});

test('a legacy streamed prefix without a directory witness defers intact without deleting its relative path', OPTIONS, async () => {
	const prefix = await captureOriginalPrefix(true), context = await replayOriginalPrefix(prefix);
	const witnessKey = `audio-editor-opfs-directory-binding-v1:${prefix.lease.leaseId}`;
	try {
		assert.equal((prefix.rows.get('settings') as Record<string, unknown>[]).some(record => record.key === witnessKey), false);
		await context.open().ready(); assert.deepEqual(pathLeases(context.native), [prefix.lease]);
		assert.deepEqual(context.fixture.files.get(prefix.lease.path!)?.bytes, ORIGINAL_BYTES);
		assert.equal(context.fixture.events.some(event => event.startsWith('remove-enter:')), false);
		assertPriorUnchanged(prefix, context.native, context.fixture);
	} finally { await context.dispose(); }
});

test('the same configured namespace cannot adopt a persisted lease from a distinct physical directory', OPTIONS, async () => {
	const prefix = await captureOriginalPrefix(), context = await replayOriginalPrefix(prefix, `${prefix.directoryIdentity}-distinct`);
	try {
		const currentName: unknown = Reflect.get(context.fixture.directory, 'name'); assert.equal(currentName, MEDIA.opfsDirectoryName);
		await context.open().ready(); assert.deepEqual(pathLeases(context.native), [prefix.lease]);
		assert.deepEqual(context.fixture.files.get(prefix.lease.path!)?.bytes, ORIGINAL_BYTES);
		assert.equal(context.fixture.events.some(event => event.startsWith('remove-enter:')), false);
		assertPriorUnchanged(prefix, context.native, context.fixture);
	} finally { await context.dispose(); }
});

for (const fault of ['missing', 'corrupt', 'unbranded'] as const) test(`a ${fault} persisted directory witness retains the exact path and lease`, OPTIONS, async () => {
	const prefix = await captureOriginalPrefix(), context = await replayOriginalPrefix(prefix);
	const key = `audio-editor-opfs-directory-binding-v1:${prefix.lease.leaseId}`;
	try {
		const binding = (context.native.raw(MEDIA.databaseName).records(MEDIA.databaseName, 'settings') as Record<string, unknown>[]).find(row => row.key === key);
		assert.ok(binding); const value = binding.value as Record<string, unknown>;
		if (fault === 'missing') await context.native.remove(MEDIA.databaseName, 'settings', key);
		else context.native.raw(MEDIA.databaseName).seedRecord(MEDIA.databaseName, 'settings', { ...binding, value: fault === 'corrupt'
			? { ...value, sourceId: 'different-source' } : { ...value, directoryHandle: { kind: 'directory', name: MEDIA.opfsDirectoryName } } });
		await context.open().ready(); assert.deepEqual(pathLeases(context.native), [prefix.lease]);
		assert.deepEqual(context.fixture.files.get(prefix.lease.path!)?.bytes, ORIGINAL_BYTES);
		assert.equal(context.fixture.events.some(event => event.startsWith('remove-enter:')), false);
		assertPriorUnchanged(prefix, context.native, context.fixture);
	} finally { await context.dispose(); }
});

test('a controlled native DataCloneError falls back to an immutable body before any OPFS creation', OPTIONS, async () => {
	const fixture = new WriterAcquisitionFixture(), native = mediaRestoreFixture(), locks = controlledLocks();
	const reset = installAcquisitionPlatform(fixture, locks), model = installDirectoryModel(fixture);
	const media = new PhotoMediaStoreV1({ indexedDB: enumerableFactory(native), locks });
	try {
		await media.ready(); model.refuseNextClone();
		const record = await media.mediaRepository.writeAsset('original-clone-refused', new Blob([BYTES]));
		assert.equal(record.storage, 'indexeddb-blob'); assert.equal(record.sha256, digest(BYTES));
		assert.equal(fixture.files.size, 0); assert.equal(fixture.events.some(event => event.startsWith('file:')), false);
		assert.deepEqual(pathLeases(native), []);
		assert.equal((native.raw(MEDIA.databaseName).records(MEDIA.databaseName, 'settings') as Record<string, unknown>[]).some(row => String(row.key).startsWith('audio-editor-opfs-directory-binding-v1:')), false);
		const loaded = await media.mediaRepository.loadAsset('original-clone-refused'); assert.ok(loaded);
		assert.deepEqual(new Uint8Array(await loaded.arrayBuffer()), BYTES);
	} finally { try { await media.close(); } finally { try { await fixture.dispose(); } finally { model.reset(); reset(); } } }
});

test('whole-Blob metadata publication consumes its real lease in the same native transaction', OPTIONS, async () => {
	const fixture = new WriterAcquisitionFixture(), native = mediaRestoreFixture(), locks = controlledLocks();
	const reset = installAcquisitionPlatform(fixture, locks), media = new PhotoMediaStoreV1({ indexedDB: enumerableFactory(native), locks });
	const model = installDirectoryModel(fixture);
	const publications: string[][] = [];
	native.observeTransactions((_transaction, stores, mode) => {
		const names = typeof stores === 'string' ? [stores] : [...stores];
		if (mode === 'readwrite' && names.includes('mediaAssets')) publications.push(names);
	});
	try {
		await media.ready(); const record = await media.mediaRepository.writeAsset('original-new', new Blob([BYTES]), { name: 'original-new.bin' });
		assert.equal(record.storage, 'opfs'); assert.equal(record.sha256, digest(BYTES));
		assert.equal(record.size, BYTES.byteLength);
		assert.equal(publications.length, 1); assert.ok(publications[0]!.includes('mediaAssetStaging'));
		assert.ok(publications[0]!.includes('catalogOriginalRoots')); assert.ok(publications[0]!.includes('settings')); assert.deepEqual(pathLeases(native), []);
		const stored = native.raw(MEDIA.databaseName).records(MEDIA.databaseName, 'mediaAssets') as Record<string, unknown>[];
		assert.equal(stored.length, 1); assert.equal(typeof stored[0]!.mediaContentToken, 'string');
		assert.equal(stored[0]!.sha256, record.sha256); assert.equal(stored[0]!.path, record.path);
		assert.ok(typeof record.path === 'string'); assert.deepEqual(fixture.files.get(record.path)?.bytes, BYTES);
	} finally { native.observeTransactions(null); try { await media.close(); } finally { try { await fixture.dispose(); } finally { model.reset(); reset(); } } }
});

test('a real lease-delete request failure rolls back the immutable add before joined exact cleanup', OPTIONS, async () => {
	const fixture = new WriterAcquisitionFixture(), native = mediaRestoreFixture(), locks = controlledLocks();
	const reset = installAcquisitionPlatform(fixture, locks), media = new PhotoMediaStoreV1({ indexedDB: enumerableFactory(native), locks });
	const model = installDirectoryModel(fixture);
	let writing: ReturnType<typeof observed<Record<string, unknown>>> | undefined;
	try {
		await media.ready(); fixture.arm('file');
		writing = observed(media.mediaRepository.writeAsset('original-new', new Blob([BYTES])));
		await enteredOrOutcome(fixture.entered.promise, writing);
		const lease = pathLeases(native)[0]; assert.ok(lease); assert.equal(lease.path, fixture.path);
		const failure = new DOMException('Controlled real lease-delete failure.', 'UnknownError');
		native.raw(MEDIA.databaseName).failNextDeleteForStore('mediaAssetStaging', failure);
		fixture.release.resolve(); await enteredOrOutcome(fixture.removalEntered.promise, writing);
		assert.deepEqual(native.raw(MEDIA.databaseName).records(MEDIA.databaseName, 'mediaAssets'), []);
		assert.deepEqual(pathLeases(native), [lease]); assert.deepEqual(fixture.file().bytes, BYTES);
		fixture.removalRelease.resolve(); const result = await writing; assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.error, failure);
		assert.deepEqual(pathLeases(native), []); assert.equal(fixture.files.has(lease.path!), false);
	} finally {
		fixture.releaseAll(); if (writing) await writing;
		try { await media.close(); } finally { try { await fixture.dispose(); } finally { model.reset(); reset(); } }
	}
});

test('an opaque noncancelled fallback acquisition failure retains its exact cause through owned path cleanup', OPTIONS, async () => {
	const fixture = new WriterAcquisitionFixture(), native = mediaRestoreFixture(), locks = controlledLocks();
	const reset = installAcquisitionPlatform(fixture, locks), reading = fixture.directory.getFileHandle;
	const model = installDirectoryModel(fixture);
	const opaque = Proxy.revocable({}, {}); opaque.revoke();
	fixture.directory.getFileHandle = async (path, options = {}) => {
		const acquired = await reading(path, options);
		if (options.create) throw opaque.proxy;
		return acquired;
	};
	const media = new PhotoMediaStoreV1({ indexedDB: enumerableFactory(native), locks, syncWorkerClient: null });
	try {
		await media.ready(); fixture.arm('file'); fixture.release.resolve(); fixture.removalRelease.resolve();
		const result = await observed(media.mediaRepository.writeAsset('original-new', new Blob([BYTES])));
		assert.equal(result.ok, false);
		if (!result.ok) { assert.ok(result.error instanceof BrowserFileStorageError); assert.equal(result.error.cause, opaque.proxy); }
		assert.ok(fixture.path); assert.equal(fixture.files.has(fixture.path), false);
		assert.deepEqual(fixture.file().calls, []); assert.deepEqual(pathLeases(native), []);
		assert.deepEqual(native.raw(MEDIA.databaseName).records(MEDIA.databaseName, 'mediaAssets'), []);
	} finally {
		fixture.directory.getFileHandle = reading; fixture.releaseAll();
		try { await media.close(); } finally { try { await fixture.dispose(); } finally { model.reset(); reset(); } }
	}
});

test('stopped-owner readiness reclaims only its captured orphan and retains a committed unrooted original across reopens', OPTIONS, async () => {
	const prefix = await captureOriginalPrefix(), context = await replayOriginalPrefix(prefix);
	try {
		const media = context.open(); await media.ready();
		assert.equal(context.fixture.files.has(prefix.lease.path!), false); assert.deepEqual(pathLeases(context.native), []);
		assertPriorUnchanged(prefix, context.native, context.fixture);
		await media.close(); const again = context.open(); await again.ready();
		assert.deepEqual(pathLeases(context.native), []); assertPriorUnchanged(prefix, context.native, context.fixture);
		const loaded = await again.mediaRepository.loadAsset('original-prior'); assert.ok(loaded);
		assert.equal(digest(new Uint8Array(await loaded.arrayBuffer())), prefix.prior.sha256);
		assert.deepEqual(await again.mediaRepository.getAssetMetadata('original-prior'), prefix.priorMetadata);
		assert.equal(context.fixture.events.filter(event => event === `remove-enter:${prefix.lease.path}`).length, 1);
	} finally { await context.dispose(); }
});

test('expired path evidence remains durable until stopped-owner exact cleanup, rather than age abandonment', OPTIONS, async () => {
	const prefix = await captureOriginalPrefix(), context = await replayOriginalPrefix(prefix);
	try {
		const expired = { ...prefix.lease, createdAt: 1, updatedAt: 2, expiresAt: 3 };
		context.native.raw(MEDIA.databaseName).seedRecord(MEDIA.databaseName, 'mediaAssetStaging', expired);
		// The real public streamed writer queries staging before opening another path.
		const media = context.open(); const writer = await media.mediaRepository.beginAssetWrite('original-another', {},
			{ expectedBytes: ORIGINAL_BYTES.byteLength, expectedSha256: digest(ORIGINAL_BYTES) });
		try {
			assert.deepEqual(pathLeases(context.native).find(lease => lease.key === expired.key), expired);
			assert.deepEqual(context.fixture.files.get(expired.path!)?.bytes, ORIGINAL_BYTES);
		} finally { await writer.abort(); }
		await media.ready(); assert.equal(context.fixture.files.has(expired.path!), false);
		assertPriorUnchanged(prefix, context.native, context.fixture);
	} finally { await context.dispose(); }
});

test('readiness and Close join an exact removal past the real worker deadline, with the lease retained while held', OPTIONS, async () => {
	const prefix = await captureOriginalPrefix(), context = await replayOriginalPrefix(prefix);
	context.fixture.path = prefix.lease.path!;
	const { client, worker } = context.fixture.client(10), media = context.open({ syncWorkerClient: client });
	let readySettled = false, closeSettled = false;
	try {
		const ready = context.track(media.ready()); void ready.then(() => { readySettled = true; });
		await enteredOrOutcome(context.fixture.removalEntered.promise, ready);
		const closing = context.track(media.close()); void closing.then(() => { closeSettled = true; });
		await taskTurns(30);
		assert.equal(readySettled, false); assert.equal(closeSettled, false); assert.equal(worker.terminated, 0);
		assert.deepEqual(pathLeases(context.native), [prefix.lease]);
		assert.deepEqual(context.fixture.files.get(prefix.lease.path!)?.bytes, ORIGINAL_BYTES);
		assertPriorUnchanged(prefix, context.native, context.fixture);
		context.fixture.removalRelease.resolve(); await ready; const closed = await closing; assert.equal(closed.ok, true);
		assert.equal(context.fixture.files.has(prefix.lease.path!), false); assert.deepEqual(pathLeases(context.native), []);
		assert.equal(worker.terminated, 1);
	} finally { await context.dispose(); }
});

test('failed physical cleanup retains exact durable evidence and the next readiness retries it', OPTIONS, async () => {
	const prefix = await captureOriginalPrefix(), context = await replayOriginalPrefix(prefix);
	context.fixture.path = prefix.lease.path!; context.fixture.removeFailure = new Error('Real controlled removal refused.');
	context.fixture.removalRelease.resolve();
	try {
		const media = context.open(), first = await observed(media.ready());
		assert.equal(first.ok, false); assert.deepEqual(pathLeases(context.native), [prefix.lease]);
		assert.deepEqual(context.fixture.files.get(prefix.lease.path!)?.bytes, ORIGINAL_BYTES);
		assertPriorUnchanged(prefix, context.native, context.fixture);
		context.fixture.removeFailure = undefined; await media.ready();
		assert.deepEqual(pathLeases(context.native), []); assert.equal(context.fixture.files.has(prefix.lease.path!), false);
		assertPriorUnchanged(prefix, context.native, context.fixture);
	} finally { await context.dispose(); }
});

test('a genuine lease renewal during held physical cleanup prevents stale CAS consumption and retries safely', OPTIONS, async () => {
	const prefix = await captureOriginalPrefix(), context = await replayOriginalPrefix(prefix);
	context.fixture.path = prefix.lease.path!;
	try {
		const media = context.open(), ready = context.track(media.ready());
		await enteredOrOutcome(context.fixture.removalEntered.promise, ready);
		const changed = { ...prefix.lease, updatedAt: prefix.lease.updatedAt + 1, expiresAt: prefix.lease.expiresAt + 1 };
		const database = await openDatabase(context.factory, MEDIA.databaseName);
		try { await transact(database, 'mediaAssetStaging', 'readwrite', stores => request(stores.mediaAssetStaging!.put(changed))); }
		finally { database.close(); }
		context.fixture.removalRelease.resolve(); const result = await ready; assert.equal(result.ok, false);
		assert.deepEqual(pathLeases(context.native), [changed]); assert.equal(context.fixture.files.has(changed.path!), false);
		assertPriorUnchanged(prefix, context.native, context.fixture);
		await media.ready(); assert.deepEqual(pathLeases(context.native), []);
	} finally { await context.dispose(); }
});

test('an existing immutable source refuses a new body while retaining exact original bytes, metadata and private token', OPTIONS, async () => {
	const prefix = await captureOriginalPrefix(), context = await replayOriginalPrefix(prefix);
	try {
		const result = await observed(context.open().mediaRepository.writeAsset('original-prior', new Blob([ORIGINAL_BYTES]), { name: 'replacement.bin' }));
		assert.equal(result.ok, false); assertPriorUnchanged(prefix, context.native, context.fixture);
		assert.deepEqual(pathLeases(context.native), [prefix.lease]); assert.equal(context.fixture.files.size, 2);
		assert.equal(context.fixture.events.some(event => event.startsWith('remove-enter:')), false);
	} finally { await context.dispose(); }
});

test('an opaque NotFound impostor cannot certify absence or consume a real lease', OPTIONS, async () => {
	const prefix = await captureOriginalPrefix(), context = await replayOriginalPrefix(prefix);
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); const reading = context.fixture.directory.getFileHandle;
	context.fixture.directory.getFileHandle = (path, options = {}) => {
		if (path === prefix.lease.path && !options.create) return Promise.reject(opaque.proxy);
		return reading(path, options);
	};
	try {
		const media = context.open(), first = await observed(media.ready()); assert.equal(first.ok, false);
		assert.deepEqual(pathLeases(context.native), [prefix.lease]); assertPriorUnchanged(prefix, context.native, context.fixture);
		context.fixture.directory.getFileHandle = reading; await media.ready();
		assert.deepEqual(pathLeases(context.native), []); assert.equal(context.fixture.files.has(prefix.lease.path!), false);
	} finally { context.fixture.directory.getFileHandle = reading; await context.dispose(); }
});

test('a genuine native NotFound result retires the lease for an already absent captured path', OPTIONS, async () => {
	const prefix = await captureOriginalPrefix(), context = await replayOriginalPrefix(prefix);
	context.fixture.files.delete(prefix.lease.path!);
	try {
		await context.open().ready(); assert.deepEqual(pathLeases(context.native), []);
		assertPriorUnchanged(prefix, context.native, context.fixture);
	} finally { await context.dispose(); }
});

test('an actual live foreign registered owner protects the shared physical directory until its Close joins', OPTIONS, async () => {
	const prefix = await captureOriginalPrefix(), context = await replayOriginalPrefix(prefix);
	try {
		const foreignName = 'lightscaper-foreign-media-v2';
		const foreign = context.open({ databaseName: foreignName, preferOpfs: false });
		await foreign.ready(); await foreign.settingsRepository.put('foreign-owner-proof', 'live');
		const foreignMarkers = (context.native.raw(foreignName).records(foreignName, 'settings') as Record<string, unknown>[])
			.filter(record => typeof record.key === 'string' && record.key.startsWith('audio-editor-retention-session-v1:'));
		assert.equal(foreignMarkers.length, 1);
		const media = context.open(); await media.ready();
		assert.deepEqual(pathLeases(context.native), [prefix.lease]);
		assert.deepEqual(context.fixture.files.get(prefix.lease.path!)?.bytes, ORIGINAL_BYTES);
		assert.equal(context.fixture.events.some(event => event.startsWith('remove-enter:')), false);
		await foreign.close(); await media.ready();
		assert.equal(context.fixture.files.has(prefix.lease.path!), false); assert.deepEqual(pathLeases(context.native), []);
		assertPriorUnchanged(prefix, context.native, context.fixture);
	} finally { await context.dispose(); }
});

test('a closed foreign media database indexed path reference protects the candidate without an active owner', OPTIONS, async () => {
	const prefix = await captureOriginalPrefix(), context = await replayOriginalPrefix(prefix);
	const foreignName = 'lightscaper-foreign-media-v2';
	try {
		const database = await openDatabase(context.factory, foreignName);
		// Controlled persisted-reference collision: retain the actual complete
		// immutable record, changing only its source ID and physical path alias.
		const reference = { ...prefix.prior, sourceId: 'foreign-original', path: prefix.lease.path };
		try { context.native.raw(foreignName).seedRecord(foreignName, 'mediaAssets', reference); }
		finally { database.close(); }
		const media = context.open(); await media.ready();
		assert.deepEqual(pathLeases(context.native), [prefix.lease]);
		assert.deepEqual(context.native.raw(foreignName).records(foreignName, 'mediaAssets'), [reference]);
		assert.deepEqual(context.fixture.files.get(prefix.lease.path!)?.bytes, ORIGINAL_BYTES);
		assert.equal(context.fixture.events.some(event => event.startsWith('remove-enter:')), false);
		assertPriorUnchanged(prefix, context.native, context.fixture);
	} finally { await context.dispose(); }
});

test('a real lockless foreign marker stays protective after the owner closes elsewhere', OPTIONS, async () => {
	const prefix = await captureOriginalPrefix(), context = await replayOriginalPrefix(prefix);
	const foreignName = 'lightscaper-lockless-media-v2';
	try {
		const foreign = context.open({ databaseName: foreignName, locks: null, preferOpfs: false }); await foreign.ready();
		const records = context.native.raw(foreignName).records(foreignName, 'settings') as Record<string, unknown>[];
		const marker = records.find(record => typeof record.key === 'string' && record.key.startsWith('audio-editor-retention-session-v1:'));
		assert.ok(marker); assert.deepEqual(marker.value, { version: 1, owner: marker.key, webLock: false });
		await foreign.close();
		// Replay its authentic marker as a retained stopped-owner prefix. Without
		// a held Web Lock there is no proof of abandonment, regardless of time.
		context.native.raw(foreignName).seedRecord(foreignName, 'settings', marker);
		await context.open().ready(); assert.deepEqual(pathLeases(context.native), [prefix.lease]);
		assert.deepEqual(context.fixture.files.get(prefix.lease.path!)?.bytes, ORIGINAL_BYTES);
		assert.equal(context.fixture.events.some(event => event.startsWith('remove-enter:')), false);
	} finally { await context.dispose(); }
});

test('unsupported native database enumeration defers intact and retries when actual inventory is available', OPTIONS, async () => {
	const prefix = await captureOriginalPrefix(), context = await replayOriginalPrefix(prefix);
	const enumeration = context.factory.databases.bind(context.factory), failure = Symbol('native enumeration refused');
	context.factory.databases = () => Promise.reject(failure);
	try {
		const media = context.open(); await media.ready(); assert.deepEqual(pathLeases(context.native), [prefix.lease]);
		assert.deepEqual(context.fixture.files.get(prefix.lease.path!)?.bytes, ORIGINAL_BYTES);
		assert.equal(context.fixture.events.some(event => event.startsWith('remove-enter:')), false);
		context.factory.databases = enumeration; await media.ready(); assert.deepEqual(pathLeases(context.native), []);
		assertPriorUnchanged(prefix, context.native, context.fixture);
	} finally { context.factory.databases = enumeration; await context.dispose(); }
});

test('an actual unknown foreign schema defers all deletion without upgrading or creating a namespace proof', OPTIONS, async () => {
	const prefix = await captureOriginalPrefix(), context = await replayOriginalPrefix(prefix);
	const foreignName = 'unrecognized-foreign-database';
	try {
		const opening = context.factory.open(foreignName, 1);
		const foreign = await new Promise<IDBDatabase>((resolve, reject) => {
			opening.onsuccess = () => { resolve(opening.result); }; opening.onerror = () => { reject(opening.error); };
		}); foreign.close();
		await context.open().ready(); assert.deepEqual(pathLeases(context.native), [prefix.lease]);
		assert.deepEqual(context.fixture.files.get(prefix.lease.path!)?.bytes, ORIGINAL_BYTES);
		const info = await context.factory.databases(); assert.equal(info.find(value => value.name === foreignName)?.version, 1);
		assert.equal(context.fixture.events.some(event => event.startsWith('remove-enter:')), false);
	} finally { await context.dispose(); }
});

test('a genuinely changed native database inventory defers the first pass before any destructive call', OPTIONS, async () => {
	const prefix = await captureOriginalPrefix(), context = await replayOriginalPrefix(prefix);
	const enumeration = context.factory.databases.bind(context.factory); let changed = false;
	context.factory.databases = async () => {
		const snapshot = await enumeration();
		if (!changed) { changed = true; const opened = await openDatabase(context.factory, 'lightscaper-added-media-v2'); opened.close(); }
		return snapshot;
	};
	try {
		const media = context.open(); await media.ready(); assert.equal(changed, true);
		assert.deepEqual(pathLeases(context.native), [prefix.lease]);
		assert.deepEqual(context.fixture.files.get(prefix.lease.path!)?.bytes, ORIGINAL_BYTES);
		assert.equal(context.fixture.events.some(event => event.startsWith('remove-enter:')), false);
		context.factory.databases = enumeration; await media.ready(); assert.deepEqual(pathLeases(context.native), []);
	} finally { context.factory.databases = enumeration; await context.dispose(); }
});

test('65 actual registered databases exceed the bounded complete inventory and defer without partial deletion', OPTIONS, async () => {
	const prefix = await captureOriginalPrefix(), context = await replayOriginalPrefix(prefix);
	try {
		for (let index = 0; index < 64; index++) {
			const database = await openDatabase(context.factory, `lightscaper-inventory-${index}`); database.close();
		}
		assert.equal((await context.factory.databases()).length, 65);
		await context.open().ready(); assert.deepEqual(pathLeases(context.native), [prefix.lease]);
		assert.deepEqual(context.fixture.files.get(prefix.lease.path!)?.bytes, ORIGINAL_BYTES);
		assert.equal(context.fixture.events.some(event => event.startsWith('remove-enter:')), false);
		assertPriorUnchanged(prefix, context.native, context.fixture);
	} finally { await context.dispose(); }
});

test('same-instance admitted hashing without a path identity defers startup cleanup without cancelling the write', OPTIONS, async () => {
	const prefix = await captureOriginalPrefix(), context = await replayOriginalPrefix(prefix);
	const entered = deferred<void>(), release = deferred<void>(), descriptor = Object.getOwnPropertyDescriptor(Blob.prototype, 'arrayBuffer');
	assert.ok(descriptor); const read = Blob.prototype.arrayBuffer; let held = false;
	Object.defineProperty(Blob.prototype, 'arrayBuffer', { ...descriptor, value: async function (this: Blob) {
		const buffer = await read.call(this);
		if (!held) { held = true; entered.resolve(); await release.promise; }
		return buffer;
	} });
	try {
		const media = context.open(), writing = context.track(media.mediaRepository.writeAsset('original-concurrent', new Blob([BYTES])));
		await enteredOrOutcome(entered.promise, writing); assert.deepEqual(pathLeases(context.native), [prefix.lease]);
		await media.ready(); assert.deepEqual(pathLeases(context.native), [prefix.lease]);
		assert.equal(context.fixture.events.some(event => event.startsWith('remove-enter:')), false);
		assert.deepEqual(context.fixture.files.get(prefix.lease.path!)?.bytes, ORIGINAL_BYTES);
		release.resolve(); const result = await writing; assert.equal(result.ok, true);
		await media.ready(); assert.deepEqual(pathLeases(context.native), []);
		assert.equal(context.fixture.files.has(prefix.lease.path!), false); assertPriorUnchanged(prefix, context.native, context.fixture);
	} finally { release.resolve(); Object.defineProperty(Blob.prototype, 'arrayBuffer', descriptor); await context.dispose(); }
});

test('same-instance open streamed writer stays live while readiness defers destructive maintenance', OPTIONS, async () => {
	const prefix = await captureOriginalPrefix(), context = await replayOriginalPrefix(prefix);
	const media = context.open(); let writer: Awaited<ReturnType<typeof media.mediaRepository.beginAssetWrite>> | undefined;
	try {
		writer = await media.mediaRepository.beginAssetWrite('original-live', {},
			{ expectedBytes: ORIGINAL_BYTES.byteLength, expectedSha256: digest(ORIGINAL_BYTES) });
		await writer.write(ORIGINAL_BYTES); const before = pathLeases(context.native); assert.equal(before.length, 2);
		await media.ready(); assert.deepEqual(pathLeases(context.native), before);
		assert.equal(context.fixture.events.some(event => event.startsWith('remove-enter:')), false);
		const published = await writer.commit(); assert.equal(published.sourceId, 'original-live');
		await media.ready(); assert.deepEqual(pathLeases(context.native), []);
		assert.equal(context.fixture.files.has(prefix.lease.path!), false); assertPriorUnchanged(prefix, context.native, context.fixture);
	} finally { try { await writer?.abort(); } finally { await context.dispose(); } }
});

test('a malformed captured path lease defers all deletion and preserves its exact evidence', OPTIONS, async () => {
	const prefix = await captureOriginalPrefix(), context = await replayOriginalPrefix(prefix);
	const malformed = { ...prefix.lease, path: '../outside-owned-directory' };
	context.native.raw(MEDIA.databaseName).seedRecord(MEDIA.databaseName, 'mediaAssetStaging', malformed);
	try {
		await context.open().ready(); assert.deepEqual(pathLeases(context.native), [malformed]);
		assert.deepEqual(context.fixture.files.get(prefix.lease.path!)?.bytes, ORIGINAL_BYTES);
		assert.equal(context.fixture.events.some(event => event.startsWith('remove-enter:')), false);
		assertPriorUnchanged(prefix, context.native, context.fixture);
	} finally { await context.dispose(); }
});

test('conflicting durable leases for one exact path refuse the complete prefix before partial deletion', OPTIONS, async () => {
	const prefix = await captureOriginalPrefix(), context = await replayOriginalPrefix(prefix);
	const conflict = { ...prefix.lease, key: 'lease:conflicting-owner', leaseId: 'conflicting-owner', sourceId: 'other-source' };
	context.native.raw(MEDIA.databaseName).seedRecord(MEDIA.databaseName, 'mediaAssetStaging', conflict);
	try {
		const before = pathLeases(context.native); assert.equal(before.length, 2);
		await context.open().ready(); assert.deepEqual(pathLeases(context.native), before);
		assert.deepEqual(context.fixture.files.get(prefix.lease.path!)?.bytes, ORIGINAL_BYTES);
		assert.equal(context.fixture.events.some(event => event.startsWith('remove-enter:')), false);
	} finally { await context.dispose(); }
});

test('65 captured durable leases refuse the full prefix instead of cleaning the first 64', OPTIONS, async () => {
	const prefix = await captureOriginalPrefix(), context = await replayOriginalPrefix(prefix);
	try {
		for (let index = 0; index < 64; index++) {
			const leaseId = `captured-owner-${index}`, path = `captured-orphan-${index}.blob`;
			context.native.raw(MEDIA.databaseName).seedRecord(MEDIA.databaseName, 'mediaAssetStaging',
				{ ...prefix.lease, key: `lease:${leaseId}`, leaseId, sourceId: `orphan-${index}`, path });
			context.fixture.seed(path, ORIGINAL_BYTES);
		}
		const before = pathLeases(context.native); assert.equal(before.length, 65);
		await context.open().ready(); assert.deepEqual(pathLeases(context.native), before);
		assert.equal(context.fixture.files.size, 66);
		assert.equal(context.fixture.events.some(event => event.startsWith('remove-enter:')), false);
		assertPriorUnchanged(prefix, context.native, context.fixture);
	} finally { await context.dispose(); }
});

test('65 authentic-shaped stopped-owner markers refuse bounded ownership proof without age abandonment', OPTIONS, async () => {
	const prefix = await captureOriginalPrefix(), context = await replayOriginalPrefix(prefix);
	const marker = (prefix.rows.get('settings') as Record<string, unknown>[])
		.find(record => typeof record.key === 'string' && record.key.startsWith('audio-editor-retention-session-v1:'));
	assert.ok(marker);
	try {
		for (let index = 0; index < 64; index++) {
			const key = `audio-editor-retention-session-v1:retained-owner-${index}`;
			context.native.raw(MEDIA.databaseName).seedRecord(MEDIA.databaseName, 'settings', { ...marker, key,
				value: { version: 1, owner: key, webLock: true } });
		}
		const before = context.native.raw(MEDIA.databaseName).records(MEDIA.databaseName, 'settings') as Record<string, unknown>[];
		await context.open().ready(); assert.deepEqual(pathLeases(context.native), [prefix.lease]);
		const after = context.native.raw(MEDIA.databaseName).records(MEDIA.databaseName, 'settings') as Record<string, unknown>[];
		for (const record of before) assert.deepEqual(after.find(value => value.key === record.key), record);
		assert.deepEqual(context.fixture.files.get(prefix.lease.path!)?.bytes, ORIGINAL_BYTES);
		assert.equal(context.fixture.events.some(event => event.startsWith('remove-enter:')), false);
	} finally { await context.dispose(); }
});

test('a changed current own retention marker cannot authorize deletion despite its still-held lock', OPTIONS, async () => {
	const prefix = await captureOriginalPrefix(), context = await replayOriginalPrefix(prefix);
	try {
		const media = context.open(); await media.settingsRepository.put('local-setup-proof', 'entered');
		const capturedKeys = new Set((prefix.rows.get('settings') as Record<string, unknown>[]).map(record => record.key));
		const records = context.native.raw(MEDIA.databaseName).records(MEDIA.databaseName, 'settings') as Record<string, unknown>[];
		const own = records.find(record => typeof record.key === 'string'
			&& record.key.startsWith('audio-editor-retention-session-v1:') && !capturedKeys.has(record.key));
		assert.ok(own); const changed = { ...own, value: { version: 1, owner: own.key, webLock: true, foreign: true } };
		context.native.raw(MEDIA.databaseName).seedRecord(MEDIA.databaseName, 'settings', changed);
		await media.ready(); assert.deepEqual(pathLeases(context.native), [prefix.lease]);
		assert.deepEqual(context.fixture.files.get(prefix.lease.path!)?.bytes, ORIGINAL_BYTES);
		assert.equal(context.fixture.events.some(event => event.startsWith('remove-enter:')), false);
	} finally { await context.dispose(); }
});
