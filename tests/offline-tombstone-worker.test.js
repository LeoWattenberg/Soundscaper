/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import {
	renderTombstoneServiceWorker,
	retiredProductTargetOrigin,
	retiredWebWorkers,
	tombstoneConfiguration,
	tombstoneRedirectUrl,
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

	assert.deepEqual([...worker.listeners.keys()].sort(), ['activate', 'fetch', 'install']);
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

test('activation sends every controlled window to the new origin with its locale intact', async () => {
	const worker = await tombstoneWorker({
		clientUrls: [
			`${SERVING_ORIGIN}/framescaper/de/`,
			`${SERVING_ORIGIN}/framescaper/pt-BR/`,
			`${SERVING_ORIGIN}/framescaper/embed/de/`,
			`${SERVING_ORIGIN}/framescaper/`,
			`${SERVING_ORIGIN}/framescaper/de/?project=demo`,
		],
	});

	await worker.dispatch('activate');

	assert.deepEqual(worker.clients.windows.map(({ navigations }) => navigations), [
		['https://framescaper.org/de/'],
		['https://framescaper.org/pt-BR/'],
		['https://framescaper.org/embed/de/'],
		['https://framescaper.org/'],
		['https://framescaper.org/de/?project=demo'],
	]);
});

test('activation never enumerates uncontrolled clients nor navigates a window outside the retired scope', async () => {
	const worker = await tombstoneWorker({
		clientUrls: [
			`${SERVING_ORIGIN}/en/`,
			`${SERVING_ORIGIN}/embed/en/`,
			`${SERVING_ORIGIN}/framescaperish/en/`,
			'https://example.test/framescaper/en/',
			`${SERVING_ORIGIN}/framescaper/fr/`,
		],
	});

	await worker.dispatch('activate');

	assert.deepEqual(worker.clients.matchAllOptions, [{ type: 'window' }]);
	assert.deepEqual(worker.clients.windows.map(({ navigations }) => navigations), [
		[], [], [], [], ['https://framescaper.org/fr/'],
	]);
});

test('a window that refuses to be navigated does not stop the retirement', async () => {
	const worker = await tombstoneWorker({ clientUrls: [`${SERVING_ORIGIN}/framescaper/de/`] });
	worker.clients.windows[0].navigate = () => Promise.reject(new TypeError('client is not focusable'));

	await worker.dispatch('activate');

	assert.equal(worker.registration.unregistered, 1);
	assert.deepEqual(await worker.cacheStorage.keys(), SURVIVING_CACHES);
});

test('a second activation is harmless', async () => {
	const worker = await tombstoneWorker();

	await worker.dispatch('activate');
	await worker.dispatch('activate');

	assert.equal(worker.clients.claimed, 2);
	assert.equal(worker.registration.unregistered, 2);
	assert.deepEqual(await worker.cacheStorage.keys(), SURVIVING_CACHES);
	assert.deepEqual(worker.cacheStorage.events, RETIRED_CACHES.map((name) => `delete:${name}`));
	assert.deepEqual(worker.clients.windows.map(({ navigations }) => navigations), [['https://framescaper.org/de/']]);
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

test('a controlled navigation is redirected to the new origin before any 301 exists', async () => {
	const worker = await tombstoneWorker();
	assert.equal(worker.scope.fetch, undefined, 'the retired path must be answered without reaching the network');

	for (const [requested, expected] of [
		['/framescaper/', 'https://framescaper.org/'],
		['/framescaper/en/', 'https://framescaper.org/en/'],
		['/framescaper/de/', 'https://framescaper.org/de/'],
		['/framescaper/pt-BR/', 'https://framescaper.org/pt-BR/'],
		['/framescaper/embed/de/', 'https://framescaper.org/embed/de/'],
		['/framescaper/de/?project=demo', 'https://framescaper.org/de/?project=demo'],
	]) {
		const response = await worker.navigateTo(requested);
		assert.equal(response?.status, 302, `${requested} must be redirected`);
		assert.equal(response.headers.get('location'), expected);
	}
});

test('the tombstone leaves subresources, form posts and foreign origins to the network', async () => {
	const worker = await tombstoneWorker();

	assert.equal(await worker.dispatchFetch({
		method: 'GET', mode: 'no-cors', url: `${SERVING_ORIGIN}/framescaper/en/logo.svg`,
	}), null);
	assert.equal(await worker.dispatchFetch({
		method: 'POST', mode: 'navigate', url: `${SERVING_ORIGIN}/framescaper/en/`,
	}), null);
	assert.equal(await worker.dispatchFetch({
		method: 'GET', mode: 'navigate', url: 'https://example.test/framescaper/en/',
	}), null);
	assert.equal(await worker.navigateTo('/en/'), null);
});

test('no retired path can steer a visitor off the new origin', async () => {
	const worker = await tombstoneWorker();

	for (const requested of ['/framescaper//evil.example/', '/framescaper/..//evil.example/']) {
		assert.equal(await worker.navigateTo(requested), null, `${requested} must not be redirected`);
	}
	for (const requested of [
		'/framescaper/embed//evil.example/',
		'/framescaper/%2F%2Fevil.example/',
		'/framescaper/en/@evil.example',
	]) {
		const location = (await worker.navigateTo(requested))?.headers.get('location');
		assert.equal(new URL(String(location)).origin, 'https://framescaper.org', requested);
	}
	assert.equal(tombstoneRedirectUrl('https://soundscaper.org/framescaper//evil.example/', RETIRED), null);
	assert.equal(tombstoneRedirectUrl('https://soundscaper.org/framescaper/\\evil.example/', RETIRED), null);
	assert.equal(tombstoneRedirectUrl('https://framescaper.org/de/', RETIRED), null);
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
		Response,
	};
	runInNewContext(renderTombstoneServiceWorker(configuration), scope);
	const dispatch = async (type) => {
		const pending = [];
		listeners.get(type)({ waitUntil: (value) => pending.push(value) });
		await Promise.all(pending);
	};
	const dispatchFetch = async (request) => {
		let responded = null;
		listeners.get('fetch')({ request, respondWith: (value) => {
			responded = value;
		} });
		return await responded;
	};
	return {
		cacheStorage,
		clients,
		registration,
		listeners,
		scope,
		dispatch,
		dispatchFetch,
		navigateTo: (path) => dispatchFetch({ method: 'GET', mode: 'navigate', url: `${SERVING_ORIGIN}${path}` }),
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
