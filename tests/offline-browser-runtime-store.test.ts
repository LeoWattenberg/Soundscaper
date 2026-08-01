/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	BROWSER_FFMPEG_RUNTIME_CACHE_PREFIX,
	createBrowserFfmpegRuntimeStore,
	type BrowserRuntimeLockManager,
} from '../src/common/offline/browser-runtime-store.ts';
import type { VerifiedRuntimeFile, VerifiedRuntimeRelease } from '../src/common/offline/ffmpeg-runtime-cache.ts';

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

async function install(
	store: ReturnType<typeof createBrowserFfmpegRuntimeStore>,
	releaseValue: VerifiedRuntimeRelease,
): Promise<void> {
	const transaction = await store.begin(releaseValue);
	for (const file of releaseValue.files) await transaction.put(file, runtimeResponse(file));
	await transaction.commit();
}

async function stagedTransaction(
	store: ReturnType<typeof createBrowserFfmpegRuntimeStore>,
	releaseValue: VerifiedRuntimeRelease,
) {
	const transaction = await store.begin(releaseValue);
	for (const file of releaseValue.files) await transaction.put(file, runtimeResponse(file));
	return transaction;
}

function release(seed: string): VerifiedRuntimeRelease {
	const releaseId = seed.repeat(64);
	const baseUrl = `https://assets.soundscaper.org/runtime/ffmpeg/0.12.10/releases/${releaseId}/`;
	const files = [
		file('ffmpeg-core.js', baseUrl, runtimeBody(seed, 'ffmpeg-core.js'), 'text/javascript; charset=utf-8'),
		file('ffmpeg-core.wasm', baseUrl, runtimeBody(seed, 'ffmpeg-core.wasm'), 'application/wasm'),
	];
	return Object.freeze({
		schemaVersion: 1,
		releaseId,
		manifestSha256: releaseId,
		baseUrl,
		files: Object.freeze(files),
	});
}

function file(
	name: string,
	baseUrl: string,
	body: Uint8Array,
	contentType: string,
): VerifiedRuntimeFile {
	return Object.freeze({
		name,
		url: `${baseUrl}${name}`,
		byteLength: body.byteLength,
		sha256: createHash('sha256').update(body).digest('hex'),
		contentType,
	});
}

function runtimeResponse(
	fileValue: VerifiedRuntimeFile,
	body: Uint8Array = runtimeBodyForFile(fileValue),
): Response {
	const responseBody = new ArrayBuffer(body.byteLength);
	new Uint8Array(responseBody).set(body);
	return new Response(responseBody, {
		status: 200,
		headers: {
			'content-length': String(fileValue.byteLength),
			'content-type': fileValue.contentType,
		},
	});
}

function runtimeBody(seed: string, name: string): Uint8Array {
	return new TextEncoder().encode(`${name}:${seed}:verified-runtime-body`);
}

function runtimeBodyForFile(fileValue: VerifiedRuntimeFile): Uint8Array {
	const match = /\/releases\/([a-f\d]{64})\/(ffmpeg-core\.(?:js|wasm))$/u.exec(fileValue.url);
	if (!match?.[1] || !match[2]) throw new Error('Test runtime URL is invalid.');
	return runtimeBody(match[1][0]!, match[2]);
}

function sequence(...values: string[]): () => string {
	let index = 0;
	return () => values[index++] ?? `extra-${String(index)}`;
}

class MemoryCacheStorage {
	readonly caches = new Map<string, MemoryCache>();
	readonly events: string[] = [];
	failPut: (cacheName: string, key: string) => Error | null = () => null;
	failKeys: () => Error | null = () => null;

	async open(name: string): Promise<MemoryCache> {
		let cache = this.caches.get(name);
		if (!cache) {
			cache = new MemoryCache(name, this);
			this.caches.set(name, cache);
			this.events.push(`open:${name}`);
		}
		return cache;
	}

	async delete(name: string): Promise<boolean> {
		this.events.push(`delete:${name}`);
		const cache = this.caches.get(name);
		cache?.markDeleted();
		return this.caches.delete(name);
	}

	async keys(): Promise<string[]> {
		const failure = this.failKeys();
		if (failure) throw failure;
		return this.keysSync();
	}

	keysSync(): string[] {
		return [...this.caches.keys()];
	}

	replaceEntry(key: string, response: Response): void {
		for (const cache of this.caches.values()) {
			if (cache.entries.has(key)) cache.entries.set(key, response.clone());
		}
	}
}

class MemoryCache {
	readonly entries = new Map<string, Response>();
	readonly #name: string;
	readonly #storage: MemoryCacheStorage;
	#deleted = false;

	constructor(name: string, storage: MemoryCacheStorage) {
		this.#name = name;
		this.#storage = storage;
	}

	async match(input: RequestInfo | URL): Promise<Response | undefined> {
		if (this.#deleted) return undefined;
		return this.entries.get(cacheKey(input))?.clone();
	}

	async put(input: RequestInfo | URL, response: Response): Promise<void> {
		if (this.#deleted) throw new Error(`Cache ${this.#name} was deleted.`);
		const key = cacheKey(input);
		const failure = this.#storage.failPut(this.#name, key);
		if (failure) throw failure;
		const bytes = await response.arrayBuffer();
		this.entries.set(key, new Response(bytes, {
			status: response.status,
			headers: response.headers,
		}));
		this.#storage.events.push(`put:${this.#name}:${key}`);
	}

	markDeleted(): void {
		this.#deleted = true;
	}
}

class MemoryLockManager implements BrowserRuntimeLockManager {
	#tail: Promise<void> = Promise.resolve();
	#concurrentCallbacks = 0;
	maximumConcurrentCallbacks = 0;

	async request<T>(
		name: string,
		options: Readonly<{ mode: 'exclusive' }>,
		callback: (lock: object | null) => Promise<T>,
	): Promise<T> {
		assert.equal(options.mode, 'exclusive');
		const predecessor = this.#tail;
		let release: () => void = () => undefined;
		this.#tail = new Promise<void>((resolve) => { release = resolve; });
		await predecessor;
		this.#concurrentCallbacks += 1;
		this.maximumConcurrentCallbacks = Math.max(
			this.maximumConcurrentCallbacks,
			this.#concurrentCallbacks,
		);
		try {
			return await callback(Object.freeze({ name, mode: 'exclusive' }));
		} finally {
			this.#concurrentCallbacks -= 1;
			release();
		}
	}
}

function cacheKey(input: RequestInfo | URL): string {
	if (input instanceof Request) return input.url;
	return String(input);
}
