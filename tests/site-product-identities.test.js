/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	PRODUCT_IDENTITIES,
	normalizeProductId,
	otherProductId,
	productIdentity,
	productLocalePath,
} from '../src/common/product-identities.js';
import { PRODUCT_PROFILES } from '../src/common/products.js';

test('site product identities preserve full-profile navigation values without importing product trees', async () => {
	for (const productId of ['soundscaper', 'framescaper']) {
		const identity = productIdentity(productId);
		const profile = PRODUCT_PROFILES[productId];
		assert.deepEqual(identity, {
			id: profile.id,
			name: profile.name,
			basePath: profile.basePath,
			defaultWorkspace: profile.defaultWorkspace,
		});
		assert.equal(identity, PRODUCT_IDENTITIES[productId]);
	}
	assert.equal(productLocalePath('soundscaper', 'en'), '/en/');
	assert.equal(productLocalePath('framescaper', 'de', { embedded: true }), '/framescaper/embed/de/');
	assert.equal(otherProductId('soundscaper'), 'framescaper');

	const sidebar = await readFile(new URL('../src/common/site/BrandSidebar.jsx', import.meta.url), 'utf8');
	assert.match(sidebar, /from ['"]\.\.\/product-identities\.js['"]/u);
	assert.doesNotMatch(sidebar, /from ['"]\.\.\/products\.js['"]/u);
});

test('an empty product or locale falls back rather than producing an empty segment', () => {
	assert.equal(normalizeProductId(''), 'soundscaper');
	assert.equal(normalizeProductId(null), 'soundscaper');
	assert.equal(productIdentity('').id, 'soundscaper');
	assert.equal(productLocalePath('soundscaper', ''), '/en/');
	assert.equal(productLocalePath('framescaper', null, { embedded: true }), '/framescaper/embed/en/');
	assert.equal(otherProductId('framescaper'), 'soundscaper');
});

