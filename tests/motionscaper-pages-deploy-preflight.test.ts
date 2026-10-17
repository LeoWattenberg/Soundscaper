/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	pagesCachePolicyDescriptors, verifyLivePagesCachePolicy,
} from '../scripts/lib/pages-deploy-preflight.mjs';
import { webBuildRouting } from '../scripts/lib/product-web-routing.mjs';

const routing = webBuildRouting({ SCAPE_PRODUCT: 'motionscaper' });
const assetPath = '/assets/motionscaper-entry-AbCd1234.js';
// Independent expected inventory: the new product has no predecessor artwork.
// Its manifest emits four icons, no screenshots, plus its Apple icon and logos.
const pendingArtwork = [
	'/manifest-motionscaper.webmanifest',
	'/logo/motionscaper.svg',
	'/logo/mindscaper.svg',
	'/offline-icons/motionscaper-180.png',
	'/offline-icons/motionscaper-192.png',
	'/offline-icons/motionscaper-512.png',
	'/offline-icons/motionscaper-maskable-192.png',
	'/offline-icons/motionscaper-maskable-512.png',
] as const;
const predecessor = [
	{ path: '/', expectation: 'served', cacheControl: 'no-cache' },
	{ path: '/en/', expectation: 'served', cacheControl: 'no-cache' },
	{ path: '/embed/en/', expectation: 'served', cacheControl: 'no-cache' },
	{ path: '/offline-shell.json', expectation: 'served', cacheControl: 'no-store' },
	{ path: '/service-worker.js', expectation: 'served', cacheControl: 'no-store', serviceWorkerAllowed: '/' },
	{ path: assetPath, expectation: 'served', cacheControl: 'public, max-age=31536000, immutable' },
];
const published = [
	...predecessor,
	...pendingArtwork.map(path => ({ path, expectation: 'served', cacheControl: 'no-cache' })),
];
const byPath = <T extends { path: string }>(rows: readonly T[]) => [...rows].sort((a, b) => a.path.localeCompare(b.path));

test('Motionscaper Pages distinguishes predecessor routes from every newly published own artwork path', () => {
	assert.equal(routing.site.origin, 'https://motionscaper.org');
	assert.deepEqual(routing.plans.map(plan => plan.productId), ['motionscaper']);
	assert.deepEqual(byPath(pagesCachePolicyDescriptors({ routing, assetPath, includeRetired: false })), byPath(predecessor));
	assert.deepEqual(byPath(pagesCachePolicyDescriptors({ routing, assetPath })), byPath(published));
	assert.deepEqual(byPath(pagesCachePolicyDescriptors({ routing, assetPath, includePending: false })), byPath(predecessor));
	assert.deepEqual(byPath(pagesCachePolicyDescriptors({ routing, assetPath, includeRetired: false, includePending: true })), byPath(published));
});

interface ServedRoute { cacheControl: string; serviceWorkerAllowed?: string; status?: number }

function deployment(includeArtwork = true) {
	const served = new Map<string, ServedRoute>((includeArtwork ? published : predecessor)
		.map(({ path, ...descriptor }) => [path, descriptor]));
	const requests: URL[] = [];
	const fetchImpl: typeof fetch = async (input, init) => {
		const url = new URL(input instanceof Request ? input.url : input);
		assert.equal(url.origin, 'https://motionscaper.org');
		assert.match(url.searchParams.get('pages-deploy-audit') ?? '', /^[a-z0-9]+$/u);
		assert.equal(init?.redirect, 'manual');
		assert.equal(init.cache, 'no-store');
		assert.equal(init.credentials, 'omit');
		requests.push(url);
		const route = served.get(url.pathname);
		if (!route) return new Response(null, { status: 404 });
		const body = url.pathname === '/offline-shell.json'
			? JSON.stringify({ assets: [{ url: assetPath }] }) : 'own deployed bytes';
		return new Response(body, {
			status: route.status ?? 200,
			headers: {
				'cache-control': route.cacheControl,
				...(route.serviceWorkerAllowed ? { 'service-worker-allowed': route.serviceWorkerAllowed } : {}),
			},
		});
	};
	return { served, requests, fetchImpl };
}

test('Motionscaper live Pages audits all published own routes without foreign artwork or retired paths', async () => {
	const live = deployment();
	assert.deepEqual(await verifyLivePagesCachePolicy({ routing, fetchImpl: live.fetchImpl }), {
		verifiedRouteCount: 14, assetPath, coldStart: false,
	});
	assert.deepEqual([...new Set(live.requests.map(url => url.pathname))].sort(), published.map(row => row.path).sort());
	assert.equal(live.requests.length, 16, 'one origin probe and one live asset inventory read precede the fourteen audited routes');
	assert.equal(new Set(live.requests.map(url => url.search)).size, 1, 'one cache-busting identity binds the complete audit');
	const prior = deployment(false);
	assert.deepEqual(await verifyLivePagesCachePolicy({ routing, fetchImpl: prior.fetchImpl, includeRetired: false }), {
		verifiedRouteCount: 6, assetPath, coldStart: false,
	});
});

test('Motionscaper Pages refuses each missing published manifest, logo or install icon', async () => {
	for (const path of pendingArtwork) {
		const live = deployment();
		live.served.delete(path);
		await assert.rejects(() => verifyLivePagesCachePolicy({ routing, fetchImpl: live.fetchImpl }), error => {
			assert.ok(error instanceof Error);
			assert.equal(error.message, `Pages cache-policy audit received HTTP 404 for ${path}`);
			return true;
		});
	}
});

test('Motionscaper Pages preserves strict cache and worker-scope policy without inheriting another zone allowance', async () => {
	for (const [path, cacheControl] of [
		['/logo/motionscaper.svg', 'max-age=14400'],
		['/offline-icons/motionscaper-maskable-512.png', 'public, max-age=31536000, immutable'],
		['/offline-shell.json', 'no-cache'],
		['/service-worker.js', 'no-cache'],
		[assetPath, 'no-cache'],
	]) {
		const live = deployment();
		const route = live.served.get(path); assert.ok(route);
		route.cacheControl = cacheControl;
		await assert.rejects(() => verifyLivePagesCachePolicy({ routing, fetchImpl: live.fetchImpl }), /Cache-Control is invalid/u);
	}
	for (const scope of [undefined, '/motionscaper/']) {
		const live = deployment();
		const worker = live.served.get('/service-worker.js'); assert.ok(worker);
		worker.serviceWorkerAllowed = scope;
		await assert.rejects(() => verifyLivePagesCachePolicy({ routing, fetchImpl: live.fetchImpl }), /Service-Worker-Allowed is invalid/u);
	}
	const redirected = deployment();
	const icon = redirected.served.get('/offline-icons/motionscaper-192.png'); assert.ok(icon);
	icon.status = 301;
	await assert.rejects(() => verifyLivePagesCachePolicy({ routing, fetchImpl: redirected.fetchImpl }), /received HTTP 301/u);
});

test('Motionscaper Pages admits only an explicitly declared non-answering first deployment', async () => {
	let probes = 0;
	const silent: typeof fetch = async () => { probes++; throw new TypeError('fetch failed'); };
	assert.deepEqual(await verifyLivePagesCachePolicy({ routing, fetchImpl: silent, coldStart: true }), {
		verifiedRouteCount: 0, assetPath: null, coldStart: true,
	});
	assert.equal(probes, 1);
	await assert.rejects(() => verifyLivePagesCachePolicy({ routing, fetchImpl: silent }),
		/found no deployment answering https:\/\/motionscaper\.org.*SCAPE_PAGES_COLD_START=1.*it is down/su);
	for (const status of [200, 404, 500, 522]) {
		const answering: typeof fetch = async () => new Response(null, { status });
		await assert.rejects(() => verifyLivePagesCachePolicy({ routing, fetchImpl: answering, coldStart: true }),
			/SCAPE_PAGES_COLD_START is set but https:\/\/motionscaper\.org is already answering/u);
	}
});
