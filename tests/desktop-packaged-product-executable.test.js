/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import {
	resolvePackagedProductExecutable as resolveFromLeaf,
} from '../scripts/lib/desktop-packaged-product-executable.mjs';
import {
	resolvePackagedProductExecutable as resolveFromRuntime,
} from '../scripts/lib/desktop-nightly-tests-packaged-runtime.mjs';

test('the packaged-product executable resolver is a stable dependency-free leaf', () => {
	assert.equal(resolveFromRuntime, resolveFromLeaf, 'the historical runtime export stays compatible');
	const root = '/opt/Soundscaper Tests/resources/nightly-tests/products';
	assert.equal(resolveFromLeaf({
		productRoot: root, productId: 'soundscaper', platform: 'win32', arch: 'x64',
	}), join(root, 'soundscaper', 'win-unpacked', 'Soundscaper.exe'));
	assert.equal(resolveFromLeaf({
		productRoot: root, productId: 'framescaper', platform: 'darwin', arch: 'arm64',
	}), join(root, 'framescaper', 'mac-arm64', 'Framescaper.app', 'Contents', 'MacOS', 'Framescaper'));
	assert.equal(resolveFromLeaf({
		productRoot: root, productId: 'framescaper', platform: 'linux', arch: 'arm64',
	}), join(root, 'framescaper', 'linux-arm64-unpacked', 'framescaper'));
});

test('the packaged-product executable leaf rejects every open-ended selector', () => {
	const valid = {
		productRoot: '/opt/products', productId: 'soundscaper', platform: 'linux', arch: 'x64',
	};
	assert.throws(() => resolveFromLeaf({ ...valid, productRoot: 'relative' }), /absolute/iu);
	assert.throws(() => resolveFromLeaf({ ...valid, productId: 'unknown' }), /product/iu);
	assert.throws(() => resolveFromLeaf({ ...valid, platform: 'freebsd' }), /platform/iu);
	assert.throws(() => resolveFromLeaf({ ...valid, arch: 'ia32' }), /architecture/iu);
});
