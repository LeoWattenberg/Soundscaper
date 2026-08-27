/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import runtimePublicPolicy from '../config/ffmpeg-runtime-publication-policy.json' with { type: 'json' };

import {
	activateOfflineShell,
	handleOfflineShellFetch,
	installOfflineShell,
	renderOfflineServiceWorker,
	validateOfflineShellConfiguration,
} from '../scripts/lib/offline-service-worker.mjs';
import {
	asset,
	MemoryCacheStorage,
	response,
	shellCacheName,
	shellConfiguration,
	shellResponse,
} from './helpers/offline-shell-fixtures.js';

test('generated workers interpolate the exact central runtime path and MIME policy', () => {
	const source = renderOfflineServiceWorker(shellConfiguration('0'));
	assert.ok(source.includes(`const RUNTIME_ORIGIN = ${JSON.stringify(runtimePublicPolicy.publicOrigin)};`));
	assert.ok(source.includes(`/${runtimePublicPolicy.publicPrefix}/${runtimePublicPolicy.releaseSegment}/`));
	assert.ok(source.includes(JSON.stringify(runtimePublicPolicy.runtimeFiles)));
	assert.doesNotMatch(source, /const names = \['ffmpeg-core\.js'/u);
});

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

test('both product v2 installs reuse a complete legacy v1 cache without Framescaper deleting it', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const legacyId = '1'.repeat(64);
	const legacyName = `soundscaper-application-shell-v1-${legacyId}`;
	const legacy = await cacheStorage.open(legacyName);
	const framesRoutes = [
		asset('/framescaper/embed/en/', 'framescaper embedded shell'),
		asset('/framescaper/en/', 'framescaper shell'),
	];
	const soundscaper = shellConfiguration('2');
	const framescaper = shellConfiguration('3', framesRoutes, {
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
		['/embed/en/', 'embedded shell'],
		['/en/', 'root shell'],
		['/framescaper/embed/en/', 'framescaper embedded shell'],
		['/framescaper/en/', 'framescaper shell'],
	]);
	for (const url of new Set([...soundscaper.installUrls, ...framescaper.installUrls])) {
		await legacy.put(url, response(contents.get(url)));
	}
	await legacy.put(
		`/.soundscaper/offline/application-shell-${legacyId}.json`,
		response(JSON.stringify({ schemaVersion: 1, releaseId: legacyId })),
	);
	const legacyEntryCount = legacy.entries.size;
	let networkRequests = 0;
	for (const configuration of [soundscaper, framescaper]) {
		await installOfflineShell({
			configuration,
			cacheStorage,
			fetchImpl: async () => {
				networkRequests += 1;
				throw new TypeError('legacy reuse should avoid the network');
			},
		});
	}

	assert.equal(networkRequests, 0);
	assert.equal(legacy.entries.size, legacyEntryCount, 'legacy reuse is read-only');
	await activateOfflineShell({
		configuration: framescaper,
		cacheStorage,
		clients: { claim: async () => undefined },
	});
	assert.ok((await cacheStorage.keys()).includes(legacyName), 'Framescaper leaves shared v1 for an old root worker');
});

test('install descriptors cannot exceed the four MiB in-flight ceiling', () => {
	const oversized = Object.freeze({
		url: '/assets/oversized-core.js',
		byteLength: 4 * 1024 * 1024 + 1,
		sha256: 'a'.repeat(64),
	});
	const configuration = shellConfiguration('4', [oversized], {
		installUrls: [
			'/assets/application.js',
			'/assets/oversized-core.js',
			'/embed/en/',
			'/en/',
		].sort(),
	});
	assert.throws(
		() => validateOfflineShellConfiguration(configuration),
		/install descriptor exceeds its in-flight byte limit/iu,
	);
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

	const cache = await cacheStorage.open(shellCacheName(configuration.releaseId));
	await cache.put(optional.url, response('optional CODE'));
	const repaired = await handleOfflineShellFetch({
		configuration,
		cacheStorage,
		fetchImpl: async () => {
			networkRequests += 1;
			return response('optional code');
		},
		request: new Request('https://soundscaper.org/assets/optional.js'),
		origin: 'https://soundscaper.org',
	});
	assert.equal(await repaired.text(), 'optional code', 'an online request replaces a tampered cached entry');
	assert.equal(networkRequests, 2);
	assert.equal(await cache.match(optional.url).then((value) => value?.text()), 'optional code');

	await cache.put(optional.url, response('optional CODE'));
	await assert.rejects(
		() => handleOfflineShellFetch({
			configuration,
			cacheStorage,
			fetchImpl: async () => { throw new TypeError('offline'); },
			request: new Request('https://soundscaper.org/assets/optional.js'),
			origin: 'https://soundscaper.org',
		}),
		/offline/u,
	);
	assert.equal(await cache.match(optional.url), undefined, 'a tampered cached entry is deleted before offline failure');

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

test('allowlisted navigation failures use only the matching verified English fallback', async () => {
	const localized = asset('/fr/', 'french shell');
	const configuration = shellConfiguration('5', [localized]);
	const cacheStorage = new MemoryCacheStorage();
	await installOfflineShell({
		configuration,
		cacheStorage,
		fetchImpl: async (url) => shellResponse(url),
	});
	const failures = [
		async () => new Response(null, { status: 404 }),
		async () => new Response(null, { status: 500 }),
		async () => response('short'),
		async () => response('frenxh shell'),
	];
	for (const fetchImpl of failures) {
		const result = await handleOfflineShellFetch({
			configuration,
			cacheStorage,
			fetchImpl,
			request: { method: 'GET', mode: 'navigate', url: 'https://soundscaper.org/fr/' },
			origin: 'https://soundscaper.org',
		});
		assert.equal(await result.text(), 'root shell');
	}
	const cache = await cacheStorage.open(shellCacheName(configuration.releaseId));
	assert.equal(await cache.match('/fr/'), undefined, 'failed exact documents are never cached or served');
});

test('cached exact navigation documents are verified before serving and repaired only from verified network bytes', async () => {
	const localized = asset('/fr/', 'french shell');
	const configuration = shellConfiguration('6', [localized]);
	const cacheStorage = new MemoryCacheStorage();
	await installOfflineShell({
		configuration,
		cacheStorage,
		fetchImpl: async (url) => shellResponse(url),
	});
	const cache = await cacheStorage.open(shellCacheName(configuration.releaseId));
	await cache.put(localized.url, response('frenxh shell'));
	let networkRequests = 0;
	const repaired = await handleOfflineShellFetch({
		configuration,
		cacheStorage,
		fetchImpl: async () => {
			networkRequests += 1;
			return response('french shell');
		},
		request: { method: 'GET', mode: 'navigate', url: 'https://soundscaper.org/fr/' },
		origin: 'https://soundscaper.org',
	});
	assert.equal(await repaired.text(), 'french shell');
	assert.equal(networkRequests, 1);
	assert.equal(await cache.match(localized.url).then((value) => value?.text()), 'french shell');

	await cache.put(localized.url, response('frenxh shell'));
	const fallback = await handleOfflineShellFetch({
		configuration,
		cacheStorage,
		fetchImpl: async () => { throw new TypeError('offline'); },
		request: { method: 'GET', mode: 'navigate', url: 'https://soundscaper.org/fr/' },
		origin: 'https://soundscaper.org',
	});
	assert.equal(await fallback.text(), 'root shell');
	assert.equal(await cache.match(localized.url), undefined, 'the corrupt exact document is never retained');
});

test('tampered standard and embedded navigation fallbacks fail closed while offline', async () => {
	const configuration = shellConfiguration('7');
	const cacheStorage = new MemoryCacheStorage();
	await installOfflineShell({
		configuration,
		cacheStorage,
		fetchImpl: async (url) => shellResponse(url),
	});
	const cache = await cacheStorage.open(shellCacheName(configuration.releaseId));
	await cache.put(configuration.fallbacks.standard, response('root'));
	await cache.put(configuration.fallbacks.embedded, response('EMBEDDED SHELL'));

	for (const [url, fallbackPath] of [
		['https://soundscaper.org/de/project', configuration.fallbacks.standard],
		['https://soundscaper.org/embed/de/project', configuration.fallbacks.embedded],
	]) {
		await assert.rejects(
			() => handleOfflineShellFetch({
				configuration,
				cacheStorage,
				fetchImpl: async () => { throw new TypeError('offline'); },
				request: { method: 'GET', mode: 'navigate', url },
				origin: 'https://soundscaper.org',
			}),
			/offline/u,
		);
		assert.equal(await cache.match(fallbackPath), undefined, `${fallbackPath} is deleted after verification fails`);
	}
});

test('a Framescaper worker at its own origin root claims every navigation the origin serves', async () => {
	const configuration = shellConfiguration('7', [], { productId: 'framescaper' });
	const cacheStorage = new MemoryCacheStorage();
	await installOfflineShell({ configuration, cacheStorage, fetchImpl: async (url) => shellResponse(url) });

	for (const [path, expected] of [
		['/en/', 'root shell'],
		['/de/project', 'root shell'],
		['/embed/de/project', 'embedded shell'],
		['/framescaper/de/project', 'root shell'],
	]) {
		const result = await handleOfflineShellFetch({
			configuration,
			cacheStorage,
			fetchImpl: async () => { throw new TypeError('offline'); },
			request: { method: 'GET', mode: 'navigate', url: `https://framescaper.org${path}` },
			origin: 'https://framescaper.org',
		});
		assert.equal(await result.text(), expected, path);
	}
});

test('a root worker leaves navigations inside a foreign product scope to that product', async () => {
	const configuration = shellConfiguration('8', [], { foreignScopes: ['/framescaper/'] });
	const cacheStorage = new MemoryCacheStorage();
	await installOfflineShell({ configuration, cacheStorage, fetchImpl: async (url) => shellResponse(url) });
	const offline = async () => { throw new TypeError('offline'); };

	for (const path of ['/framescaper', '/framescaper/', '/framescaper/en/', '/framescaper/embed/en/']) {
		await assert.rejects(
			() => handleOfflineShellFetch({
				configuration,
				cacheStorage,
				fetchImpl: offline,
				request: { method: 'GET', mode: 'navigate', url: `https://soundscaper.org${path}` },
				origin: 'https://soundscaper.org',
			}),
			/offline/u,
			`${path} must reach the network rather than this product's shell`,
		);
	}
	const claimed = await handleOfflineShellFetch({
		configuration,
		cacheStorage,
		fetchImpl: offline,
		request: { method: 'GET', mode: 'navigate', url: 'https://soundscaper.org/framescaperish/en/' },
		origin: 'https://soundscaper.org',
	});
	assert.equal(await claimed.text(), 'root shell');
});

test('a worker refuses a scope its fallbacks or foreign scopes do not corroborate', () => {
	for (const overrides of [
		{ scope: '/framescaper' },
		{ scope: 'framescaper/' },
		{ scope: '//' },
		{ scope: '/../' },
		{ foreignScopes: ['/framescaper'] },
		{ foreignScopes: ['/'] },
		{ foreignScopes: ['/embed/', '/embed/'] },
		{ foreignScopes: ['/framescaper/', '/embed/'] },
		{ foreignScopes: '/framescaper/' },
		{ foreignScopes: ['/en/'] },
		{ fallbacks: { standard: '/framescaper/en/', embedded: '/embed/en/' } },
	]) {
		assert.throws(
			() => validateOfflineShellConfiguration(shellConfiguration('9', [], overrides)),
			/Offline shell (configuration|fallback inventory) is invalid\./u,
			JSON.stringify(overrides),
		);
	}
});
