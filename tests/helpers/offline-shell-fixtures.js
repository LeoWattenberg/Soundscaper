/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

export function shellConfiguration(seed, extraAssets = []) {
	const assets = [
		asset('/', 'root shell'),
		asset('/assets/application.js', 'application code'),
		...extraAssets,
	].sort(({ url: left }, { url: right }) => left < right ? -1 : left > right ? 1 : 0);
	const identity = {
		schemaVersion: 1,
		workerSha256: seed.repeat(64),
		assets,
	};
	return Object.freeze({
		...identity,
		releaseId: createHash('sha256').update(JSON.stringify(identity)).digest('hex'),
		assets: Object.freeze(assets),
	});
}

export function asset(url, contents) {
	const bytes = Buffer.from(contents);
	return Object.freeze({
		url,
		byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
	});
}

export function response(contents) {
	const bytes = Buffer.from(contents);
	return new Response(bytes, {
		status: 200,
		headers: { 'content-length': String(bytes.byteLength), 'content-type': 'text/plain' },
	});
}

export function shellCacheName(releaseId) {
	return `soundscaper-application-shell-v1-${releaseId}`;
}

export class MemoryCacheStorage {
	readonlyCaches = new Map();
	events = [];
	#putFailures = new Map();

	/** Arm the next put against the named cache to reject, e.g. with a QuotaExceededError. */
	failNextPutFor(name, error) {
		this.#putFailures.set(name, error);
	}

	takePutFailure(name) {
		const failure = this.#putFailures.get(name);
		if (failure !== undefined) this.#putFailures.delete(name);
		return failure;
	}

	async open(name) {
		let cache = this.readonlyCaches.get(name);
		if (!cache) {
			cache = new MemoryCache(this, name);
			this.readonlyCaches.set(name, cache);
		}
		return cache;
	}

	async delete(name) {
		this.events.push(`delete:${name}`);
		return this.readonlyCaches.delete(name);
	}

	async keys() {
		return [...this.readonlyCaches.keys()];
	}
}

export class MemoryCache {
	entries = new Map();
	#storage;
	#name;

	constructor(storage = null, name = '') {
		this.#storage = storage;
		this.#name = name;
	}

	async match(input) {
		return this.entries.get(cacheKey(input))?.clone();
	}

	async put(input, value) {
		const failure = this.#storage?.takePutFailure(this.#name);
		if (failure) throw failure;
		this.entries.set(cacheKey(input), value.clone());
	}
}

function cacheKey(input) {
	if (input instanceof Request) return input.url;
	return String(input);
}
