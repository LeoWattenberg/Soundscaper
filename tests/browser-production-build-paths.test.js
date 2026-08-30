/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	resolveSoundscaperProductionAssetsDirectory,
} from './browser/helpers/production-build-paths.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('production assets resolve against the local build outside the nightly payload', () => {
	assert.equal(resolveSoundscaperProductionAssetsDirectory({}), join(ROOT, 'dist/assets'));
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
