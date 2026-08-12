/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('desktop package metadata exposes the packaged timing probe', async () => {
	const metadata = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
	assert.equal(metadata.scripts['desktop:smoke:timing-probe'], 'node scripts/desktop-video-timing-probe-smoke.mjs');
});

test('desktop CI runs the packaged timing probe for both Linux x64 products', async () => {
	const workflow = await readFile(resolve(ROOT, '.github/workflows/desktop-preview.yml'), 'utf8');
	const packageJobStart = workflow.indexOf('\n  package:');
	const nextJobStart = workflow.indexOf('\n  package-with-tests:', packageJobStart);
	const packageJob = workflow.slice(packageJobStart, nextJobStart);
	const hardenedIndex = packageJob.indexOf('- name: Smoke the hardened packaged application');
	const timingIndex = packageJob.indexOf('- name: Probe packaged CFR and VFR timing persistence');
	const directWavIndex = packageJob.indexOf('- name: Smoke packaged direct WAV, AIFF, BWF, and BW64 exports');
	const retainIndex = packageJob.indexOf('- name: Retain the verified runtime manifest');
	assert.ok(timingIndex > hardenedIndex);
	assert.ok(directWavIndex > timingIndex);
	assert.ok(retainIndex > timingIndex);
	const step = packageJob.slice(timingIndex, directWavIndex);
	assert.match(step, /if: matrix\.target\.platform == 'linux' && matrix\.target\.arch == 'x64'/u);
	assert.doesNotMatch(step, /matrix\.product ==/u);
	assert.match(step, /run: npm run desktop:smoke:timing-probe/u);
	assert.match(step, /SOUNDSCAPER_SMOKE_ARCH: x64/u);
	assert.match(step, /SOUNDSCAPER_SMOKE_XVFB: 'true'/u);
	assert.equal(workflow.match(/npm run desktop:smoke:timing-probe/gu)?.length, 1);
});
