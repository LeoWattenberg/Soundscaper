/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_PRODUCT_MODULE_FILTER,
} from './browser/audio-editor-framescaper-v20-product-bundle.js';

test('the V20 product injection matches esbuild module paths on every nightly host', () => {
	assert.equal(
		FRAMESCAPER_PRODUCT_MODULE_FILTER.test('/opt/soundscaper/src/framescaper/product.js'),
		true,
	);
	assert.equal(
		FRAMESCAPER_PRODUCT_MODULE_FILTER.test(
			String.raw`C:\Users\tester\Soundscaper\src\framescaper\product.js`,
		),
		true,
	);
	assert.equal(
		FRAMESCAPER_PRODUCT_MODULE_FILTER.test('/opt/soundscaper/src/soundscaper/product.js'),
		false,
	);
});
