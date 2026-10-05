/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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

test('isolated browser fixtures read their own manifest chunks without changing production or nightly roots', async (context) => {
	const isolatedRoot = await mkdtemp(join(tmpdir(), 'soundscaper-isolated-fixtures-'));
	context.after(() => rm(isolatedRoot, { recursive: true, force: true }));
	const assets = join(isolatedRoot, 'soundscaper/assets');
	await mkdir(assets, { recursive: true });
	await writeFile(join(assets, 'WorkspacePreferencesDialog-isolated.js'), 'export const fixture = true;');
	const environment = { SCAPE_BROWSER_PRODUCT_FIXTURE_ROOT: isolatedRoot };
	assert.deepEqual(await readdir(resolveSoundscaperBrowserAssetsDirectory(environment)), ['WorkspacePreferencesDialog-isolated.js']);
	assert.equal(resolveSoundscaperProductionAssetsDirectory(environment), join(ROOT, 'dist/assets'));
	const payloadRoot = join(ROOT, 'staged nightly payload');
	assert.equal(resolveSoundscaperBrowserAssetsDirectory({ ...environment, SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT: payloadRoot }),
		join(payloadRoot, 'sites/soundscaper/assets'));
});

test('isolated browser fixture roots require an explicit absolute directory', () => {
	for (const root of ['relative/browser-fixtures', '', 4500]) {
		assert.throws(() => resolveSoundscaperBrowserAssetsDirectory({ SCAPE_BROWSER_PRODUCT_FIXTURE_ROOT: root }),
			/SCAPE_BROWSER_PRODUCT_FIXTURE_ROOT must be an absolute path/u);
	}
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
