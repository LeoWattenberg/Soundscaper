/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	handleOfflineShellFetch,
	installOfflineShell,
} from '../scripts/lib/offline-service-worker.mjs';
import {
	asset,
	MemoryCacheStorage,
	response,
	shellConfiguration,
	shellResponse,
} from './helpers/offline-shell-fixtures.js';

test('retired FFmpeg runtime requests bypass legacy caches and use the network', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const configuration = shellConfiguration('9');
	await installOfflineShell({
		configuration,
		cacheStorage,
		fetchImpl: async (url) => shellResponse(url),
	});
	const runtimeUrl = 'https://assets.soundscaper.org/runtime/ffmpeg/0.12.10/releases/'
		+ `${'8'.repeat(64)}/ffmpeg-core.wasm`;
	const legacy = await cacheStorage.open(`soundscaper-ffmpeg-runtime-v1-${'8'.repeat(64)}`);
	await legacy.put(runtimeUrl, response('legacy cached runtime'));
	let networkRequests = 0;

	const result = await handleOfflineShellFetch({
		configuration,
		cacheStorage,
		fetchImpl: async (request) => {
			networkRequests += 1;
			assert.equal(request.url, runtimeUrl);
			return response('network response');
		},
		request: new Request(runtimeUrl),
		origin: 'https://soundscaper.org',
	});

	assert.equal(await result.text(), 'network response');
	assert.equal(networkRequests, 1);
});

test('unknown offline navigations preserve embed mode and never cross product boundaries', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const configuration = shellConfiguration('7', [
		asset('/framescaper/en/', 'framescaper shell'),
		asset('/framescaper/embed/en/', 'framescaper embedded shell'),
	], { foreignScopes: ['/framescaper/'] });
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
