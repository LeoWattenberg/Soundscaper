/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	pagesCachePolicyDescriptors,
	verifyLivePagesCachePolicy,
	verifyPublishedPagesCachePolicy,
} from '../scripts/lib/pages-deploy-preflight.mjs';
import { webBuildRouting } from '../scripts/lib/product-web-routing.mjs';
import { livePagesDeployment as liveDeployment } from './helpers/pages-live-deployment-fixture.mjs';
import { IMMUTABLE, ZONE_BROWSER_TTL } from './helpers/pages-cache-policy-values.mjs';

/**
 * Auditing a deployment that is already live.
 *
 * A deploy is not finished when the upload succeeds: the deployment has to reach its own
 * domain, and until it does the audit is reading whatever the previous one left in the
 * CDN. So propagation is waited for and then given a deadline, the immutable-asset rule is
 * checked against an asset the live deployment actually has, and a retired product path is
 * proved to redirect its documents while its old worker returns 404.
 *
 * `tests/pages-deploy-preflight.test.js` covers what is checked before publishing.
 */

test('the post-deploy audit waits for a just-published deployment to reach its domain', async () => {
	const routing = webBuildRouting({ SCAPE_PRODUCT: 'soundscaper' });
	const assetPath = '/assets/site-entry-AbCd1234.js';
	const live = liveDeployment({ routing, assetPath });
	const retired = [...live.redirects.keys()][0];
	// Until the upload reaches the custom domain the origin still answers with
	// the previous deployment, which served the retired route as a document.
	let staleReads = 2;
	const fetchImpl = async (url, init) => {
		if (decodeURIComponent(new URL(url).pathname) === retired && staleReads > 0) {
			staleReads -= 1;
			return new Response('previous deployment', {
				status: 200,
				headers: { 'cache-control': 'no-cache' },
			});
		}
		return live.fetchImpl(url, init);
	};
	const waits = [];
	let clock = 0;
	const schedule = {
		now: () => clock,
		sleep: async (delayMs) => { waits.push(delayMs); clock += delayMs; },
		timeoutMs: 30_000,
		intervalMs: 1_000,
	};

	const result = await verifyPublishedPagesCachePolicy(
		{ routing, origin: routing.site.origin, fetchImpl, includeRetired: true },
		schedule,
	);

	assert.equal(result.verifiedRouteCount, live.descriptors.length);
	assert.deepEqual(waits, [1_000, 1_000]);
	assert.equal(staleReads, 0);
});

test('the post-deploy audit still fails once propagation has had its deadline', async () => {
	const routing = webBuildRouting({ SCAPE_PRODUCT: 'soundscaper' });
	const live = liveDeployment({ routing, assetPath: '/assets/site-entry-AbCd1234.js' });
	const retired = [...live.redirects.keys()][0];
	const fetchImpl = async (url, init) => (
		decodeURIComponent(new URL(url).pathname) === retired
			? new Response('previous deployment', { status: 200, headers: { 'cache-control': 'no-cache' } })
			: live.fetchImpl(url, init)
	);
	const waits = [];
	let clock = 0;

	await assert.rejects(
		() => verifyPublishedPagesCachePolicy(
			{ routing, origin: routing.site.origin, fetchImpl, includeRetired: true },
			{
				now: () => clock,
				sleep: async (delayMs) => { waits.push(delayMs); clock += delayMs; },
				timeoutMs: 10_000,
				intervalMs: 1_000,
			},
		),
		/requires a permanent redirect/u,
	);
	assert.equal(waits.length, 10);
});

test('the immutable-asset rule is audited against an asset the live deployment actually has', async () => {
	// The live origin is by construction the PREVIOUS deployment, so it cannot
	// carry the content hash the build being deployed just produced. Demanding
	// that hash makes the gate fail exactly when the build changed something,
	// which is nearly every push. What the rule is for is that the `/assets/*`
	// immutable Cache-Control is in force on the live origin — and a header can
	// only be observed on an object that exists, so the audit takes its sample
	// from the live deployment's own published inventory.
	const routing = webBuildRouting({ SCAPE_PRODUCT: 'framescaper' });
	const livePath = '/assets/site-entry-Old00000.js';
	const justBuilt = '/assets/site-entry-New11111.js';
	const live = liveDeployment({ routing, assetPath: livePath });

	const result = await verifyLivePagesCachePolicy({ routing, fetchImpl: live.fetchImpl });
	assert.equal(result.assetPath, livePath);
	assert.equal(live.served.get(livePath).cacheControl, IMMUTABLE);
	assert.equal(
		live.paths().includes(justBuilt),
		false,
		'the gate must never ask the live origin for a content hash only the new build has',
	);

	live.served.get(livePath).cacheControl = 'no-cache';
	await assert.rejects(
		() => verifyLivePagesCachePolicy({ routing, fetchImpl: live.fetchImpl }),
		new RegExp(`Cache-Control is invalid for ${livePath}`, 'u'),
	);
	live.served.get(livePath).cacheControl = IMMUTABLE;

	live.bodies.set('/offline-shell.json', JSON.stringify({ assets: [{ url: '/en/' }] }));
	await assert.rejects(
		() => verifyLivePagesCachePolicy({ routing, fetchImpl: live.fetchImpl }),
		/names no content-hashed \/assets\/ bundle/u,
	);
	live.bodies.set('/offline-shell.json', 'not json at all');
	await assert.rejects(
		() => verifyLivePagesCachePolicy({ routing, fetchImpl: live.fetchImpl }),
		/offline-shell\.json on https:\/\/framescaper\.org is not JSON/u,
	);
});

test('a Framescaper deployment audits its own origin and its own root routes', async () => {
	const routing = webBuildRouting({ SCAPE_PRODUCT: 'framescaper' });
	const assetPath = '/assets/site-entry-AbCd1234.js';
	const descriptors = pagesCachePolicyDescriptors({ routing, assetPath });
	assert.deepEqual(descriptors.map(({ path }) => path).sort(), [
		'/',
		'/assets/site-entry-AbCd1234.js',
		'/embed/en/',
		'/en/',
		'/logo/framescaper-icon.svg',
		'/manifest-framescaper.webmanifest',
		'/offline-icons/framescaper-180.png',
		'/offline-shell.json',
		'/service-worker.js',
	]);
	assert.equal(descriptors.every(({ expectation }) => expectation === 'served'), true);
	assert.deepEqual(
		descriptors.find(({ path }) => path === '/service-worker.js'),
		{ path: '/service-worker.js', expectation: 'served', cacheControl: 'no-store', serviceWorkerAllowed: '/' },
	);

	const live = liveDeployment({ routing, assetPath });
	const requests = [];
	const fetchImpl = async (url, init) => {
		requests.push(new URL(url).href);
		return await live.fetchImpl(url, init);
	};
	assert.deepEqual(await verifyLivePagesCachePolicy({ routing, fetchImpl }), {
		verifiedRouteCount: descriptors.length,
		assetPath,
		coldStart: false,
	});
	assert.equal(requests.every((href) => href.startsWith('https://framescaper.org/')), true, requests.join(' '));
});

test('a retired product path redirects its documents and returns 404 for its old worker', async () => {
	const routing = webBuildRouting({ SCAPE_PRODUCT: 'soundscaper' });
	const assetPath = '/assets/site-entry-AbCd1234.js';
	const descriptors = pagesCachePolicyDescriptors({ routing, assetPath });
	assert.deepEqual(descriptors.filter(({ path }) => path.startsWith('/framescaper/')), [
		{ path: '/framescaper/en/', expectation: 'redirected', location: 'https://framescaper.org/en/' },
		{ path: '/framescaper/embed/en/', expectation: 'redirected', location: 'https://framescaper.org/embed/en/' },
		{ path: '/framescaper/service-worker.js', expectation: 'missing' },
	]);

	const redirects = new Map(descriptors
		.filter(({ expectation }) => expectation === 'redirected')
		.map(({ path, location }) => [path, location]));
	const live = liveDeployment({ routing, assetPath, redirects, zoneBrowserTtl: ZONE_BROWSER_TTL });
	assert.deepEqual(await verifyLivePagesCachePolicy({ routing, fetchImpl: live.fetchImpl }), {
		verifiedRouteCount: descriptors.length,
		assetPath,
		coldStart: false,
	});

	redirects.set('/framescaper/service-worker.js', 'https://framescaper.org/service-worker.js');
	await assert.rejects(
		() => verifyLivePagesCachePolicy({ routing, fetchImpl: live.fetchImpl }),
		/requires HTTP 404 for \/framescaper\/service-worker\.js.*301/u,
	);
	redirects.delete('/framescaper/service-worker.js');
	live.served.set('/framescaper/service-worker.js', { path: '/framescaper/service-worker.js', cacheControl: 'no-store' });
	await assert.rejects(
		() => verifyLivePagesCachePolicy({ routing, fetchImpl: live.fetchImpl }),
		/requires HTTP 404 for \/framescaper\/service-worker\.js.*200/u,
	);
	live.served.delete('/framescaper/service-worker.js');

	redirects.set('/framescaper/en/', 'https://soundscaper.org/en/');
	await assert.rejects(
		() => verifyLivePagesCachePolicy({ routing, fetchImpl: live.fetchImpl }),
		/redirect target is invalid for \/framescaper\/en\//u,
	);
	redirects.delete('/framescaper/en/');
	live.served.set('/framescaper/en/', { path: '/framescaper/en/', cacheControl: 'no-cache' });
	await assert.rejects(
		() => verifyLivePagesCachePolicy({ routing, fetchImpl: live.fetchImpl }),
		/requires a permanent redirect for \/framescaper\/en\/.*200/u,
	);
});

test('the retired-route audit refuses a product without an explicit route table', () => {
	const routing = webBuildRouting({ SCAPE_PRODUCT: 'soundscaper' });
	assert.throws(
		() => pagesCachePolicyDescriptors({
			routing: { ...routing, productId: 'future-product' },
			assetPath: '/assets/site-entry-AbCd1234.js',
		}),
		/has no retired-route table for future-product/u,
	);
});
