/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { browserProductSiteForBuild, vitePreviewServer } from '../scripts/lib/browser-product-site-plan.mjs';

import {
	composeProductHeaders,
	documentRoute,
	matchedHeaders,
	parseHeaderRules,
	retiredProductRedirects,
	webBuildRouting,
} from '../scripts/lib/product-web-routing.mjs';

test('Lightscaper owns the root of its own origin and no retired cohost routes', () => {
	const routing = webBuildRouting({ SCAPE_PRODUCT: 'lightscaper' });
	assert.equal(routing.productId, 'lightscaper');
	assert.equal(routing.site.origin, 'https://lightscaper.org');
	assert.equal(routing.plans.length, 1);
	const [plan] = routing.plans;
	assert.equal(plan.basePath, '');
	assert.equal(plan.scope, '/');
	assert.equal(plan.startUrl, '/en/');
	assert.equal(documentRoute(plan, 'de'), '/de/');
	assert.equal(documentRoute(plan, 'fr', true), '/embed/fr/');
	assert.deepEqual(retiredProductRedirects(routing, ['en', 'de']), []);
	assert.equal(routing.workers.length, 1);
	assert.equal(routing.workers[0].scriptUrl, '/service-worker.js');
	assert.deepEqual(routing.workers[0].foreignScopes, ['/docs/']);
});

test('Lightscaper build origins validate overrides and never grant capture', () => {
	const routing = webBuildRouting({ SCAPE_PRODUCT: 'lightscaper', LIGHTSCAPER_SITE: 'http://127.0.0.1:4324' });
	assert.equal(routing.site.origin, 'http://127.0.0.1:4324');
	const shared = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
	const rules = parseHeaderRules(composeProductHeaders(shared, routing));
	for (const path of ['/', '/en/', '/embed/en/']) {
		const headers = matchedHeaders(rules, path);
		assert.deepEqual(headers.get('cross-origin-opener-policy'), ['same-origin']);
		assert.deepEqual(headers.get('permissions-policy'), [
			'microphone=(), speaker-selection=(), display-capture=(), camera=(), geolocation=()',
		]);
	}
	for (const origin of ['https://lightscaper.org/path', 'https://lightscaper.org/?x=1', 'file:///']) {
		assert.throws(() => webBuildRouting({ SCAPE_PRODUCT: 'lightscaper', LIGHTSCAPER_SITE: origin }), /LIGHTSCAPER_SITE/iu);
	}
});

test('a focused Lightscaper browser build has an isolated validated fixture site', () => {
	const site = browserProductSiteForBuild('lightscaper', { PLAYWRIGHT_PORT: '4510' });
	assert.equal(site.productId, 'lightscaper');
	assert.equal(site.origin, 'http://127.0.0.1:4512');
	assert.equal(site.outputDirectory, '.wrangler/browser-products/lightscaper');
	const server = vitePreviewServer(site);
	assert.equal(server.url, 'http://127.0.0.1:4512/en/');
	assert.match(server.command, /--outDir \.wrangler\/browser-products\/lightscaper/u);
	assert.equal(browserProductSiteForBuild('lightscaper', {
		PLAYWRIGHT_LIGHTSCAPER_PORT: '4544',
	}).origin, 'http://127.0.0.1:4544');
	assert.equal(browserProductSiteForBuild('framescaper', {}).productId, 'framescaper');
	assert.throws(() => browserProductSiteForBuild('lightscaper', {
		PLAYWRIGHT_LIGHTSCAPER_PORT: '4322',
	}), /different ports/u);
	assert.throws(() => browserProductSiteForBuild('unknownscaper', {}), /Unsupported browser build product/u);
});
