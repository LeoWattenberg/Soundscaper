/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
	createBrowserFfmpegRuntimeStore,
	type BrowserRuntimeLockManager,
} from '../../src/common/offline/browser-runtime-store.ts';
import type { VerifiedRuntimeFile, VerifiedRuntimeRelease } from '../../src/common/offline/ffmpeg-runtime-cache.ts';

export const STREAM_CACHE_PROBE_SUFFIX = '/runtime/ffmpeg/0.12.10/.soundscaper-stream-probe-v1';

export async function install(
	store: ReturnType<typeof createBrowserFfmpegRuntimeStore>,
	releaseValue: VerifiedRuntimeRelease,
): Promise<void> {
	const transaction = await store.begin(releaseValue);
	for (const fileValue of releaseValue.files) await transaction.put(fileValue, runtimeResponse(fileValue));
	await transaction.commit();
}

export async function stagedTransaction(
	store: ReturnType<typeof createBrowserFfmpegRuntimeStore>,
	releaseValue: VerifiedRuntimeRelease,
) {
	const transaction = await store.begin(releaseValue);
	for (const fileValue of releaseValue.files) await transaction.put(fileValue, runtimeResponse(fileValue));
	return transaction;
}

export function release(seed: string): VerifiedRuntimeRelease {
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

export function runtimeResponse(
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

export function completionTrackedRuntimeResponse(
	fileValue: VerifiedRuntimeFile,
	onComplete: () => void,
): Response {
	const body = runtimeBodyForFile(fileValue);
	let emitted = false;
	return new Response(new ReadableStream<Uint8Array>({
		pull: (controller) => {
			if (emitted) {
				onComplete();
				controller.close();
				return;
			}
			emitted = true;
			controller.enqueue(body);
		},
	}, { highWaterMark: 0 }), {
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

export function runtimeBodyForFile(fileValue: VerifiedRuntimeFile): Uint8Array {
	const match = /\/releases\/([a-f\d]{64})\/(ffmpeg-core\.(?:js|wasm))$/u.exec(fileValue.url);
	if (!match?.[1] || !match[2]) throw new Error('Test runtime URL is invalid.');
	return runtimeBody(match[1][0]!, match[2]);
}

export function sequence(...values: string[]): () => string {
	let index = 0;
	return () => values[index++] ?? `extra-${String(index)}`;
}

export class MemoryCacheStorage {
	readonly caches = new Map<string, MemoryCache>();
	readonly events: string[] = [];
	probeMatchCount = 0;
	beforePut: (cacheName: string, key: string) => void = () => undefined;
	failPut: (cacheName: string, key: string) => Error | null = () => null;
	failKeys: () => Error | null = () => null;
	settlePutAfterFirstChunk: (cacheName: string, key: string) => boolean = () => false;

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
		const key = cacheKey(input);
		if (key.endsWith(STREAM_CACHE_PROBE_SUFFIX)) this.#storage.probeMatchCount += 1;
		return this.entries.get(key)?.clone();
	}

	async put(input: RequestInfo | URL, response: Response): Promise<void> {
		if (this.#deleted) throw new Error(`Cache ${this.#name} was deleted.`);
		const key = cacheKey(input);
		this.#storage.beforePut(this.#name, key);
		const failure = this.#storage.failPut(this.#name, key);
		if (failure) throw failure;
		if (this.#storage.settlePutAfterFirstChunk(this.#name, key)) {
			if (!response.body) throw new Error('Test response has no body.');
			const reader = response.body.getReader();
			const { value } = await reader.read();
			reader.releaseLock();
			if (!value) throw new Error('Test response did not emit a body chunk.');
			this.entries.set(key, new Response(value.slice(), {
				status: response.status,
				headers: response.headers,
			}));
			this.#storage.events.push(`put:${this.#name}:${key}`);
			return;
		}
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

export class MemoryLockManager implements BrowserRuntimeLockManager {
	readonly #tails = new Map<string, Promise<void>>();
	readonly #concurrentCallbacks = new Map<string, number>();
	maximumConcurrentCallbacks = 0;

	async request<T>(
		name: string,
		options: Readonly<{ mode: 'exclusive'; ifAvailable?: boolean }>,
		callback: (lock: object | null) => Promise<T>,
	): Promise<T> {
		assert.equal(options.mode, 'exclusive');
		const predecessor = this.#tails.get(name);
		if (options.ifAvailable && predecessor) return callback(null);
		let releaseLock: () => void = () => undefined;
		const tail = new Promise<void>((resolve) => { releaseLock = resolve; });
		this.#tails.set(name, tail);
		await predecessor;
		const concurrent = (this.#concurrentCallbacks.get(name) ?? 0) + 1;
		this.#concurrentCallbacks.set(name, concurrent);
		this.maximumConcurrentCallbacks = Math.max(
			this.maximumConcurrentCallbacks,
			concurrent,
		);
		try {
			return await callback(Object.freeze({ name, mode: 'exclusive' }));
		} finally {
			this.#concurrentCallbacks.set(name, concurrent - 1);
			releaseLock();
			if (this.#tails.get(name) === tail) this.#tails.delete(name);
		}
	}
}

function cacheKey(input: RequestInfo | URL): string {
	if (input instanceof Request) return input.url;
	return String(input);
}
