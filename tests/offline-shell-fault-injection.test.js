/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	activateOfflineShell,
	handleOfflineShellFetch,
	installOfflineShell,
} from '../scripts/lib/offline-service-worker.mjs';
import {
	MemoryCacheStorage,
	response,
	shellCacheName,
	shellConfiguration,
	shellResponse,
} from './helpers/offline-shell-fixtures.js';

test('an invalid release identity refuses before any cache is opened or deleted', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const priorName = shellCacheName('a'.repeat(64));
	await (await cacheStorage.open(priorName)).put('/', response('prior shell'));
	cacheStorage.events.length = 0;
	const tampered = { ...shellConfiguration('b'), releaseId: 'f'.repeat(64) };

	await assert.rejects(
		() => installOfflineShell({
			configuration: tampered,
			cacheStorage,
			fetchImpl: async () => { throw new Error('the network must not be consulted'); },
		}),
		/release identity is invalid/u,
	);
	await assert.rejects(
		() => installOfflineShell({
			configuration: { ...shellConfiguration('b'), schemaVersion: 3 },
			cacheStorage,
			fetchImpl: async () => { throw new Error('the network must not be consulted'); },
		}),
		/configuration is invalid/u,
	);

	assert.deepEqual(cacheStorage.events, [], 'no cache is deleted before admission');
	assert.deepEqual(await cacheStorage.keys(), [priorName]);
});

test('a quota-exhausted cache put discards the candidate and keeps the prior release', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const priorName = shellCacheName('c'.repeat(64));
	await (await cacheStorage.open(priorName)).put('/', response('prior shell'));
	const configuration = shellConfiguration('d');
	const exhaustion = new DOMException('Cache storage quota exceeded.', 'QuotaExceededError');
	cacheStorage.failNextPutFor(shellCacheName(configuration.releaseId), exhaustion);

	await assert.rejects(
		() => installOfflineShell({
			configuration,
			cacheStorage,
			fetchImpl: async (url) => shellResponse(url),
		}),
		(error) => error === exhaustion,
	);

	assert.deepEqual(await cacheStorage.keys(), [priorName], 'the failed candidate cache is deleted');
	assert.equal(
		await (await cacheStorage.open(priorName)).match('/').then((value) => value?.text()),
		'prior shell',
	);
});

test('activation refuses a partially populated cache and preserves the prior shell', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const priorName = shellCacheName('1'.repeat(64));
	await (await cacheStorage.open(priorName)).put('/', response('prior shell'));
	const configuration = shellConfiguration('2');
	const partialName = shellCacheName(configuration.releaseId);
	await (await cacheStorage.open(partialName)).put('/', response('half-populated shell'));
	let claims = 0;

	await assert.rejects(
		() => activateOfflineShell({
			configuration,
			cacheStorage,
			clients: { claim: async () => { claims += 1; } },
		}),
		/cache is not complete/u,
	);

	assert.equal(claims, 0, 'clients are never claimed behind an incomplete cache');
	assert.deepEqual(await cacheStorage.keys(), [priorName, partialName], 'nothing is retired');
	const missing = await handleOfflineShellFetch({
		configuration,
		cacheStorage,
		fetchImpl: async (url) => shellResponse(url),
		request: new Request('https://soundscaper.org/assets/application.js'),
		origin: 'https://soundscaper.org',
	});
	assert.equal(await missing.text(), 'application code', 'a missing entry is verified and served from the network');
});

test('a fresh worker instance over a partial cache reinstalls completely and then activates', async () => {
	const cacheStorage = new MemoryCacheStorage();
	const priorName = shellCacheName('3'.repeat(64));
	await (await cacheStorage.open(priorName)).put('/', response('prior shell'));
	const configuration = shellConfiguration('4');
	const stagedName = shellCacheName(configuration.releaseId);
	await (await cacheStorage.open(stagedName)).put('/', response('abandoned staged shell'));

	await installOfflineShell({
		configuration,
		cacheStorage,
		fetchImpl: async (url) => shellResponse(url),
	});
	assert.ok(cacheStorage.events.includes(`delete:${stagedName}`), 'the abandoned candidate is discarded first');
	assert.equal(
		await (await cacheStorage.open(stagedName)).match('/en/').then((value) => value?.text()),
		'root shell',
		'the reinstalled release replaces the abandoned staged bytes',
	);

	await activateOfflineShell({
		configuration,
		cacheStorage,
		clients: { claim: async () => undefined },
	});
	assert.deepEqual(await cacheStorage.keys(), [stagedName], 'activation retires only after completeness');
});
