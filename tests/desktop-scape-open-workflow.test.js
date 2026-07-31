/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('desktop package metadata exposes the packaged Soundscaper project-open smoke', async () => {
	const metadata = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));

	assert.equal(
		metadata.scripts['desktop:smoke:scape-open'],
		'node --import tsx scripts/desktop-scape-open-smoke.mjs',
	);
});

test('desktop CI runs the project-open smoke only for packaged Soundscaper Linux x64', async () => {
	const workflow = await readFile(resolve(ROOT, '.github/workflows/desktop-preview.yml'), 'utf8');
	const packageJobStart = workflow.indexOf('\n  package:');
	const nextJobStart = workflow.indexOf('\n  project-library-handoff:', packageJobStart);
	assert.ok(packageJobStart >= 0, 'missing desktop package matrix job');
	assert.ok(nextJobStart > packageJobStart, 'could not isolate desktop package matrix job');

	const packageJob = workflow.slice(packageJobStart, nextJobStart);
	const hardenedSmokeIndex = packageJob.indexOf('- name: Smoke the hardened packaged application');
	const scapeOpenSmokeIndex = packageJob.indexOf('- name: Smoke packaged Soundscaper project open');
	const retainManifestIndex = packageJob.indexOf('- name: Retain the verified runtime manifest');
	assert.ok(hardenedSmokeIndex >= 0, 'missing hardened packaged-application smoke');
	assert.ok(scapeOpenSmokeIndex > hardenedSmokeIndex, 'project-open smoke must follow the hardened package smoke');
	assert.ok(retainManifestIndex > scapeOpenSmokeIndex, 'project-open smoke must run before packaging evidence is retained');

	const scapeOpenStep = packageJob.slice(scapeOpenSmokeIndex, retainManifestIndex);
	assert.match(
		scapeOpenStep,
		/^- name: Smoke packaged Soundscaper project open\s+if: matrix\.product == 'soundscaper' && matrix\.target\.platform == 'linux' && matrix\.target\.arch == 'x64'\s+run: npm run desktop:smoke:scape-open\s+env:\s+SOUNDSCAPER_SMOKE_ARCH: x64\s+SOUNDSCAPER_SMOKE_XVFB: 'true'\s*$/u,
	);
	assert.equal(
		workflow.match(/npm run desktop:smoke:scape-open/gu)?.length,
		1,
		'project-open smoke must not run from another job or an unscoped step',
	);
});
