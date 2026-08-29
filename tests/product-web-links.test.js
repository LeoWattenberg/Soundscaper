/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { PRODUCT_IDS } from '../src/common/product-identities.js';
import { PRODUCT_WEB_ORIGINS, productHref, productWebOrigin } from '../src/common/product-web-links.js';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('every built product has a web origin of its own', () => {
	for (const productId of PRODUCT_IDS) {
		assert.match(productWebOrigin(productId), /^https:\/\/[a-z.]+$/u, productId);
		assert.equal(productWebOrigin(productId), PRODUCT_WEB_ORIGINS[productId]);
	}
	assert.equal(PRODUCT_WEB_ORIGINS.soundscaper, 'https://soundscaper.org');
	assert.equal(PRODUCT_WEB_ORIGINS.framescaper, 'https://framescaper.org');
});

test('a Soundscaper build stays on its origin and crosses origins for Framescaper', () => {
	const built = { builtProductId: 'soundscaper' };
	assert.equal(productHref('soundscaper', 'en', built), '/en/');
	assert.equal(productHref('soundscaper', 'de', { ...built, embedded: true }), '/embed/de/');
	assert.equal(productHref('framescaper', 'de', built), 'https://framescaper.org/de/');
	assert.equal(productHref('framescaper', 'en', { ...built, embedded: true }), 'https://framescaper.org/embed/en/');
});

test('a Framescaper build serves itself from its origin root and crosses origins for its peer', () => {
	const built = { builtProductId: 'framescaper' };
	assert.equal(productHref('framescaper', 'en', built), '/en/');
	assert.equal(productHref('framescaper', 'de', { ...built, embedded: true }), '/embed/de/');
	assert.equal(productHref('soundscaper', 'de', built), 'https://soundscaper.org/de/');
	assert.equal(productHref('soundscaper', 'en', { ...built, embedded: true }), 'https://soundscaper.org/embed/en/');
});

test('product web links fail closed on an unknown product on either side of the link', () => {
	assert.throws(() => productHref('lightscaper', 'en', { builtProductId: 'soundscaper' }), /Unsupported editor product/u);
	assert.throws(() => productHref('soundscaper', 'en', { builtProductId: 'lightscaper' }), /Unsupported editor product/u);
	assert.throws(() => productWebOrigin('lightscaper'), /Unsupported editor product/u);
});

test('the locale segment is encoded rather than interpolated raw', () => {
	assert.equal(productHref('soundscaper', 'pt-BR', { builtProductId: 'soundscaper' }), '/pt-BR/');
	assert.equal(productHref('soundscaper', 'a/b', { builtProductId: 'framescaper' }), 'https://soundscaper.org/a%2Fb/');
});

test('the sidebar links origins while the editable-copy menu uses the permanent sender route', async () => {
	const [sidebar, menu] = await Promise.all([
		source('src/common/site/BrandSidebar.jsx'),
		source('src/common/editor/ui/workspace/workspace-application-menu-runtime.js'),
	]);
	assert.match(sidebar, /productHref\(/u);
	assert.doesNotMatch(sidebar, /productLocalePath\(/u);
	assert.doesNotMatch(menu, /productHref\(|productLocalePath\(/u);
	assert.match(menu, /\/transfer\/send\/\?\$\{serializeCrossProductHandoffLaunchIntent\(intent\)\}/u);
});
