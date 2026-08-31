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
		['linux-x64', 'ubuntu-24.04', 'linux', 'x64'],
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
	assert.match(source, /soundscaper-professional-native-build-result-\$\{\{ matrix\.target \}\}/u);
	assert.doesNotMatch(source, /signing-identity|certificate|notari[sz]/iu);
	assert.doesNotMatch(source,
		/promot|Developer ID|SIGNING_CERTIFICATE|SIGNING_PASSWORD|SOUNDSCAPER_MAC_SIGNING_IDENTITY|import-codesign-certs/iu);
	assert.doesNotMatch(source, /secrets:/u);
	assert.match(source, /architecture: \$\{\{ matrix\.tooling_node_arch \}\}/u);
	assert.match(source, /architecture: \$\{\{ matrix\.node_arch \}\}/u);
	assert.match(source, /kernel\.apparmor_restrict_unprivileged_userns=0/u);
	assert.doesNotMatch(source, /uses:\s+actions\/[a-z-]+@v\d+/u);
});

test('manual native-build workflow is debug-only and has no promotion controls', async () => {
	const source = await readFile(new URL(
		'.github/workflows/soundscaper-professional-native-build-run.yml', ROOT,
	), 'utf8');
	assert.match(source, /workflow_dispatch:/u);
	assert.match(source, /soundscaper-professional-native-build\.yml/u);
	assert.doesNotMatch(source, /promot|signing|certificate|secrets: inherit/iu);
});
