/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { BUILT_PRODUCT_ID, resolveApplicationRoute, resolveWebRoute } from '../src/common/site/route.js';

test('a bundle built without the product define serves Soundscaper', () => {
	assert.equal(BUILT_PRODUCT_ID, 'soundscaper');
});

test('the Soundscaper build keeps routing both products by path segment', () => {
	// soundscaper.org must keep serving Framescaper under /framescaper/ for the
	// whole cutover, so this build still reads the product off the path.
	assert.deepEqual(resolveWebRoute('/en/', 'soundscaper'), { productId: 'soundscaper', locale: 'en', embedded: false });
	assert.deepEqual(resolveWebRoute('/de/', 'soundscaper'), { productId: 'soundscaper', locale: 'de', embedded: false });
	assert.deepEqual(resolveWebRoute('/embed/de/', 'soundscaper'), { productId: 'soundscaper', locale: 'de', embedded: true });
	assert.deepEqual(resolveWebRoute('/framescaper/en/', 'soundscaper'), { productId: 'framescaper', locale: 'en', embedded: false });
	assert.deepEqual(resolveWebRoute('/framescaper/embed/de/', 'soundscaper'), { productId: 'framescaper', locale: 'de', embedded: true });
	assert.deepEqual(resolveWebRoute('/', 'soundscaper'), { productId: 'soundscaper', locale: 'en', embedded: false });
});

test('a Framescaper build serves Framescaper from the origin root', () => {
	// On framescaper.org the first segment is the locale: there is no product
	// segment to read, so the built product is the only authority.
	assert.deepEqual(resolveWebRoute('/en/', 'framescaper'), { productId: 'framescaper', locale: 'en', embedded: false });
	assert.deepEqual(resolveWebRoute('/de/', 'framescaper'), { productId: 'framescaper', locale: 'de', embedded: false });
	assert.deepEqual(resolveWebRoute('/embed/de/', 'framescaper'), { productId: 'framescaper', locale: 'de', embedded: true });
	assert.deepEqual(resolveWebRoute('/', 'framescaper'), { productId: 'framescaper', locale: 'en', embedded: false });
});

test('a Framescaper build never resolves the other product from a path segment', () => {
	const route = resolveWebRoute('/soundscaper/en/', 'framescaper');
	assert.equal(route.productId, 'framescaper');
});

test('the built product decides the desktop route', async () => {
	const route = await resolveApplicationRoute({
		scapeDesktop: { v1: { getEnvironment: async () => ({ locale: 'de' }) } },
	});
	assert.deepEqual(route, {
		productId: 'soundscaper',
		locale: 'de',
		direction: 'ltr',
		embedded: true,
		desktop: true,
	});
});

test('the web route resolves through the built product', async () => {
	const route = await resolveApplicationRoute({ location: { pathname: '/framescaper/embed/de/' } });
	assert.deepEqual(route, {
		productId: 'framescaper',
		locale: 'de',
		direction: 'ltr',
		embedded: true,
		desktop: false,
	});
});

test('the root path still redirects to the default locale', async () => {
	const replaced = [];
	await resolveApplicationRoute({ location: { pathname: '/', replace: (target) => replaced.push(target) } });
	assert.deepEqual(replaced, ['/en/']);
});

test('a Framescaper bundle resolves its own product without a path segment', async () => {
	globalThis.__SCAPE_PRODUCT__ = 'framescaper';
	try {
		const module = await import('../src/common/site/route.js?built=framescaper');
		assert.equal(module.BUILT_PRODUCT_ID, 'framescaper');
		const route = await module.resolveApplicationRoute({ location: { pathname: '/de/' } });
		assert.equal(route.productId, 'framescaper');
		assert.equal(route.locale, 'de');
		assert.equal(route.embedded, false);
	} finally {
		delete globalThis.__SCAPE_PRODUCT__;
	}
});
