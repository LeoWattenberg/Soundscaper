/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BROWSER_FFMPEG_RUNTIME_CACHE_PREFIX,
	createBrowserFfmpegRuntimeStore,
} from '../src/common/offline/browser-runtime-store.ts';
import type { VerifiedRuntimeFile, VerifiedRuntimeRelease } from '../src/common/offline/ffmpeg-runtime-cache.ts';

test('browser runtime commit publishes metadata last and retains one previous complete release', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const store = createBrowserFfmpegRuntimeStore({
		cacheStorage,
		origin: 'https://soundscaper.org',
		randomUUID: sequence('candidate-one', 'candidate-two'),
	});
	const first = release('1');
	const second = release('2');

	await install(store, first);
	await install(store, second);

	assert.equal((await store.readActive())?.releaseId, second.releaseId);
	cacheStorage.deleteEntry(second.files[0]!.url);
	assert.equal(
		(await store.readActive())?.releaseId,
		first.releaseId,
		'a missing active body falls back to the retained previous complete release',
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

test('a failed final-cache copy leaves the prior release active and removes the partial final cache', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const store = createBrowserFfmpegRuntimeStore({
		cacheStorage,
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

async function install(
	store: ReturnType<typeof createBrowserFfmpegRuntimeStore>,
	releaseValue: VerifiedRuntimeRelease,
): Promise<void> {
	const transaction = await store.begin(releaseValue);
	for (const file of releaseValue.files) await transaction.put(file, runtimeResponse(file));
	await transaction.commit();
}

function release(seed: string): VerifiedRuntimeRelease {
	const releaseId = seed.repeat(64);
	const baseUrl = `https://assets.soundscaper.org/runtime/ffmpeg/0.12.10/releases/${releaseId}/`;
	const files = [
		file('ffmpeg-core.js', baseUrl, 11, seed.repeat(64), 'text/javascript; charset=utf-8'),
		file('ffmpeg-core.wasm', baseUrl, 13, seed.repeat(64), 'application/wasm'),
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
	byteLength: number,
	sha256: string,
	contentType: string,
): VerifiedRuntimeFile {
	return Object.freeze({ name, url: `${baseUrl}${name}`, byteLength, sha256, contentType });
}

function runtimeResponse(fileValue: VerifiedRuntimeFile): Response {
	return new Response(new Uint8Array(fileValue.byteLength).buffer, {
		status: 200,
		headers: {
			'content-length': String(fileValue.byteLength),
			'content-type': fileValue.contentType,
		},
	});
}

function sequence(...values: string[]): () => string {
	let index = 0;
	return () => values[index++] ?? `extra-${String(index)}`;
}

class MemoryCacheStorage {
	readonly caches = new Map<string, MemoryCache>();
	readonly events: string[] = [];
	failPut: (cacheName: string, key: string) => Error | null = () => null;

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
		return this.caches.delete(name);
	}

	async keys(): Promise<string[]> {
		return this.keysSync();
	}

	keysSync(): string[] {
		return [...this.caches.keys()];
	}

	deleteEntry(key: string): void {
		for (const cache of this.caches.values()) cache.entries.delete(key);
	}
}

class MemoryCache {
	readonly entries = new Map<string, Response>();
	readonly #name: string;
	readonly #storage: MemoryCacheStorage;

	constructor(name: string, storage: MemoryCacheStorage) {
		this.#name = name;
		this.#storage = storage;
	}

	async match(input: RequestInfo | URL): Promise<Response | undefined> {
		return this.entries.get(cacheKey(input))?.clone();
	}

	async put(input: RequestInfo | URL, response: Response): Promise<void> {
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
}

function cacheKey(input: RequestInfo | URL): string {
	if (input instanceof Request) return input.url;
	return String(input);
}
