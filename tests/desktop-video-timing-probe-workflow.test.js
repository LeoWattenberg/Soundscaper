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

test('the timing-probe runner leaves teardown margin beyond the application deadline', async () => {
	const source = await readFile(resolve(ROOT, 'scripts/desktop-video-timing-probe-smoke.mjs'), 'utf8');
	assert.match(source, /DESKTOP_VIDEO_TIMING_PROBE_TIMEOUT_MS/u);
	assert.match(source, /DESKTOP_VIDEO_TIMING_PROBE_TIMEOUT_MS \+ 10_000/u);
	assert.match(source, /SOUNDSCAPER_VIDEO_TIMING_PROBE_RESULT/u);
	assert.match(source, /formatDesktopVideoTimingProbeEvidence/u);
	assert.equal(source.includes('}, 100_000);'), false);
});

test('desktop CI runs the packaged timing probe for both products on every maintained target', async () => {
	const workflow = await readFile(resolve(ROOT, '.github/workflows/desktop-preview.yml'), 'utf8');
	const packageJobStart = workflow.indexOf('\n  package:');
	const nextJobStart = workflow.indexOf('\n  package-with-tests:', packageJobStart);
	const packageJob = workflow.slice(packageJobStart, nextJobStart);
	const hardenedIndex = packageJob.indexOf('- name: Smoke the hardened packaged application');
	const timingIndex = packageJob.indexOf('- name: Probe packaged CFR and VFR timing persistence');
	const uploadTimingIndex = packageJob.indexOf('- name: Upload bounded timing-probe evidence');
	const directWavIndex = packageJob.indexOf('- name: Smoke packaged direct WAV, AIFF, BWF, and BW64 exports');
	const retainIndex = packageJob.indexOf('- name: Retain the verified runtime manifest');
	assert.ok(timingIndex > hardenedIndex);
	assert.ok(uploadTimingIndex > timingIndex);
	assert.ok(directWavIndex > uploadTimingIndex);
	assert.ok(retainIndex > timingIndex);
	const step = packageJob.slice(timingIndex, uploadTimingIndex);
	assert.doesNotMatch(step, /\n\s+if:/u);
	assert.doesNotMatch(step, /matrix\.product ==/u);
	assert.match(step, /run: npm run desktop:smoke:timing-probe/u);
	assert.match(step, /SOUNDSCAPER_SMOKE_ARCH: \$\{\{ matrix\.target\.arch \}\}/u);
	assert.match(step, /SOUNDSCAPER_SMOKE_XVFB: \$\{\{ runner\.os == 'Linux' && 'true' \|\| 'false' \}\}/u);
	assert.match(step, /SOUNDSCAPER_VIDEO_TIMING_PROBE_RESULT: \$\{\{ runner\.temp \}\}\/desktop-video-timing-probe-\$\{\{ matrix\.product \}\}-\$\{\{ matrix\.target\.platform \}\}-\$\{\{ matrix\.target\.arch \}\}\.json/u);
	const uploadStep = packageJob.slice(uploadTimingIndex, directWavIndex);
	assert.doesNotMatch(uploadStep, /\n\s+if:/u);
	assert.match(uploadStep, /actions\/upload-artifact@[a-f\d]+/u);
	assert.match(uploadStep, /name: desktop-video-timing-probe-\$\{\{ matrix\.product \}\}-\$\{\{ matrix\.target\.platform \}\}-\$\{\{ matrix\.target\.arch \}\}/u);
	assert.match(uploadStep, /if-no-files-found: error/u);
	assert.match(uploadStep, /retention-days: 14/u);
	assert.equal(workflow.match(/npm run desktop:smoke:timing-probe/gu)?.length, 1);
	for (const { runner, platform, arch } of [
		{ runner: 'windows-2025', platform: 'win', arch: 'x64' },
		{ runner: 'windows-11-arm', platform: 'win', arch: 'arm64' },
		{ runner: 'macos-15', platform: 'mac', arch: 'arm64' },
		{ runner: 'ubuntu-22.04', platform: 'linux', arch: 'x64' },
		{ runner: 'ubuntu-24.04-arm', platform: 'linux', arch: 'arm64' },
	]) assert.match(packageJob, new RegExp(`runner: ${runner}\\n\\s+platform: ${platform}\\n\\s+arch: ${arch}`, 'u'));
});
