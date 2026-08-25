/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import hardenPackagedElectron from '../scripts/desktop-after-pack.mjs';
import verifyDesktopRuntimeBeforePack from '../scripts/desktop-before-pack.mjs';
const repositoryRoot = resolve(import.meta.dirname, '..');
const X64 = 1;

test('afterPack starts payload verification without waiting for the codec absence audit', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-overlap-after-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const resources = join(root, 'resources');
	const started = [];
	let releaseAudit;
	const audit = new Promise((resolvePromise) => { releaseAudit = resolvePromise; });
	const packagingContext = {
		electronPlatformName: 'linux',
		arch: X64,
		appOutDir: root,
		packager: {
			executableName: 'soundscaper',
			appInfo: { productFilename: 'Soundscaper' },
			getResourcesDir: () => resources,
		},
	};
	const settled = hardenPackagedElectron(packagingContext, {
		repositoryRoot,
		auditPackagedDesktopCodecPolicy: async () => {
			started.push('codec-absence');
			await audit;
		},
		verifyPackagedElectronAlternateFfmpeg: async () => { started.push('electron-ffmpeg'); },
		verifyPackagedAssistanceNativeRuntime: async () => { started.push('assistance-native'); },
		verifyPackagedNativeAddonResources: async () => { started.push('native'); },
		verifyPackagedOsAudioCodecNativeResources: async () => { started.push('os-audio-codec'); },
		verifyPackagedSoundscaperProfessionalNativeResources: async () => {
			started.push('soundscaper-professional');
		},
		verifyPackagedFramescaperNativeHostResources: async () => {
			started.push('framescaper-native-hosts');
		},
		flipFuses: async () => {},
		writeDesktopPackageContentManifest: async () => {},
	})
		.then(() => null, (error) => error);
	assert.deepEqual(started, [
		'codec-absence', 'electron-ffmpeg', 'assistance-native', 'native', 'soundscaper-professional',
		'framescaper-native-hosts', 'os-audio-codec',
	]);
	releaseAudit();
	assert.equal(await settled, null);
});

test('beforePack runs the absence audit and native runtime verification at once', async () => {
	const started = [];
	let releaseAudit;
	const audit = new Promise((resolvePromise) => { releaseAudit = resolvePromise; });
	const settled = verifyDesktopRuntimeBeforePack(
		{ electronPlatformName: 'linux', arch: X64, packager: { projectDir: repositoryRoot } },
		{
			auditStagedDesktopCodecPolicy: async () => {
				started.push('codec-absence');
				await audit;
			},
			verifyStagedAssistanceNativeRuntime: async () => { started.push('assistance-native'); },
			verifyStagedNativeAddonBeforePack: async () => { started.push('native'); },
			verifyStagedOsAudioCodecNativeBeforePack: async () => { started.push('os-audio-codec'); },
			verifyStagedSoundscaperProfessionalNativeBeforePack: async () => {
				started.push('soundscaper-professional');
			},
			verifyStagedFramescaperNativeHostsBeforePack: async () => {
				started.push('framescaper-native-hosts');
			},
		},
	).then(() => null, (error) => error);
	assert.deepEqual(started, [
		'codec-absence', 'assistance-native', 'native', 'soundscaper-professional',
		'framescaper-native-hosts', 'os-audio-codec',
	]);
	releaseAudit();
	assert.equal(await settled, null);
});
