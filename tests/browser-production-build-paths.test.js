/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	resolveSoundscaperBrowserAssetsDirectory,
	resolveSoundscaperProductionAssetsDirectory,
} from './browser/helpers/production-build-paths.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('production assets resolve against the local build outside the nightly payload', () => {
	assert.equal(resolveSoundscaperProductionAssetsDirectory({}), join(ROOT, 'dist/assets'));
});

test('browser assets resolve against the ordinary product fixture outside the nightly payload', () => {
	assert.equal(
		resolveSoundscaperBrowserAssetsDirectory({}),
		join(ROOT, '.wrangler/browser-products/soundscaper/assets'),
	);
});

test('browser assets use the verified nightly site instead of a checkout-only fixture', () => {
	const payloadRoot = join(ROOT, 'staged nightly payload');
	assert.equal(
		resolveSoundscaperBrowserAssetsDirectory({
			SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT: payloadRoot,
		}),
		join(payloadRoot, 'sites/soundscaper/assets'),
	);
	assert.throws(
		() => resolveSoundscaperBrowserAssetsDirectory({
			SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT: 'relative/nightly-tests',
		}),
		/SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT must be an absolute path/u,
	);
});

test('production assets resolve against the verified Soundscaper nightly site', () => {
	assert.equal(
		resolveSoundscaperProductionAssetsDirectory({
			SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT: '/opt/Soundscaper Tests/resources/nightly-tests',
		}),
		'/opt/Soundscaper Tests/resources/nightly-tests/sites/soundscaper/assets',
	);
	assert.throws(
		() => resolveSoundscaperProductionAssetsDirectory({
			SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT: 'relative/nightly-tests',
		}),
		/SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT must be an absolute path/u,
	);
});
