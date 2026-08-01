/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	activateOfflineShell,
	handleOfflineShellFetch,
	installOfflineShell,
} from '../scripts/lib/offline-service-worker.mjs';

test('a partial shell install deletes only its candidate and leaves the prior release intact', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const priorId = 'a'.repeat(64);
	const priorName = shellCacheName(priorId);
	await (await cacheStorage.open(priorName)).put('/', response('prior shell'));
	const configuration = shellConfiguration('b');

	await assert.rejects(
		() => installOfflineShell({
			configuration,
			cacheStorage,
			fetchImpl: async (url) => url === '/'
				? response('root shell')
				: new Response(null, { status: 404 }),
		}),
		/request failed.*application\.js/u,
	);

	assert.deepEqual(await cacheStorage.keys(), [priorName]);
	assert.equal(await (await cacheStorage.open(priorName)).match('/').then((value) => value?.text()), 'prior shell');
});

test('a digest mismatch cannot write readiness or retire the active shell', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const priorId = 'c'.repeat(64);
	const priorName = shellCacheName(priorId);
	await (await cacheStorage.open(priorName)).put('/', response('prior shell'));
	const configuration = shellConfiguration('d');

	await assert.rejects(
		() => installOfflineShell({
			configuration,
			cacheStorage,
			fetchImpl: async (url) => response(url === '/' ? 'root shell' : 'Application code'),
		}),
		/SHA-256 mismatch/u,
	);
	assert.deepEqual(await cacheStorage.keys(), [priorName]);
});

test('activation retires old shell caches only after the complete release readiness marker exists', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const priorName = shellCacheName('e'.repeat(64));
	await (await cacheStorage.open(priorName)).put('/', response('prior shell'));
	const configuration = shellConfiguration('f');
	await installOfflineShell({
		configuration,
		cacheStorage,
		fetchImpl: async (url) => response(url === '/' ? 'root shell' : 'application code'),
	});
	let claims = 0;

	await activateOfflineShell({
		configuration,
		cacheStorage,
		clients: { claim: async () => { claims += 1; } },
	});

	assert.equal(claims, 1);
	assert.deepEqual(await cacheStorage.keys(), [shellCacheName(configuration.releaseId)]);
	assert.equal(cacheStorage.events.at(-1), `delete:${priorName}`);
});

test('a failed client takeover preserves the prior complete shell', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const priorName = shellCacheName('2'.repeat(64));
	await (await cacheStorage.open(priorName)).put('/', response('prior shell'));
	const configuration = shellConfiguration('3');
	await installOfflineShell({
		configuration,
		cacheStorage,
		fetchImpl: async (url) => response(url === '/' ? 'root shell' : 'application code'),
	});

	await assert.rejects(
		() => activateOfflineShell({
			configuration,
			cacheStorage,
			clients: { claim: async () => { throw new Error('client takeover failed'); } },
		}),
		/client takeover failed/u,
	);

	assert.deepEqual(await cacheStorage.keys(), [priorName, shellCacheName(configuration.releaseId)]);
});

test('encoded network metadata is normalized around the verified decoded shell bytes', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const configuration = shellConfiguration('1');
	await installOfflineShell({
		configuration,
		cacheStorage,
		fetchImpl: async (url) => {
			const value = response(url === '/' ? 'root shell' : 'application code');
			value.headers.set('content-encoding', 'gzip');
			value.headers.set('content-length', '3');
			return value;
		},
	});
	const cache = await cacheStorage.open(shellCacheName(configuration.releaseId));
	const cached = await cache.match('/assets/application.js');
	assert.equal(cached.headers.get('content-encoding'), null);
	assert.equal(cached.headers.get('content-length'), String(Buffer.byteLength('application code')));
	assert.equal(await cached.text(), 'application code');
});

test('fetches use only the verified shell allowlist and explicitly installed runtime caches', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const configuration = shellConfiguration('9');
	await installOfflineShell({
		configuration,
		cacheStorage,
		fetchImpl: async (url) => response(url === '/' ? 'root shell' : 'application code'),
	});
	const runtimeId = '8'.repeat(64);
	const runtimeUrl = `https://assets.soundscaper.org/runtime/ffmpeg/0.12.10/releases/${runtimeId}/ffmpeg-core.js`;
	await (await cacheStorage.open(`soundscaper-ffmpeg-runtime-v1-${runtimeId}`)).put(
		runtimeUrl,
		response('verified runtime'),
	);
	let networkRequests = 0;
	const fetchImpl = async () => {
		networkRequests += 1;
		throw new TypeError('offline');
	};

	const shell = await handleOfflineShellFetch({
		configuration,
		cacheStorage,
		fetchImpl,
		request: { method: 'GET', mode: 'navigate', url: 'https://soundscaper.org/en/?project=one' },
		origin: 'https://soundscaper.org',
	});
	assert.equal(await shell.text(), 'root shell', 'an unknown offline navigation receives the verified root');
	const asset = await handleOfflineShellFetch({
		configuration,
		cacheStorage,
		fetchImpl,
		request: new Request('https://soundscaper.org/assets/application.js'),
		origin: 'https://soundscaper.org',
	});
	assert.equal(await asset.text(), 'application code');
	const runtime = await handleOfflineShellFetch({
		configuration,
		cacheStorage,
		fetchImpl,
		request: new Request(runtimeUrl),
		origin: 'https://soundscaper.org',
	});
	assert.equal(await runtime.text(), 'verified runtime');
	assert.equal(networkRequests, 1, 'only the unknown navigation attempts the network before root fallback');
});

test('unknown offline navigations fall back to the matching product shell', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const configuration = shellConfiguration('7', [
		asset('/en/', 'soundscaper shell'),
		asset('/framescaper/en/', 'framescaper shell'),
	]);
	const contents = new Map(configuration.assets.map(({ url }) => [
		url,
		url === '/framescaper/en/' ? 'framescaper shell'
			: url === '/en/' ? 'soundscaper shell'
				: url === '/' ? 'root shell' : 'application code',
	]));
	await installOfflineShell({
		configuration,
		cacheStorage,
		fetchImpl: async (url) => response(contents.get(url)),
	});
	const fetchImpl = async () => { throw new TypeError('offline'); };

	const framescaper = await handleOfflineShellFetch({
		configuration,
		cacheStorage,
		fetchImpl,
		request: { method: 'GET', mode: 'navigate', url: 'https://soundscaper.org/framescaper/embed/en/project' },
		origin: 'https://soundscaper.org',
	});
	const soundscaper = await handleOfflineShellFetch({
		configuration,
		cacheStorage,
		fetchImpl,
		request: { method: 'GET', mode: 'navigate', url: 'https://soundscaper.org/embed/en/project' },
		origin: 'https://soundscaper.org',
	});

	assert.equal(await framescaper.text(), 'framescaper shell');
	assert.equal(await soundscaper.text(), 'soundscaper shell');
});

function shellConfiguration(seed, extraAssets = []) {
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

function asset(url, contents) {
	const bytes = Buffer.from(contents);
	return Object.freeze({
		url,
		byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
	});
}

function response(contents) {
	const bytes = Buffer.from(contents);
	return new Response(bytes, {
		status: 200,
		headers: { 'content-length': String(bytes.byteLength), 'content-type': 'text/plain' },
	});
}

function shellCacheName(releaseId) {
	return `soundscaper-application-shell-v1-${releaseId}`;
}

class MemoryCacheStorage {
	readonlyCaches = new Map();
	events = [];

	async open(name) {
		let cache = this.readonlyCaches.get(name);
		if (!cache) {
			cache = new MemoryCache();
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

class MemoryCache {
	entries = new Map();

	async match(input) {
		return this.entries.get(key(input))?.clone();
	}

	async put(input, value) {
		this.entries.set(key(input), value.clone());
	}
}

function key(input) {
	if (input instanceof Request) return input.url;
	return String(input);
}
