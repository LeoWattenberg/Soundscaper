/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { PROJECT_FEATURE_CAPABILITY_IDS, snapshotProjectFeatureCapabilities } from '../src/common/editor/project-feature-capabilities.ts';
import { PRODUCT_IDS, otherProductId, otherProductIds, productIdentity } from '../src/common/product-identities.js';
import { productProfile } from '../src/common/products.js';
import { productHref, productWebOrigin } from '../src/common/product-web-links.js';

test('Lightscaper is a distinct, immutable product with its menu-backed photo catalog enabled', () => {
	assert.deepEqual(PRODUCT_IDS, ['soundscaper', 'framescaper', 'lightscaper']);
	const identity = productIdentity('lightscaper');
	assert.equal(identity.name, 'Lightscaper');
	assert.equal(identity.defaultWorkspace, 'photo-library');
	const profile = productProfile('lightscaper');
	assert.equal(profile.projectFileExtension, '.liscape');
	assert.equal(Object.isFrozen(profile), true);
	assert.equal(Object.isFrozen(profile.capabilities), true);
	assert.deepEqual(profile.importChoices, ['photos']);
	assert.deepEqual(profile.exportChoices, []);
	assert.deepEqual(snapshotProjectFeatureCapabilities(profile.capabilities).availableFeatureIds, [PROJECT_FEATURE_CAPABILITY_IDS.photoLibrarySurface, PROJECT_FEATURE_CAPABILITY_IDS.photoCatalog]);
	assert.deepEqual(Object.entries(profile.capabilities).filter(([, enabled]) => enabled), [
		['photoLibrarySurface', true],
		['photoCatalog', true],
	]);
	for (const productId of PRODUCT_IDS) {
		const product = productProfile(productId);
		assert.deepEqual(Object.keys(product.capabilities).sort(), Object.keys(PROJECT_FEATURE_CAPABILITY_IDS).sort());
		for (const key of ['photoLibrarySurface', 'photoCatalog', 'photoDevelop', 'photoExport', 'photoRaw']) {
			assert.equal(typeof Reflect.get(product.capabilities, key), 'boolean');
		}
	}
});

test('product navigation enumerates every peer without a binary fallback', () => {
	for (const source of PRODUCT_IDS) {
		const peers = otherProductIds(source);
		assert.deepEqual(peers, PRODUCT_IDS.filter((product) => product !== source));
		assert.equal(Object.isFrozen(peers), true);
		for (const target of peers) {
			assert.equal(productHref(target, 'de', { builtProductId: source }), `${productWebOrigin(target)}/de/`);
		}
		assert.equal(productHref(source, 'de', { builtProductId: source }), '/de/');
	}
	assert.throws(() => otherProductIds('unknown'), /Unsupported editor product/u);
	assert.throws(() => otherProductId('lightscaper'), /No editable-copy destination/u);
	assert.equal(productWebOrigin('lightscaper'), 'https://lightscaper.org');
});
