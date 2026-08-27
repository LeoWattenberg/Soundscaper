/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	handleOfflineShellFetch,
	installOfflineShell,
	renderOfflineServiceWorker,
} from '../scripts/lib/offline-service-worker.mjs';
import {
	asset,
	MemoryCacheStorage,
	shellCacheName,
	shellConfiguration,
	shellResponse,
} from './helpers/offline-shell-fixtures.js';

// The build collects every emitted document as a shell asset, so the two
// cross-origin project transfer documents are part of the release inventory
// even though neither product installs them. They are the shape that broke:
// their first path segment is not a locale, and the Soundscaper worker's scope
// is '/', so they fall inside it.
const TRANSFER_DOCUMENTS = Object.freeze([
	asset('/transfer/receive/', 'transfer receive document'),
	asset('/transfer/send/', 'transfer send document'),
]);

function transferConfiguration(seed) {
	return shellConfiguration(seed, TRANSFER_DOCUMENTS);
}

async function installedShell(seed) {
	const configuration = transferConfiguration(seed);
	const cacheStorage = new MemoryCacheStorage();
	await installOfflineShell({
		configuration,
		cacheStorage,
		fetchImpl: async (url) => shellResponse(url),
	});
	return { configuration, cacheStorage };
}

test('an offline transfer navigation fails rather than resolving to an editor shell', async () => {
	const { configuration, cacheStorage } = await installedShell('9');

	for (const url of [
		'https://soundscaper.org/transfer/receive/',
		'https://soundscaper.org/transfer/send/',
		'https://soundscaper.org/transfer/receive/?session=7',
		'https://soundscaper.org/transfer/send',
		'https://soundscaper.org/transfer/',
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
			`${url} must never be answered from the shell cache`,
		);
	}
});

test('a transfer navigation is handed to the network verbatim and never cached by the worker', async () => {
	const { configuration, cacheStorage } = await installedShell('a');
	const document = new Response('transfer receive document', {
		status: 200,
		headers: {
			'content-length': String(Buffer.byteLength('transfer receive document')),
			'content-type': 'text/html; charset=utf-8',
			'cross-origin-opener-policy': 'unsafe-none',
		},
	});
	const requested = [];

	const result = await handleOfflineShellFetch({
		configuration,
		cacheStorage,
		fetchImpl: async (input) => {
			requested.push(input);
			return document;
		},
		request: { method: 'GET', mode: 'navigate', url: 'https://soundscaper.org/transfer/receive/' },
		origin: 'https://soundscaper.org',
	});

	assert.equal(result, document, 'the network response reaches the popup unchanged');
	assert.equal(result.headers.get('cross-origin-opener-policy'), 'unsafe-none');
	assert.equal(requested.length, 1);
	assert.equal(requested[0]?.url, 'https://soundscaper.org/transfer/receive/');
	const cache = await cacheStorage.open(shellCacheName(configuration.releaseId));
	assert.equal(await cache.match('/transfer/receive/'), undefined, 'a no-cache document is never stored');
});

test('a subresource request for a transfer document is declined too', async () => {
	const { configuration, cacheStorage } = await installedShell('b');
	const body = new Response('transfer send document', { status: 200 });

	const result = await handleOfflineShellFetch({
		configuration,
		cacheStorage,
		fetchImpl: async () => body,
		request: { method: 'GET', mode: 'cors', url: 'https://soundscaper.org/transfer/send/' },
		origin: 'https://soundscaper.org',
	});

	assert.equal(result, body);
	const cache = await cacheStorage.open(shellCacheName(configuration.releaseId));
	assert.equal(await cache.match('/transfer/send/'), undefined);
});

test('product navigations keep their verified English fallback', async () => {
	const { configuration, cacheStorage } = await installedShell('c');

	const result = await handleOfflineShellFetch({
		configuration,
		cacheStorage,
		fetchImpl: async () => { throw new TypeError('offline'); },
		request: { method: 'GET', mode: 'navigate', url: 'https://soundscaper.org/de/project' },
		origin: 'https://soundscaper.org',
	});

	assert.equal(await result.text(), 'root shell');
});

test('the generated worker carries the transfer exclusion', () => {
	const source = renderOfflineServiceWorker(transferConfiguration('d'));
	assert.ok(source.includes('function pathIsProjectTransferDocument('), 'the predicate is inlined');
	assert.ok(
		source.includes('pathIsProjectTransferDocument(requestUrl.pathname)'),
		'the shipped fetch handler consults it',
	);
	assert.ok(
		source.includes('if (pathIsProjectTransferDocument(pathname)) return null;'),
		'the shipped navigation fallback consults it too',
	);
});
