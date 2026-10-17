/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);

test('reusable professional-native workflow produces five verified build results', async () => {
	const source = await readFile(new URL(
		'.github/workflows/soundscaper-professional-native-build.yml', ROOT,
	), 'utf8');
	assert.match(source, /workflow_call:/u);
	for (const [target, runner, platform, arch] of [
		['linux-x64', 'ubuntu-22.04', 'linux', 'x64'],
		['linux-arm64', 'ubuntu-24.04-arm', 'linux', 'arm64'],
		['mac-arm64', 'macos-15', 'mac', 'arm64'],
		['win-x64', 'windows-2025', 'win', 'x64'],
		['win-arm64', 'windows-11-arm', 'win', 'arm64'],
	]) {
		const row = [`target: ${target}`, `runner: ${runner}`, `platform: ${platform}`, `arch: ${arch}`]
			.join('\\n\\s+');
		assert.equal([...source.matchAll(new RegExp(row, 'gu'))].length, 1);
	}
	assert.match(source, /SOUNDSCAPER_NATIVE_HARNESS_PREPARATION: 'true'/u);
	assert.match(source, /build-soundscaper-professional-native\.mjs/u);
	assert.match(source, /stage-soundscaper-professional-native-build-result\.mjs/u);
	assert.match(source, /soundscaper-professional-native-build-result-\$\{\{ matrix\.target \}\}/u);
	assert.doesNotMatch(source, /signing-identity|certificate|notari[sz]/iu);
	assert.doesNotMatch(source,
		/promot|Developer ID|SIGNING_CERTIFICATE|SIGNING_PASSWORD|SOUNDSCAPER_MAC_SIGNING_IDENTITY|import-codesign-certs/iu);
	assert.doesNotMatch(source, /secrets:/u);
	assert.doesNotMatch(source, /tooling_node_arch/u);
	assert.match(source, /architecture: \$\{\{ matrix\.node_arch \}\}/u);
	assert.match(source, /kernel\.apparmor_restrict_unprivileged_userns=0/u);
	assert.match(source, /Install authenticated CMake for the Ubuntu 22\.04 baseline\n\s+if: matrix\.target == 'linux-x64'\n\s+run: bash scripts\/ci-install-professional-cmake\.sh/u);
	assert.match(source, /Allow unprivileged user namespaces for the native isolation launcher\n\s+if: matrix\.target == 'linux-arm64'/u);
	assert.doesNotMatch(source, /uses:\s+actions\/[a-z-]+@v\d+/u);
});

test('Windows checks the GPU CMake recipes before the expensive desktop harness build', async () => {
	const source = await readFile(new URL('.github/workflows/soundscaper-professional-native-build.yml', ROOT), 'utf8');
	const start = source.indexOf('- name: Verify Windows GPU CMake recipes');
	assert.ok(start > source.indexOf('- run: npm ci'));
	const check = source.slice(start, source.indexOf('\n      - ', start + 1));
	assert.match(check, /if: runner\.os == 'Windows'/u);
	assert.match(check, /tests\/desktop-assistance-gpu-cmake\.test\.ts/u);
	assert.match(check, /tests\/desktop-assistance-sherpa-cmake\.test\.ts/u);
	assert.match(check, /tests\/desktop-assistance-vulkan-cmake\.test\.ts/u);
	assert.ok(start < source.indexOf('- name: Build a non-publishable Electron self-test harness'));
});

test('regular quality checks run the GPU CMake preflight on both Windows architectures', async () => {
	const source = await readFile(new URL('.github/workflows/quality.yml', ROOT), 'utf8');
	const job = source.slice(source.indexOf('\n  native-platform-compile:'), source.indexOf('\n  tests:'));
	const start = job.indexOf('- name: Verify Windows GPU CMake recipes');
	assert.ok(start > job.indexOf('run: npm ci'));
	const check = job.slice(start, job.indexOf('\n      - ', start + 1));
	assert.match(check, /if: runner\.os == 'Windows'/u);
	for (const fixture of ['gpu', 'sherpa', 'vulkan']) {
		assert.ok(check.includes(`tests/desktop-assistance-${fixture}-cmake.test.ts`));
	}
	for (const runner of ['windows-2025', 'windows-11-arm']) assert.ok(job.includes(`runner: ${runner}`));
	assert.ok(start < job.indexOf('- name: Build and test the authenticated target-native OS audio codec host'));
});

test('dispatchable native-build workflow produces results without promotion controls', async () => {
	const source = await readFile(new URL(
		'.github/workflows/soundscaper-professional-native-build-run.yml', ROOT,
	), 'utf8');
	assert.match(source, /^name: Soundscaper professional native target builds$/mu);
	assert.match(source, /workflow_dispatch:/u);
	assert.match(source, /soundscaper-professional-native-build\.yml/u);
	assert.doesNotMatch(source, /promot|signing|certificate|secrets: inherit/iu);
});
