/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('packaged Web VCR smoke has an explicit script and no insecure Chromium switches', async () => {
	const manifest = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
	assert.equal(
		manifest.scripts['desktop:smoke:framescaper-web-vcr'],
		'node scripts/framescaper-web-vcr-smoke.mjs',
	);
	const runner = await readFile(resolve(ROOT, 'scripts/framescaper-web-vcr-smoke.mjs'), 'utf8');
	assert.match(runner, /createFramescaperWebVcrHttpsFixture/u);
	assert.match(runner, /--user-data-dir=\$\{profile\}/u);
	assert.match(runner, /persistentGuestProfileMaterialized: false/u);
	assert.match(runner, /qualification: false/u);
	assert.doesNotMatch(runner, /ignore-certificate-errors|disable-web-security|allow-insecure-localhost/iu);
});

test('desktop assembly inventories the Web VCR runtime and separate sandbox preload', async () => {
	const assembly = await readFile(resolve(ROOT, 'scripts/lib/desktop-project-library-runtime.mjs'), 'utf8');
	for (const member of [
		'framescaper-web-vcr-capture-authority.js',
		'framescaper-web-vcr-registration.js',
		'framescaper-web-vcr-runtime-capture-state.js',
		'framescaper-web-vcr-runtime.js',
		'framescaper-web-vcr-target-observer.js',
		'framescaper-web-vcr-target-tracker.js',
		'web-vcr-domain.js',
		'web-vcr-geometry.js',
	]) assert.match(assembly, new RegExp(member.replaceAll('.', '\\.'), 'u'));
	assert.match(assembly, /FRAMESCAPER_WEB_VCR_PRELOAD_BUNDLE/u);
	assert.match(assembly, /framescaper-web-vcr-sandbox-preload\.ts/u);

	const main = await readFile(resolve(ROOT, 'desktop/main.mjs'), 'utf8');
	assert.match(main, /framescaperWebVcrSmokeQualification\(process\.argv/u);
	assert.doesNotMatch(main, /ignore-certificate-errors|disable-web-security|allow-insecure-localhost/iu);
});
