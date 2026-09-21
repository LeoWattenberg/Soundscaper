/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { after } from 'node:test';

import { executeDesktopRendererSmoke } from '../desktop/renderer-smoke-execution.js';
import { assembleE2ECoverageCapture } from '../scripts/lib/e2e-coverage-assembler.mjs';
import { attestPinnedVendorDataUrl } from '../scripts/lib/e2e-coverage-profile-assembly.mjs';
import {
	cleanupE2ECoverageAssemblerFixtures,
	makeFixture,
	readJson,
	writeJson,
} from './helpers/e2e-coverage-assembler-fixture.mjs';

after(cleanupE2ECoverageAssemblerFixtures);

test('dynamic vendor coverage is excluded only after decoding the exact pinned FFmpeg JavaScript', () => {
	const manifest = readJson(join(process.cwd(), 'config/ffmpeg-runtime-manifest.json'));
	const descriptor = manifest.runtime.files.find(({ name }) => name === 'ffmpeg-core.js');
	const bytes = readFileSync(join(process.cwd(), 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js'));
	assert.equal(bytes.byteLength, descriptor.byteLength);
	assert.equal(createHash('sha256').update(bytes).digest('hex'), descriptor.sha256);
	const url = `data:text/javascript;base64,${bytes.toString('base64')}`;
	assert.equal(attestPinnedVendorDataUrl(url, descriptor), true);
	const changed = Buffer.from(bytes);
	changed[changed.length - 1] ^= 1;
	assert.throws(() => attestPinnedVendorDataUrl(
		`data:text/javascript;base64,${changed.toString('base64')}`,
		descriptor,
	), /does not match the pinned FFmpeg JavaScript/u);
	assert.throws(() => attestPinnedVendorDataUrl(
		`data:text/javascript,${encodeURIComponent(String(bytes.subarray(0, 32)))}`,
		descriptor,
	), /unapproved dynamic data/u);
	assert.equal(attestPinnedVendorDataUrl('file:///app/main.js', descriptor), false);
});

test('packaged profiles exclude only exact captured closed renderer recipes', () => {
	const admitted = makeFixture();
	addRendererRecipe(admitted, false);
	assert.doesNotThrow(() => assembleE2ECoverageCapture(admitted));

	const injected = makeFixture();
	addRendererRecipe(injected, true);
	assert.throws(() => assembleE2ECoverageCapture(injected),
		/dynamic source digest|canonical recipe/u);
});

function addRendererRecipe(fixture, injectCode) {
	const profilePath = join(fixture.runRoot, 'coverage/v8-packaged/packaged-soundscaper.json');
	const profile = readJson(profilePath);
	let source = '';
	void executeDesktopRendererSmoke({
		executeJavaScript(value) {
			source = value;
			return { status: 'fulfilled', value: null };
		},
	}, { productId: 'soundscaper', operation: 'artifact-chrome' });
	const url = source.slice(source.lastIndexOf('sourceURL=') + 'sourceURL='.length);
	profile.result.push({ functions: [], url });
	profile['script-source-cache'][url] = injectCode
		? source.replace('\n//# sourceURL=', '\nvoid 0;\n//# sourceURL=') : source;
	writeJson(profilePath, profile);
}
