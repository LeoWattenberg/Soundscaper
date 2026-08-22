/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import hardenPackagedElectron from '../scripts/desktop-after-pack.mjs';
import verifyDesktopRuntimeBeforePack from '../scripts/desktop-before-pack.mjs';
import {
	stageVerifiedNativeAddonPayload,
	verifyNativeAddonPayloadManifest,
} from '../scripts/lib/native-addon-payload-manifest.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const BUILT_TARGET = 'linux-x64';
const X64 = 1;

test('afterPack starts the native payload verification without waiting for the FFmpeg one', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-overlap-after-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const resources = join(root, 'resources');
	const release = await verifyNativeAddonPayloadManifest({ repositoryRoot, target: BUILT_TARGET });
	await stageVerifiedNativeAddonPayload({ release, outputRoot: join(resources, 'runtime', 'native', BUILT_TARGET) });

	const resourceCalls = [];
	const packagingContext = {
		electronPlatformName: 'linux',
		arch: X64,
		appOutDir: root,
		packager: {
			executableName: 'soundscaper',
			appInfo: { productFilename: 'Soundscaper' },
			getResourcesDir(value) {
				resourceCalls.push(value);
				return resources;
			},
		},
	};
	const settled = hardenPackagedElectron(packagingContext, { repositoryRoot, flipFuses: async () => {} })
		.then(() => null, (error) => error);
	assert.equal(resourceCalls.length, 1, 'the native payload verification must begin before the FFmpeg one settles');
	await settled;
});

test('beforePack verifies FFmpeg, addon, and Framescaper host runtimes at once', async () => {
	const started = [];
	let releaseFfmpeg;
	const ffmpeg = new Promise((resolvePromise) => { releaseFfmpeg = resolvePromise; });
	const settled = verifyDesktopRuntimeBeforePack(
		{ electronPlatformName: 'linux', arch: X64, packager: { projectDir: repositoryRoot } },
		{
			verifyStagedFfmpegBeforePack: async () => {
				started.push('ffmpeg');
				await ffmpeg;
			},
			verifyStagedNativeAddonBeforePack: async () => { started.push('native'); },
			verifyStagedFramescaperNativeHostsBeforePack: async () => {
				started.push('framescaper-native-hosts');
			},
		},
	).then(() => null, (error) => error);
	assert.deepEqual(started, ['ffmpeg', 'native', 'framescaper-native-hosts']);
	releaseFfmpeg();
	assert.equal(await settled, null);
});
