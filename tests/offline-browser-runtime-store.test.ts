/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BROWSER_FFMPEG_RUNTIME_CACHE_PREFIX,
	createBrowserFfmpegRuntimeStore,
} from '../src/common/offline/browser-runtime-store.ts';
import {
	completionTrackedRuntimeResponse,
	install,
	MemoryCacheStorage,
	MemoryLockManager,
	release,
	runtimeBodyForFile,
	runtimeResponse,
	sequence,
	stagedTransaction,
	STREAM_CACHE_PROBE_SUFFIX,
} from './helpers/offline-browser-runtime-store-fixture.ts';

test('browser runtime probes stream-backed Cache.put once and keeps it as the primary staging path', async () => {
	const cacheStorage = new MemoryCacheStorage();
	let probeAttempts = 0;
	cacheStorage.failPut = (_cacheName, key) => {
		if (key.endsWith(STREAM_CACHE_PROBE_SUFFIX)) probeAttempts += 1;
		return null;
	};
	const store = createBrowserFfmpegRuntimeStore({
		cacheStorage,
		lockManager: new MemoryLockManager(),
		origin: 'https://soundscaper.org',
		randomUUID: sequence('stream-primary-one', 'stream-primary-two'),
	});

	await install(store, release('e'));
	await install(store, release('f'));

	assert.equal(probeAttempts, 1);
	assert.equal(cacheStorage.probeMatchCount, 1);
	assert.equal((await store.readActive())?.releaseId, release('f').releaseId);
});

test('browser runtime falls back when Cache.put settles at the declared length before stream completion', async () => {
	const cacheStorage = new MemoryCacheStorage();
	let runtimeStreamCompleted = false;
	let runtimeWasCompleteWhenStaging = false;
	cacheStorage.settlePutAfterFirstChunk = (_cacheName, key) => key.endsWith(STREAM_CACHE_PROBE_SUFFIX);
	cacheStorage.beforePut = (_cacheName, key) => {
		if (key.endsWith('/ffmpeg-core.js')) runtimeWasCompleteWhenStaging = runtimeStreamCompleted;
	};
	const store = createBrowserFfmpegRuntimeStore({
		cacheStorage,
		lockManager: new MemoryLockManager(),
		origin: 'https://soundscaper.org',
		randomUUID: () => 'early-cache-put-settlement',
	});
	const installed = release('f');
	const transaction = await store.begin(installed);
	await transaction.put(installed.files[0]!, completionTrackedRuntimeResponse(
		installed.files[0]!,
		() => { runtimeStreamCompleted = true; },
	));
	await transaction.put(installed.files[1]!, runtimeResponse(installed.files[1]!));
	await transaction.commit();

	assert.equal(cacheStorage.probeMatchCount, 0);
	assert.equal(runtimeWasCompleteWhenStaging, true);
	assert.equal((await store.readActive())?.releaseId, installed.releaseId);
});

test('browser runtime falls back to bounded byte-backed staging when stream Cache.put is unsupported', async () => {
	const cacheStorage = new MemoryCacheStorage();
	let probeAttempts = 0;
	cacheStorage.failPut = (_cacheName, key) => {
		if (!key.endsWith(STREAM_CACHE_PROBE_SUFFIX)) return null;
		probeAttempts += 1;
		return new TypeError('Stream-backed Cache.put is unsupported.');
	};
	const store = createBrowserFfmpegRuntimeStore({
		cacheStorage,
		lockManager: new MemoryLockManager(),
		origin: 'https://soundscaper.org',
		randomUUID: () => 'byte-backed-fallback',
	});
	const installed = release('f');

	await install(store, installed);

	assert.equal(probeAttempts, 1);
	assert.equal((await store.readActive())?.releaseId, installed.releaseId);
});

test('browser runtime stream probe does not mask CacheStorage quota failures', async () => {
	const cacheStorage = new MemoryCacheStorage();
	cacheStorage.failPut = (_cacheName, key) => key.endsWith(STREAM_CACHE_PROBE_SUFFIX)
		? new DOMException('Injected CacheStorage quota exhaustion.', 'QuotaExceededError')
		: null;
	const store = createBrowserFfmpegRuntimeStore({
		cacheStorage,
		lockManager: new MemoryLockManager(),
		origin: 'https://soundscaper.org',
		randomUUID: () => 'quota-failure',
	});
	const candidate = release('f');
	const transaction = await store.begin(candidate);

	await assert.rejects(
		transaction.put(candidate.files[0]!, runtimeResponse(candidate.files[0]!)),
		(error: unknown) => error instanceof DOMException && error.name === 'QuotaExceededError',
	);
	await transaction.rollback();
	assert.deepEqual(cacheStorage.keysSync(), []);
});

test('browser runtime byte-backed fallback refuses a body beyond its declared bound', async () => {
	const cacheStorage = new MemoryCacheStorage();
	cacheStorage.failPut = (_cacheName, key) => key.endsWith(STREAM_CACHE_PROBE_SUFFIX)
		? new TypeError('Stream-backed Cache.put is unsupported.')
		: null;
	const store = createBrowserFfmpegRuntimeStore({
		cacheStorage,
		lockManager: new MemoryLockManager(),
		origin: 'https://soundscaper.org',
		randomUUID: () => 'bounded-fallback',
	});
	const candidate = release('f');
	const transaction = await store.begin(candidate);
	const runtimeFile = candidate.files[0]!;
	const expectedBody = runtimeBodyForFile(runtimeFile);
	const oversizedBody = new Uint8Array(expectedBody.byteLength + 1);
	oversizedBody.set(expectedBody);

	await assert.rejects(
		transaction.put(runtimeFile, runtimeResponse(runtimeFile, oversizedBody)),
		/exceeds its verified byte length/u,
	);
	await transaction.rollback();
	assert.deepEqual(cacheStorage.keysSync(), []);
});

test('browser runtime refuses candidates above the 64 MiB file bound before staging', async () => {
	const store = createBrowserFfmpegRuntimeStore({
		cacheStorage: new MemoryCacheStorage(),
		lockManager: new MemoryLockManager(),
		origin: 'https://soundscaper.org',
		randomUUID: () => 'oversized-candidate',
	});
	const candidate = release('f');
	const oversized = {
		...candidate,
		files: [
			{ ...candidate.files[0]!, byteLength: 64 * 1024 * 1024 + 1 },
			candidate.files[1]!,
		],
	};

	await assert.rejects(store.begin(oversized), /ffmpeg-core\.js byte length is invalid/u);
});

test('browser runtime commit publishes metadata last and retains one previous complete release', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const store = createBrowserFfmpegRuntimeStore({
		cacheStorage,
		lockManager: new MemoryLockManager(),
		origin: 'https://soundscaper.org',
		randomUUID: sequence('candidate-one', 'candidate-two'),
	});
	const first = release('1');
	const second = release('2');

	await install(store, first);
	await install(store, second);

	assert.equal((await store.readActive())?.releaseId, second.releaseId);
	const activeFile = second.files[0]!;
	const alteredBody = runtimeBodyForFile(activeFile).map((value) => value ^ 0xff);
	cacheStorage.replaceEntry(activeFile.url, runtimeResponse(activeFile, alteredBody));
	assert.equal(
		(await store.readActive())?.releaseId,
		first.releaseId,
		'an exact-length active body with the wrong digest falls back to the retained previous release',
	);
	assert.deepEqual(cacheStorage.keysSync().sort(), [
		`${BROWSER_FFMPEG_RUNTIME_CACHE_PREFIX}${first.releaseId}`,
		`${BROWSER_FFMPEG_RUNTIME_CACHE_PREFIX}${second.releaseId}`,
		`${BROWSER_FFMPEG_RUNTIME_CACHE_PREFIX}state`,
	].sort());
	assert.equal(cacheStorage.events.at(-1), `delete:${BROWSER_FFMPEG_RUNTIME_CACHE_PREFIX}candidate-candidate-two`);
});

test('browser runtime commit refuses an incomplete candidate without replacing active metadata', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const store = createBrowserFfmpegRuntimeStore({
		cacheStorage,
		lockManager: new MemoryLockManager(),
		origin: 'https://soundscaper.org',
		randomUUID: sequence('first', 'incomplete'),
	});
	const first = release('3');
	await install(store, first);

	const candidate = release('4');
	const transaction = await store.begin(candidate);
	await transaction.put(candidate.files[0]!, runtimeResponse(candidate.files[0]!));
	await assert.rejects(transaction.commit(), /missing.*ffmpeg-core\.wasm/u);
	await transaction.rollback();

	assert.equal((await store.readActive())?.releaseId, first.releaseId);
	assert.equal(cacheStorage.keysSync().some((name) => name.includes(candidate.releaseId)), false);
});

test('encoded cached bodies are not accepted as normalized complete releases', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const store = createBrowserFfmpegRuntimeStore({
		cacheStorage,
		lockManager: new MemoryLockManager(),
		origin: 'https://soundscaper.org',
		randomUUID: sequence('encoded-first', 'encoded-second'),
	});
	const first = release('d');
	const second = release('e');
	await install(store, first);
	await install(store, second);
	const activeFile = second.files[0]!;
	const encoded = runtimeResponse(activeFile);
	encoded.headers.set('content-encoding', 'gzip');
	cacheStorage.replaceEntry(activeFile.url, encoded);

	assert.equal((await store.readActive())?.releaseId, first.releaseId);
});

test('a failed final-cache copy leaves the prior release active and removes the partial final cache', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const store = createBrowserFfmpegRuntimeStore({
		cacheStorage,
		lockManager: new MemoryLockManager(),
		origin: 'https://soundscaper.org',
		randomUUID: sequence('first', 'copy-failure'),
	});
	const first = release('5');
	await install(store, first);

	const candidate = release('6');
	cacheStorage.failPut = (cacheName, key) => (
		cacheName === `${BROWSER_FFMPEG_RUNTIME_CACHE_PREFIX}${candidate.releaseId}`
		&& key.endsWith('/ffmpeg-core.wasm')
			? new Error('simulated final cache quota failure')
			: null
	);
	const transaction = await store.begin(candidate);
	for (const file of candidate.files) await transaction.put(file, runtimeResponse(file));
	await assert.rejects(transaction.commit(), /simulated final cache quota failure/u);
	await transaction.rollback();

	assert.equal((await store.readActive())?.releaseId, first.releaseId);
	assert.equal(cacheStorage.keysSync().includes(`${BROWSER_FFMPEG_RUNTIME_CACHE_PREFIX}${candidate.releaseId}`), false);
});

test('browser runtime transactions reject unknown files and rollback only their isolated candidate', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const store = createBrowserFfmpegRuntimeStore({
		cacheStorage,
		lockManager: new MemoryLockManager(),
		origin: 'https://soundscaper.org',
		randomUUID: () => 'isolated',
	});
	const candidate = release('7');
	const transaction = await store.begin(candidate);
	const unknown = { ...candidate.files[0]!, name: 'other.js' };

	await assert.rejects(
		transaction.put(unknown, runtimeResponse(candidate.files[0]!)),
		/does not belong to the candidate release/u,
	);
	await transaction.rollback();
	assert.deepEqual(cacheStorage.keysSync(), []);
});

test('shared Web Locks serialize tab commits without sweeping another tab candidate or the winner', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const lockManager = new MemoryLockManager();
	const firstStore = createBrowserFfmpegRuntimeStore({
		cacheStorage,
		lockManager,
		origin: 'https://soundscaper.org',
		randomUUID: sequence('prior', 'tab-one'),
	});
	const secondStore = createBrowserFfmpegRuntimeStore({
		cacheStorage,
		lockManager,
		origin: 'https://soundscaper.org',
		randomUUID: () => 'tab-two',
	});
	const prior = release('8');
	const first = release('9');
	const second = release('a');
	await install(firstStore, prior);
	const firstTransaction = await stagedTransaction(firstStore, first);
	const secondTransaction = await stagedTransaction(secondStore, second);
	const commitEventOffset = cacheStorage.events.length;

	await Promise.all([firstTransaction.commit(), secondTransaction.commit()]);

	assert.equal(lockManager.maximumConcurrentCallbacks, 1);
	assert.equal((await secondStore.readActive())?.releaseId, second.releaseId);
	assert.deepEqual(cacheStorage.keysSync().sort(), [
		`${BROWSER_FFMPEG_RUNTIME_CACHE_PREFIX}${first.releaseId}`,
		`${BROWSER_FFMPEG_RUNTIME_CACHE_PREFIX}${second.releaseId}`,
		`${BROWSER_FFMPEG_RUNTIME_CACHE_PREFIX}state`,
	].sort());
	assert.equal(
		cacheStorage.events.slice(commitEventOffset)
			.filter((event) => event === `delete:${BROWSER_FFMPEG_RUNTIME_CACHE_PREFIX}candidate-tab-two`).length,
		1,
		'only the second transaction retires its candidate after publication',
	);
});

test('runtime cleanup reclaims abandoned candidates while preserving a live tab transaction', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const lockManager = new MemoryLockManager();
	const staleName = `${BROWSER_FFMPEG_RUNTIME_CACHE_PREFIX}candidate-abandoned`;
	await cacheStorage.open(staleName);
	const liveStore = createBrowserFfmpegRuntimeStore({
		cacheStorage,
		lockManager,
		origin: 'https://soundscaper.org',
		randomUUID: () => 'live-tab',
	});
	const committingStore = createBrowserFfmpegRuntimeStore({
		cacheStorage,
		lockManager,
		origin: 'https://soundscaper.org',
		randomUUID: () => 'committing-tab',
	});
	const liveTransaction = await liveStore.begin(release('b'));

	await install(committingStore, release('c'));

	assert.equal(cacheStorage.keysSync().includes(staleName), false);
	assert.equal(
		cacheStorage.keysSync().includes(
			`${BROWSER_FFMPEG_RUNTIME_CACHE_PREFIX}candidate-live-tab`,
		),
		true,
	);
	await liveTransaction.rollback();
});

test('a same-release commit reuses the complete referenced cache without deleting or rewriting it', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const store = createBrowserFfmpegRuntimeStore({
		cacheStorage,
		lockManager: new MemoryLockManager(),
		origin: 'https://soundscaper.org',
		randomUUID: sequence('installed', 'same-release'),
	});
	const installed = release('b');
	await install(store, installed);
	const transaction = await stagedTransaction(store, installed);
	const finalName = `${BROWSER_FFMPEG_RUNTIME_CACHE_PREFIX}${installed.releaseId}`;
	const eventOffset = cacheStorage.events.length;
	cacheStorage.failPut = (cacheName) => cacheName === finalName
		? new Error('same release must not be rewritten')
		: null;

	await transaction.commit();

	assert.equal((await store.readActive())?.releaseId, installed.releaseId);
	assert.equal(cacheStorage.events.slice(eventOffset).includes(`delete:${finalName}`), false);
	assert.equal(
		cacheStorage.events.slice(eventOffset).some((event) => event.startsWith(`put:${finalName}:`)),
		false,
	);
});

test('cleanup failure after the state commit cannot turn an installed release into a reported failure', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const store = createBrowserFfmpegRuntimeStore({
		cacheStorage,
		lockManager: new MemoryLockManager(),
		origin: 'https://soundscaper.org',
		randomUUID: () => 'cleanup-failure',
	});
	const installed = release('c');
	const transaction = await stagedTransaction(store, installed);
	cacheStorage.failKeys = () => new Error('simulated post-commit enumeration failure');

	await transaction.commit();

	cacheStorage.failKeys = () => null;
	assert.equal((await store.readActive())?.releaseId, installed.releaseId);
	assert.equal(
		cacheStorage.keysSync().includes(`${BROWSER_FFMPEG_RUNTIME_CACHE_PREFIX}candidate-cleanup-failure`),
		false,
		'own-candidate cleanup still runs after an unrelated cleanup failure',
	);
});
