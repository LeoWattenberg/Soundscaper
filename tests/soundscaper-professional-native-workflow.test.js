/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');

test('reusable professional candidate workflow closes all five Soundscaper targets', async () => {
	const source = await readFile(resolve(ROOT,
		'.github/workflows/soundscaper-professional-native-candidates.yml'), 'utf8');
	for (const [target, runner, platform, arch, nodeArch] of [
		['linux-x64', 'ubuntu-24.04', 'linux', 'x64', 'x64'],
		['linux-arm64', 'ubuntu-24.04-arm', 'linux', 'arm64', 'arm64'],
		['mac-arm64', 'macos-15', 'mac', 'arm64', 'arm64'],
		['win-x64', 'windows-2025', 'win', 'x64', 'x64'],
		['win-arm64', 'windows-11-arm', 'win', 'arm64', 'x64'],
	]) {
		const row = [
			`target: ${target}`, `runner: ${runner}`, `platform: ${platform}`,
			`arch: ${arch}`, `node_arch: ${nodeArch}`,
		].join('\\n\\s+');
		assert.equal([...source.matchAll(new RegExp(row, 'gu'))].length, 1);
	}
	assert.match(source, /workflow_call:/u);
	assert.match(source, /npm run milestone5a:native-candidate/u);
	assert.match(source, /npm run milestone5a:promote-native-candidate/u);
	assert.match(source, /architecture: \$\{\{ matrix\.node_arch \}\}/u);
	assert.match(source, /SOUNDSCAPER_DESKTOP_TARGET_PLATFORM: \$\{\{ matrix\.platform \}\}/u);
	assert.match(source, /SOUNDSCAPER_DESKTOP_TARGET_ARCH: \$\{\{ matrix\.arch \}\}/u);
	assert.match(source,
		/npx electron-builder --config electron-builder\.config\.cjs[\s\\]*--\$\{\{ matrix\.platform \}\}[\s\\]*--\$\{\{ matrix\.arch \}\}[\s\\]*--dir/u);
	assert.match(source,
		/SOUNDSCAPER_SOURCE_REVISION="\$\(git rev-parse HEAD\)" npm run desktop:prepare/u);
	for (const runnerArgument of [
		'--runner-os=${{ runner.os }}', '--runner-arch=${{ runner.arch }}',
	]) assert.equal(source.split(runnerArgument).length - 1, 2, runnerArgument);
	assert.match(source, /soundscaper-professional-native-five-target-promotion/u);
	assert.match(source, /SOUNDSCAPER_MAC_SIGNING_IDENTITY/u);
	assert.match(source, /SOUNDSCAPER_MAC_SIGNING_CERTIFICATE/u);
	assert.match(source, /SOUNDSCAPER_MAC_SIGNING_PASSWORD/u);
	assert.match(source,
		/apple-actions\/import-codesign-certs@5142e029c445c10ffc7149d172e540235a065466/u);
	assert.match(source, /Developer ID Application:/u);
	assert.match(source, /--signing-identity="\$signing_identity"/u);
	assert.match(source, /if \[\[ "\$\{\{ inputs\.promote \}\}" == "true" \]\]/u);
	assert.doesNotMatch(source, /--signing-identity=-/u,
		'production-capable candidate commands must not hard-code ad-hoc signing');
	assert.doesNotMatch(source, /framescaper/iu);
	assert.doesNotMatch(source, /uses:\s+actions\/[a-z-]+@v\d+/u);
	assert.equal([...source.matchAll(/npm install --global npm@12\.0\.1/gu)].length, 2);
	for (const pin of [
		'actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd',
		'actions/setup-node@395ad3262231945c25e8478fd5baf05154b1d79f',
		'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
		'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
	]) assert(source.includes(pin));
});

test('dispatch workflow produces and passes one authenticated Soundscaper-only source cache', async () => {
	const [source, reusable] = await Promise.all([
		readFile(resolve(ROOT,
			'.github/workflows/soundscaper-professional-native-candidate-run.yml'), 'utf8'),
		readFile(resolve(ROOT,
			'.github/workflows/soundscaper-professional-native-candidates.yml'), 'utf8'),
	]);
	assert.match(source, /^\s{2}workflow_dispatch:\s*$/mu);
	assert.match(source, /uses: \.\/\.github\/workflows\/soundscaper-professional-native-candidates\.yml/u);
	assert.match(source, /needs: source-cache/u);

	const artifactNames = [...source.matchAll(
		/name: (soundscaper-professional-native-source-cache)/gu,
	)].map((match) => match[1]);
	assert.deepEqual(artifactNames, ['soundscaper-professional-native-source-cache'],
		'the source cache must have one exclusive artifact producer');
	assert.match(source, /source-cache-artifact: soundscaper-professional-native-source-cache/u);
	assert.match(reusable, /name: \$\{\{ inputs\.source-cache-artifact \}\}/u);
	assert.match(reusable, /path: \$\{\{ runner\.temp \}\}\/soundscaper-native-sources/u);
	assert.match(source, /include-hidden-files: true/u,
		'portable source-tree authentication includes dotfiles');
	assert.match(source, /secrets: inherit/u,
		'the production run must pass configured signing credentials to the reusable workflow');

	for (const id of [
		'electron-node-api-headers', 'juce', 'clap', 'vst3-sdk', 'asio-sdk', 'lv2',
	]) {
		assert.equal([...source.matchAll(new RegExp(`--source ${id}(?:\\s|$)`, 'gu'))].length, 2,
			`${id} must be provisioned and independently checked`);
	}
	for (const framescaperSource of ['x264', 'x265', 'libvpx', 'libopus']) {
		assert.doesNotMatch(source, new RegExp(`--source ${framescaperSource}(?:\\s|$)`, 'u'));
	}
	assert.match(source, /provision:milestone-5-native-sources[^\n]+--check/u);
	assert.doesNotMatch(source, /--root=/u,
		'the provisioning CLI requires the root path as a separate argument');
	assert.doesNotMatch(source, /pull_request|push:/u);
	assert.doesNotMatch(source, /uses:\s+actions\/[a-z-]+@v\d+/u);
	for (const pin of [
		'actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd',
		'actions/setup-node@395ad3262231945c25e8478fd5baf05154b1d79f',
		'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
	]) assert(source.includes(pin));
});

test('professional candidate and promotion package commands are explicit', async () => {
	const package_ = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
	assert.equal(package_.scripts['milestone5a:native-candidate'],
		'node scripts/build-m5a-professional-native-candidate.mjs');
	assert.equal(package_.scripts['milestone5a:promote-native-candidate'],
		'node scripts/promote-m5a-professional-native-candidate.mjs');
	const candidateCommand = await readFile(resolve(ROOT,
		'scripts/build-m5a-professional-native-candidate.mjs'), 'utf8');
	const candidatePipeline = await readFile(resolve(ROOT,
		'scripts/lib/soundscaper-professional-native-candidate-pipeline.mjs'), 'utf8');
	assert.doesNotMatch(candidateCommand, /--self-test-plan|['"]self-test-plan['"]/iu);
	assert.match(candidateCommand,
		/createAuthenticatedSoundscaperProfessionalNativeSelfTestPlan/u);
	assert.match(candidateCommand, /signingIdentity: args\['signing-identity'\]/u);
	assert.match(candidateCommand, /runnerOs: args\['runner-os'\]/u);
	assert.match(candidateCommand, /runnerArch: args\['runner-arch'\]/u);
	assert.match(candidatePipeline, /createSoundscaperProfessionalNativeMacSigningPlan/u);
	assert.match(candidatePipeline, /executeSoundscaperProfessionalNativeMacSigningPlan/u);
	assert.match(candidatePipeline, /macSigningEvidence/u);
});
