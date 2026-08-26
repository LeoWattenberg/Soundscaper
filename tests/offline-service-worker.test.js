/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

test('fetches use only the verified shell allowlist and state-committed runtime caches', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const configuration = shellConfiguration('9');
	await installOfflineShell({
		configuration,
		cacheStorage,
		fetchImpl: async (url) => shellResponse(url),
	});
	const runtime = runtimeRelease('8', 'verified runtime');
	await cacheRuntimeRelease(cacheStorage, runtime);
	await writeRuntimeState(cacheStorage, { active: runtime, previous: null });
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
	const runtimeResponse = await handleOfflineShellFetch({
		configuration,
		cacheStorage,
		fetchImpl,
		request: new Request(runtime.files[0].url),
		origin: 'https://soundscaper.org',
	});
	assert.equal(await runtimeResponse.text(), 'verified runtime');
	assert.equal(networkRequests, 0, 'the exact verified route is served without a redundant network request');
});

test('runtime fetches serve exact active and previous descriptors but never orphan final caches', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const active = runtimeRelease('4', 'active runtime');
	const previous = runtimeRelease('5', 'previous runtime');
	const orphan = runtimeRelease('6', 'orphan runtime');
	for (const release of [active, previous, orphan]) await cacheRuntimeRelease(cacheStorage, release);
	await writeRuntimeState(cacheStorage, { active, previous });
	const networkRequests = [];
	const fetchImpl = async (request) => {
		networkRequests.push(request.url);
		return response('network fallback');
	};
	const options = {
		configuration: shellConfiguration('4'),
		cacheStorage,
		fetchImpl,
		origin: 'https://soundscaper.org',
	};

	const activeResponse = await handleOfflineShellFetch({
		...options,
		request: new Request(active.files[0].url),
	});
	const previousResponse = await handleOfflineShellFetch({
		...options,
		request: new Request(previous.files[1].url),
	});
	const orphanResponse = await handleOfflineShellFetch({
		...options,
		request: new Request(orphan.files[0].url),
	});

	assert.equal(await activeResponse.text(), 'active runtime');
	assert.equal(await previousResponse.text(), 'previous runtime wasm');
	assert.equal(await orphanResponse.text(), 'network fallback');
	assert.deepEqual(networkRequests, [orphan.files[0].url]);
});

test('runtime fetches fail their body when committed cached bytes are truncated or altered', async () => {
	for (const [label, corrupt] of [
		['truncated', (bytes) => bytes.subarray(0, bytes.byteLength - 1)],
		['altered', (bytes) => Uint8Array.from(bytes, (value, index) => index === 0 ? value ^ 0xff : value)],
	]) {
		const cacheStorage = new MemoryCacheStorage();
		const release = runtimeRelease(label === 'truncated' ? 'a' : 'b', `${label} runtime`);
		await cacheRuntimeRelease(cacheStorage, release);
		await writeRuntimeState(cacheStorage, { active: release, previous: null });
		const file = release.files[0];
		const bytes = new TextEncoder().encode(file.contents);
		await (await cacheStorage.open(runtimeCacheName(release.releaseId))).put(
			file.url,
			runtimeResponse(file, corrupt(bytes)),
		);
		const result = await handleOfflineShellFetch({
			configuration: shellConfiguration('5'),
			cacheStorage,
			fetchImpl: async () => { throw new TypeError('offline'); },
			request: new Request(file.url),
			origin: 'https://soundscaper.org',
		});

		await assert.rejects(result.arrayBuffer(), /runtime cache.*(?:byte length|SHA-256)/iu, label);
	}
});

test('runtime verification remains exact across SHA-256 blocks and response chunks', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const contents = '0123456789abcdef'.repeat(80);
	const release = runtimeRelease('d', contents);
	await cacheRuntimeRelease(cacheStorage, release);
	await writeRuntimeState(cacheStorage, { active: release, previous: null });
	const file = release.files[0];
	const bytes = new TextEncoder().encode(contents);
	const chunks = [bytes.subarray(0, 1), bytes.subarray(1, 56), bytes.subarray(56, 64), bytes.subarray(64)];
	await (await cacheStorage.open(runtimeCacheName(release.releaseId))).put(
		file.url,
		new Response(new ReadableStream({
			pull(controller) {
				const chunk = chunks.shift();
				if (chunk) controller.enqueue(chunk);
				else controller.close();
			},
		}), {
			status: 200,
			headers: {
				'content-length': String(file.byteLength),
				'content-type': file.contentType,
			},
		}),
	);

	const result = await handleOfflineShellFetch({
		configuration: shellConfiguration('d'),
		cacheStorage,
		fetchImpl: async () => { throw new TypeError('offline'); },
		request: new Request(file.url),
		origin: 'https://soundscaper.org',
	});
	assert.equal(await result.text(), contents);
});

test('runtime fetches reject non-normalized cached response metadata', async () => {
	for (const headers of [
		{ 'content-encoding': 'gzip' },
		{ 'content-length': '1' },
		{ 'content-range': 'bytes 0-1/2' },
		{ 'content-type': 'application/octet-stream' },
		{ 'transfer-encoding': 'chunked' },
	]) {
		const cacheStorage = new MemoryCacheStorage();
		const release = runtimeRelease('e', 'runtime with normalized metadata');
		await cacheRuntimeRelease(cacheStorage, release);
		await writeRuntimeState(cacheStorage, { active: release, previous: null });
		const file = release.files[0];
		const bytes = new TextEncoder().encode(file.contents);
		await (await cacheStorage.open(runtimeCacheName(release.releaseId))).put(
			file.url,
			new Response(bytes, {
				status: 200,
				headers: {
					'content-length': String(file.byteLength),
					'content-type': file.contentType,
					...headers,
				},
			}),
		);
		const result = await handleOfflineShellFetch({
			configuration: shellConfiguration('e'),
			cacheStorage,
			fetchImpl: async () => response('network fallback'),
			request: new Request(file.url),
			origin: 'https://soundscaper.org',
		});
		assert.equal(await result.text(), 'network fallback');
	}
});

test('malformed and oversized runtime state fails closed before opening a release cache', async () => {
	for (const stateBody of [
		JSON.stringify({ schemaVersion: 1, active: null, previous: null, extra: true }),
		'x'.repeat(64 * 1024 + 1),
	]) {
		const cacheStorage = new MemoryCacheStorage();
		const release = runtimeRelease('7', 'uncommitted runtime');
		await cacheRuntimeRelease(cacheStorage, release);
		await writeRuntimeStateBytes(cacheStorage, new TextEncoder().encode(stateBody));
		let networkRequests = 0;
		const result = await handleOfflineShellFetch({
			configuration: shellConfiguration('6'),
			cacheStorage,
			fetchImpl: async () => {
				networkRequests += 1;
				return response('network fallback');
			},
			request: new Request(release.files[0].url),
			origin: 'https://soundscaper.org',
		});
		assert.equal(await result.text(), 'network fallback');
		assert.equal(networkRequests, 1);
	}
});

test('unknown offline navigations preserve embed mode and never cross product boundaries', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const configuration = shellConfiguration('7', [
		asset('/framescaper/en/', 'framescaper shell'),
		asset('/framescaper/embed/en/', 'framescaper embedded shell'),
	]);
	const contents = new Map(configuration.assets.map(({ url }) => [
		url,
		url === '/framescaper/en/' ? 'framescaper shell'
			: url === '/framescaper/embed/en/' ? 'framescaper embedded shell'
				: url === '/en/' ? 'root shell'
					: url === '/embed/en/' ? 'embedded shell' : 'application code',
	]));
	await installOfflineShell({
		configuration,
		cacheStorage,
		fetchImpl: async (url) => response(contents.get(url)),
	});
	const fetchImpl = async () => { throw new TypeError('offline'); };

	const soundscaper = await handleOfflineShellFetch({
		configuration,
		cacheStorage,
		fetchImpl,
		request: { method: 'GET', mode: 'navigate', url: 'https://soundscaper.org/embed/en/project' },
		origin: 'https://soundscaper.org',
	});

	assert.equal(await soundscaper.text(), 'embedded shell');
	await assert.rejects(
		() => handleOfflineShellFetch({
			configuration,
			cacheStorage,
			fetchImpl,
			request: { method: 'GET', mode: 'navigate', url: 'https://soundscaper.org/framescaper/embed/en/project' },
			origin: 'https://soundscaper.org',
		}),
		/offline/u,
	);
});

function runtimeRelease(seed, javascriptContents) {
	const releaseId = seed.repeat(64);
	const baseUrl = `https://assets.soundscaper.org/runtime/ffmpeg/0.12.10/releases/${releaseId}/`;
	const values = [
		['ffmpeg-core.js', javascriptContents, 'text/javascript; charset=utf-8'],
		['ffmpeg-core.wasm', `${javascriptContents} wasm`, 'application/wasm'],
	];
	return Object.freeze({
		schemaVersion: 1,
		releaseId,
		manifestSha256: releaseId,
		baseUrl,
		files: Object.freeze(values.map(([name, contents, contentType]) => {
			const bytes = new TextEncoder().encode(contents);
			return Object.freeze({
				name,
				url: `${baseUrl}${name}`,
				byteLength: bytes.byteLength,
				sha256: createHash('sha256').update(bytes).digest('hex'),
				contentType,
				contents,
			});
		})),
	});
}

async function cacheRuntimeRelease(cacheStorage, release) {
	const cache = await cacheStorage.open(runtimeCacheName(release.releaseId));
	for (const file of release.files) {
		await cache.put(file.url, runtimeResponse(file, new TextEncoder().encode(file.contents)));
	}
}

function runtimeResponse(file, bytes) {
	return new Response(bytes, {
		status: 200,
		headers: {
			'content-length': String(file.byteLength),
			'content-type': file.contentType,
		},
	});
}

async function writeRuntimeState(cacheStorage, state) {
	await writeRuntimeStateBytes(cacheStorage, new TextEncoder().encode(JSON.stringify({
		schemaVersion: 1,
		active: runtimeStateRelease(state.active),
		previous: state.previous ? runtimeStateRelease(state.previous) : null,
	})));
}

function runtimeStateRelease(release) {
	return {
		...release,
		files: release.files.map(({ contents: _contents, ...file }) => file),
	};
}

async function writeRuntimeStateBytes(cacheStorage, bytes) {
	const cache = await cacheStorage.open('soundscaper-ffmpeg-runtime-v1-state');
	await cache.put(
		'https://soundscaper.org/.soundscaper/offline/ffmpeg-runtime-state-v1.json',
		new Response(bytes, {
			status: 200,
			headers: {
				'content-length': String(bytes.byteLength),
				'content-type': 'application/json; charset=utf-8',
			},
		}),
	);
}

function runtimeCacheName(releaseId) {
	return `soundscaper-ffmpeg-runtime-v1-${releaseId}`;
}
