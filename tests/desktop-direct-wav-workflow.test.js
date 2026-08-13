/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('desktop package metadata exposes the packaged direct WAV, AIFF, BWF, and BW64 smoke', async () => {
	const metadata = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));

	assert.equal(
		metadata.scripts['desktop:smoke:direct-wav'],
		'node scripts/desktop-direct-wav-smoke.mjs',
	);
});

test('desktop CI runs the direct WAV, AIFF, BWF, and BW64 smoke only for packaged Soundscaper Linux x64', async () => {
	const workflow = await readFile(resolve(ROOT, '.github/workflows/desktop-preview.yml'), 'utf8');
	const packageJobStart = workflow.indexOf('\n  package:');
	const nextJobStart = workflow.indexOf('\n  package-with-tests:', packageJobStart);
	assert.ok(packageJobStart >= 0, 'missing desktop package matrix job');
	assert.ok(nextJobStart > packageJobStart, 'could not isolate desktop package matrix job');

	const packageJob = workflow.slice(packageJobStart, nextJobStart);
	const hardenedSmokeIndex = packageJob.indexOf('- name: Smoke the hardened packaged application');
	const directWavSmokeIndex = packageJob.indexOf('- name: Smoke packaged direct WAV, AIFF, BWF, and BW64 exports');
	const scapeOpenSmokeIndex = packageJob.indexOf('- name: Smoke packaged Soundscaper project open');
	const retainManifestIndex = packageJob.indexOf('- name: Retain the verified runtime manifest');
	assert.ok(hardenedSmokeIndex >= 0, 'missing hardened packaged-application smoke');
	assert.ok(directWavSmokeIndex > hardenedSmokeIndex, 'direct-WAV smoke must follow the hardened package smoke');
	assert.ok(scapeOpenSmokeIndex > directWavSmokeIndex, 'project-open smoke must follow the direct-WAV smoke');
	assert.ok(retainManifestIndex > directWavSmokeIndex, 'direct-WAV smoke must run before packaging evidence is retained');

	const directWavStep = packageJob.slice(directWavSmokeIndex, scapeOpenSmokeIndex);
	assert.match(
		directWavStep,
		/^- name: Smoke packaged direct WAV, AIFF, BWF, and BW64 exports\s+if: matrix\.product == 'soundscaper' && matrix\.target\.platform == 'linux' && matrix\.target\.arch == 'x64'\s+run: npm run desktop:smoke:direct-wav\s+env:\s+SOUNDSCAPER_SMOKE_ARCH: x64\s+SOUNDSCAPER_SMOKE_XVFB: 'true'\s*$/u,
	);
	assert.equal(
		workflow.match(/npm run desktop:smoke:direct-wav/gu)?.length,
		1,
		'direct-WAV smoke must not run from another job or an unscoped step',
	);
});
