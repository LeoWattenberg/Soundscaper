/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	activateOfflineShell,
	handleOfflineShellFetch,
	installOfflineShell,
} from '../scripts/lib/offline-service-worker.mjs';
import {
	asset,
	MemoryCacheStorage,
	response,
	shellCacheName,
	shellConfiguration,
	shellResponse,
} from './helpers/offline-shell-fixtures.js';

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
			fetchImpl: async (url) => url === '/assets/application.js'
				? response('Application code')
				: shellResponse(url),
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
		fetchImpl: async (url) => shellResponse(url),
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
		fetchImpl: async (url) => shellResponse(url),
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
			const value = shellResponse(url);
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

test('an update re-verifies and reuses unchanged entries from the prior complete product cache', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const prior = shellConfiguration('6');
	await installOfflineShell({
		configuration: prior,
		cacheStorage,
		fetchImpl: async (url) => shellResponse(url),
	});
	const next = shellConfiguration('7');
	let networkRequests = 0;
	await installOfflineShell({
		configuration: next,
		cacheStorage,
		fetchImpl: async () => {
			networkRequests += 1;
			throw new TypeError('network should not be needed');
		},
	});

	assert.equal(networkRequests, 0);
	assert.deepEqual(await cacheStorage.keys(), [
		shellCacheName(prior.releaseId),
		shellCacheName(next.releaseId),
	]);
});

test('install downloads are bounded to four verified responses at a time', async () => {
	const extras = Array.from({ length: 6 }, (_, index) => asset(`/assets/core-${String(index)}.js`, `core ${String(index)}`));
	const installUrls = [
		'/assets/application.js',
		...extras.map(({ url }) => url),
		'/embed/en/',
		'/en/',
	].sort();
	const configuration = shellConfiguration('8', extras, { installUrls });
	const contents = new Map([
		['/assets/application.js', 'application code'],
		['/embed/en/', 'embedded shell'],
		['/en/', 'root shell'],
		...extras.map(({ url }, index) => [url, `core ${String(index)}`]),
	]);
	let active = 0;
	let maximumActive = 0;
	await installOfflineShell({
		configuration,
		cacheStorage: new MemoryCacheStorage(),
		fetchImpl: async (url) => {
			active += 1;
			maximumActive = Math.max(maximumActive, active);
			await new Promise((resolve) => setTimeout(resolve, 2));
			active -= 1;
			return response(contents.get(url));
		},
	});
	assert.equal(maximumActive, 4);
});

test('an allowlisted optional asset is verified once, cached on use, and never replaced by tampered bytes', async () => {
	const optional = asset('/assets/optional.js', 'optional code');
	const configuration = shellConfiguration('a', [optional]);
	const cacheStorage = new MemoryCacheStorage();
	await installOfflineShell({
		configuration,
		cacheStorage,
		fetchImpl: async (url) => shellResponse(url),
	});
	let networkRequests = 0;
	const first = await handleOfflineShellFetch({
		configuration,
		cacheStorage,
		fetchImpl: async () => {
			networkRequests += 1;
			return response('optional code');
		},
		request: new Request('https://soundscaper.org/assets/optional.js'),
		origin: 'https://soundscaper.org',
	});
	assert.equal(await first.text(), 'optional code');
	const second = await handleOfflineShellFetch({
		configuration,
		cacheStorage,
		fetchImpl: async () => { throw new TypeError('offline'); },
		request: new Request('https://soundscaper.org/assets/optional.js'),
		origin: 'https://soundscaper.org',
	});
	assert.equal(await second.text(), 'optional code');
	assert.equal(networkRequests, 1);

	const uncachedConfiguration = shellConfiguration('b', [optional]);
	await installOfflineShell({
		configuration: uncachedConfiguration,
		cacheStorage,
		fetchImpl: async (url) => shellResponse(url),
	});
	await assert.rejects(
		() => handleOfflineShellFetch({
			configuration: uncachedConfiguration,
			cacheStorage,
			fetchImpl: async () => response('tampered code'),
			request: new Request('https://soundscaper.org/assets/optional.js'),
			origin: 'https://soundscaper.org',
		}),
		/(?:Content-Length|SHA-256) mismatch/u,
	);
});

test('the scoped Framescaper worker verifies shared allowlisted assets outside its navigation scope', async () => {
	const optional = asset('/assets/framescaper-optional.js', 'framescaper optional');
	const routes = [
		asset('/framescaper/embed/en/', 'framescaper embedded shell'),
		asset('/framescaper/en/', 'framescaper shell'),
	];
	const configuration = shellConfiguration('c', [optional, ...routes], {
		productId: 'framescaper',
		scope: '/framescaper/',
		fallbacks: {
			standard: '/framescaper/en/',
			embedded: '/framescaper/embed/en/',
		},
		installUrls: [
			'/assets/application.js',
			'/framescaper/embed/en/',
			'/framescaper/en/',
		],
	});
	const contents = new Map([
		['/assets/application.js', 'application code'],
		['/assets/framescaper-optional.js', 'framescaper optional'],
		['/framescaper/embed/en/', 'framescaper embedded shell'],
		['/framescaper/en/', 'framescaper shell'],
	]);
	const cacheStorage = new MemoryCacheStorage();
	await installOfflineShell({
		configuration,
		cacheStorage,
		fetchImpl: async (url) => response(contents.get(url)),
	});
	const first = await handleOfflineShellFetch({
		configuration,
		cacheStorage,
		fetchImpl: async () => response('framescaper optional'),
		request: new Request('https://soundscaper.org/assets/framescaper-optional.js'),
		origin: 'https://soundscaper.org',
	});
	assert.equal(await first.text(), 'framescaper optional');
	const cached = await handleOfflineShellFetch({
		configuration,
		cacheStorage,
		fetchImpl: async () => { throw new TypeError('offline'); },
		request: new Request('https://soundscaper.org/assets/framescaper-optional.js'),
		origin: 'https://soundscaper.org',
	});
	assert.equal(await cached.text(), 'framescaper optional');
});
