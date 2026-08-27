/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import {
	renderTombstoneServiceWorker,
	retiredProductTargetOrigin,
	retiredWebWorkers,
	tombstoneConfiguration,
	validateTombstoneConfiguration,
} from '../scripts/lib/offline-tombstone-worker.mjs';
import { MemoryCacheStorage } from './helpers/offline-shell-fixtures.js';

const RETIRED = tombstoneConfiguration({
	productId: 'framescaper',
	scope: '/framescaper/',
	targetOrigin: 'https://framescaper.org',
});
const SERVING_ORIGIN = 'https://soundscaper.org';
const RETIRED_CACHES = [
	`soundscaper-application-shell-v2-framescaper-${'a'.repeat(64)}`,
	`soundscaper-application-shell-v2-framescaper-${'b'.repeat(64)}`,
];
const SURVIVING_CACHES = [
	`soundscaper-application-shell-v2-soundscaper-${'c'.repeat(64)}`,
	`soundscaper-application-shell-v1-${'d'.repeat(64)}`,
	`soundscaper-ffmpeg-runtime-v1-${'e'.repeat(64)}`,
	'soundscaper-ffmpeg-runtime-v1-state',
];

test('the retired worker is inert until a browser registers it', async () => {
	const worker = await tombstoneWorker();

	assert.deepEqual([...worker.listeners.keys()].sort(), ['activate', 'install']);
	assert.equal(worker.clients.claimed, 0);
	assert.equal(worker.registration.unregistered, 0);
	assert.equal(worker.skipWaited, 0);
	assert.deepEqual(await worker.cacheStorage.keys(), [...RETIRED_CACHES, ...SURVIVING_CACHES]);
});

test('installing skips waiting so the retired worker replaces its predecessor at once', async () => {
	const worker = await tombstoneWorker();

	await worker.dispatch('install');

	assert.equal(worker.skipWaited, 1);
	assert.equal(worker.registration.unregistered, 0, 'installing must not retire the registration before it activates');
	assert.deepEqual(await worker.cacheStorage.keys(), [...RETIRED_CACHES, ...SURVIVING_CACHES]);
});

test('activation claims its clients, retires only its own caches, and unregisters itself', async () => {
	const worker = await tombstoneWorker();

	await worker.dispatch('activate');

	assert.equal(worker.clients.claimed, 1);
	assert.equal(worker.registration.unregistered, 1);
	assert.deepEqual(await worker.cacheStorage.keys(), SURVIVING_CACHES);
	assert.deepEqual(worker.cacheStorage.events, RETIRED_CACHES.map((name) => `delete:${name}`));
});

test('a second activation is harmless', async () => {
	const worker = await tombstoneWorker();

	await worker.dispatch('activate');
	await worker.dispatch('activate');

	assert.equal(worker.clients.claimed, 2);
	assert.equal(worker.registration.unregistered, 2);
	assert.deepEqual(await worker.cacheStorage.keys(), SURVIVING_CACHES);
	assert.deepEqual(worker.cacheStorage.events, RETIRED_CACHES.map((name) => `delete:${name}`));
	assert.deepEqual(worker.clients.windows.map(({ navigations }) => navigations), [[]]);
});

test('an activation that cannot retire a cache fails closed and names what survived', async () => {
	const worker = await tombstoneWorker();
	worker.cacheStorage.delete = async () => false;

	await assert.rejects(
		() => worker.dispatch('activate'),
		/Retired framescaper service worker could not retire the caches soundscaper-application-shell-v2-framescaper-a{64}, soundscaper-application-shell-v2-framescaper-b{64}\./u,
	);
	assert.equal(worker.registration.unregistered, 1, 'the registration is still retired so the network is reachable');
});

test('the retired worker answers nothing, so every request reaches the network', async () => {
	const worker = await tombstoneWorker();

	// A tombstone with no fetch handler is more than inert: a worker that
	// registers no fetch listener is skipped for navigations altogether, so the
	// retired path is served by the origin — and by whatever redirect the origin
	// has deployed there — from the first load after activation. Answering out of
	// the old cache is what made the retired path unreachable in the first place.
	assert.deepEqual([...worker.listeners.keys()].sort(), ['activate', 'install']);
	assert.equal(worker.listeners.has('fetch'), false);
	assert.equal(worker.scope.fetch, undefined, 'the tombstone never fetches anything itself either');
});

test('activation leaves every controlled window exactly where it is', async () => {
	// Browser storage is partitioned per origin, so the project an open window is
	// editing is not readable from the new origin — that partitioning is the whole
	// reason the cross-origin transfer feature exists. Force-navigating a window
	// to the new origin takes the user away from their own work and lands them
	// somewhere that cannot see it, which is strictly worse than leaving them be.
	// The window keeps running; the next navigation is the user's to make, and it
	// reaches the network.
	const worker = await tombstoneWorker({
		clientUrls: [
			`${SERVING_ORIGIN}/framescaper/de/`,
			`${SERVING_ORIGIN}/framescaper/embed/de/?project=demo`,
			`${SERVING_ORIGIN}/en/`,
		],
	});

	await worker.dispatch('activate');

	assert.deepEqual(worker.clients.windows.map(({ url, navigations }) => ({ url, navigations })), [
		{ url: `${SERVING_ORIGIN}/framescaper/de/`, navigations: [] },
		{ url: `${SERVING_ORIGIN}/framescaper/embed/de/?project=demo`, navigations: [] },
		{ url: `${SERVING_ORIGIN}/en/`, navigations: [] },
	]);
	assert.deepEqual(worker.clients.matchAllOptions, [], 'a worker that navigates nobody enumerates nobody');
	assert.equal(worker.registration.unregistered, 1);
	assert.deepEqual(await worker.cacheStorage.keys(), SURVIVING_CACHES);
});

test('the emitted worker carries no way to move a window or to answer a request', () => {
	const source = renderTombstoneServiceWorker(RETIRED);

	for (const forbidden of ['.navigate(', 'Response.redirect', 'respondWith', "addEventListener('fetch'", 'matchAll']) {
		assert.equal(source.includes(forbidden), false, forbidden);
	}
	// The new origin is still recorded: it is what the deployment audit publishes
	// as the place the retired product went, and what the retention window is for.
	assert.ok(source.includes('"targetOrigin":"https://framescaper.org"'));
});

test('a tombstone may never claim the origin root or an unverified new origin', () => {
	for (const overrides of [
		{ scope: '/' },
		{ scope: 'framescaper/' },
		{ scope: '/framescaper' },
		{ scope: '/framescaper/../' },
		{ productId: 'lightscaper' },
		{ targetOrigin: 'http://framescaper.org' },
		{ targetOrigin: 'https://framescaper.org/' },
		{ targetOrigin: 'https://framescaper.org/framescaper' },
		{ targetOrigin: 'https://user:pass@framescaper.org' },
	]) {
		assert.throws(
			() => validateTombstoneConfiguration({ ...RETIRED, ...overrides }),
			/Retired product service worker configuration is invalid\./u,
			JSON.stringify(overrides),
		);
	}
	assert.throws(() => validateTombstoneConfiguration({ ...RETIRED, extra: 1 }), /configuration is invalid/u);
});

test('the tombstone is emitted only when the build asks for it, and never over a product root', () => {
	const soundscaperBuild = routingFixture('soundscaper');

	assert.deepEqual(retiredWebWorkers(soundscaperBuild, {}), []);
	assert.deepEqual(retiredWebWorkers(soundscaperBuild, { FRAMESCAPER_TOMBSTONE: '' }), []);
	assert.deepEqual(
		retiredWebWorkers(soundscaperBuild, { FRAMESCAPER_TOMBSTONE: '1' }).map(({ scriptUrl, configuration }) =>
			[scriptUrl, configuration.targetOrigin]),
		[['/framescaper/service-worker.js', 'https://framescaper.org']],
	);
	assert.equal(
		retiredWebWorkers(soundscaperBuild, {
			FRAMESCAPER_TOMBSTONE: '1',
			FRAMESCAPER_SITE: 'https://staging.framescaper.org',
		})[0].configuration.targetOrigin,
		'https://staging.framescaper.org',
	);
	assert.throws(
		() => retiredWebWorkers(soundscaperBuild, { FRAMESCAPER_TOMBSTONE: 'true' }),
		/FRAMESCAPER_TOMBSTONE must be "1" or unset; received "true"\./u,
	);
	assert.throws(
		() => retiredWebWorkers(routingFixture('framescaper'), { FRAMESCAPER_TOMBSTONE: '1' }),
		/cannot retire the service worker a framescaper build serves at its own root/u,
	);
	assert.throws(
		() => retiredProductTargetOrigin({ FRAMESCAPER_SITE: 'https://framescaper.org/framescaper' }),
		/FRAMESCAPER_SITE must be an https origin with no path, query or fragment/u,
	);
});

test('the emitted worker carries its own configuration and nothing of the offline shell', () => {
	const source = renderTombstoneServiceWorker(RETIRED);

	assert.ok(source.includes(`const RETIRED_SHELL = ${JSON.stringify(RETIRED)};`));
	assert.ok(source.includes('attachRetiredServiceWorker(globalThis, RETIRED_SHELL);'));
	assert.doesNotMatch(source, /installOfflineShell|handleApplicationShellFetch|installUrls/u);
});

function routingFixture(productId) {
	const plans = productId === 'framescaper'
		? [{ productId: 'framescaper', scope: '/' }]
		: [{ productId: 'soundscaper', scope: '/' }, { productId: 'framescaper', scope: '/framescaper/' }];
	return {
		productId,
		workers: plans.map((plan) => ({
			productId: plan.productId,
			scope: plan.scope,
			scriptUrl: `${plan.scope === '/' ? '' : plan.scope.slice(0, -1)}/service-worker.js`,
		})),
	};
}

/** Evaluates the emitted worker inside a fake ServiceWorkerGlobalScope. */
async function tombstoneWorker({
	clientUrls = [`${SERVING_ORIGIN}/framescaper/de/`],
	configuration = RETIRED,
} = {}) {
	const cacheStorage = new MemoryCacheStorage();
	for (const name of [...RETIRED_CACHES, ...SURVIVING_CACHES]) await cacheStorage.open(name);
	cacheStorage.events.length = 0;
	const clients = new FakeClients(clientUrls);
	const registration = new FakeRegistration();
	const listeners = new Map();
	const scope = {
		addEventListener: (type, handler) => listeners.set(type, handler),
		skipWaiting: () => {
			scope.skipWaited += 1;
			return Promise.resolve();
		},
		skipWaited: 0,
		caches: cacheStorage,
		clients,
		registration,
		location: { origin: SERVING_ORIGIN },
		URL,
	};
	runInNewContext(renderTombstoneServiceWorker(configuration), scope);
	const dispatch = async (type) => {
		const pending = [];
		listeners.get(type)({ waitUntil: (value) => pending.push(value) });
		await Promise.all(pending);
	};
	return {
		cacheStorage,
		clients,
		registration,
		listeners,
		scope,
		dispatch,
		get skipWaited() {
			return scope.skipWaited;
		},
	};
}

class FakeClients {
	claimed = 0;
	matchAllOptions = [];

	constructor(urls) {
		this.windows = urls.map((url) => new FakeWindowClient(url));
	}

	async claim() {
		this.claimed += 1;
	}

	async matchAll(options) {
		this.matchAllOptions.push({ ...options });
		return this.windows;
	}
}

class FakeWindowClient {
	navigations = [];

	constructor(url) {
		this.url = url;
	}

	async navigate(target) {
		this.navigations.push(target);
		this.url = target;
		return null;
	}
}

class FakeRegistration {
	unregistered = 0;

	async unregister() {
		this.unregistered += 1;
		return true;
	}
}
