/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import hardenPackagedElectron from '../scripts/desktop-after-pack.mjs';
import { auditStagedDesktopCodecPolicy } from '../scripts/desktop-before-pack.mjs';
import { DESKTOP_CODEC_POLICY } from '../scripts/lib/desktop-codec-policy.mjs';

test('afterPack proves FFmpeg absence before fuse work', async (context) => {
	const fixture = await packagedFixture(context);
	const fuseCalls = [];
	const invoke = () => hardenPackagedElectron(fixture.packagingContext, {
		repositoryRoot: process.cwd(),
		stageManifestPath: fixture.stageManifestPath,
		flipFuses: async (...args) => { fuseCalls.push(args); },
		writeDesktopPackageContentManifest: async () => {},
		...nativeVerifierStubs(),
	});
	await invoke();
	assert.equal(fuseCalls.length, 1);

	for (const name of [
		'runtime/ffmpeg/0.12.10/manifest.json',
		'renderer/assets/ffmpeg-core.wasm',
		'runtime/native/linux-x64/avcodec-61.dll',
		'runtime/native/linux-x64/libavformat.so.61',
		'desktop/ffmpeg-corresponding-source.json',
	]) {
		fuseCalls.length = 0;
		const path = join(fixture.resources, name);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, 'forbidden desktop payload');
		await assert.rejects(invoke(), /packaged desktop resources.*forbidden unmanaged FFmpeg\/libav/iu, name);
		assert.equal(fuseCalls.length, 0, name);
		await rm(path);
		if (name.startsWith('runtime/ffmpeg/')) {
			await rm(join(fixture.resources, 'runtime/ffmpeg'), { recursive: true });
		}
	}
});

test('stage and package gates reject missing or changed desktop codec policy', async (context) => {
	const fixture = await packagedFixture(context);
	await writeFile(fixture.stageManifestPath, `${JSON.stringify({
		desktopCodecPolicy: { ...DESKTOP_CODEC_POLICY, bundledFfmpeg: true },
	}, null, 2)}\n`);
	await assert.rejects(
		() => auditStagedDesktopCodecPolicy({
			repositoryRoot: fixture.root,
			stageManifestPath: fixture.stageManifestPath,
		}),
		/desktop stage codec policy/iu,
	);
	let fuses = 0;
	await assert.rejects(() => hardenPackagedElectron(fixture.packagingContext, {
		stageManifestPath: fixture.stageManifestPath,
		flipFuses: async () => { fuses += 1; },
		writeDesktopPackageContentManifest: async () => {},
		...nativeVerifierStubs(),
	}), /packaged desktop codec policy/iu);
	assert.equal(fuses, 0);
});

test('beforePack rejects forbidden content anywhere in the staged desktop tree', async (context) => {
	const fixture = await packagedFixture(context);
	assert.equal((await auditStagedDesktopCodecPolicy({
		repositoryRoot: fixture.root,
		stageManifestPath: fixture.stageManifestPath,
	})).status, 'no-bundled-ffmpeg');
	const payload = join(fixture.root, '.desktop-build/renderer/assets/ffmpeg-core.js');
	await mkdir(dirname(payload), { recursive: true });
	await writeFile(payload, 'forbidden staged core');
	await assert.rejects(
		() => auditStagedDesktopCodecPolicy({
			repositoryRoot: fixture.root,
			stageManifestPath: fixture.stageManifestPath,
		}),
		/staged desktop resources.*ffmpeg-core\.js/iu,
	);
});

async function packagedFixture(context) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-packaged-codec-policy-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const resources = join(root, 'resources');
	const stageManifestPath = join(root, '.desktop-build/stage-manifest.json');
	await mkdir(resources, { recursive: true });
	await mkdir(dirname(stageManifestPath), { recursive: true });
	await writeFile(stageManifestPath, `${JSON.stringify({
		schemaVersion: 1,
		desktopCodecPolicy: DESKTOP_CODEC_POLICY,
	}, null, 2)}\n`);
	return {
		root,
		resources,
		stageManifestPath,
		packagingContext: {
			electronPlatformName: 'linux',
			arch: 1,
			appOutDir: root,
			packager: {
				executableName: 'soundscaper',
				appInfo: { productFilename: 'Soundscaper' },
				getResourcesDir(value) {
					assert.equal(value, root);
					return resources;
				},
			},
		},
	};
}

function nativeVerifierStubs() {
	return {
		verifyPackagedElectronAlternateFfmpeg: async () => {},
		verifyPackagedAssistanceNativeRuntime: async () => {},
		verifyPackagedNativeAddonResources: async () => {},
		verifyPackagedSoundscaperProfessionalNativeResources: async () => {},
		verifyPackagedFramescaperNativeHostResources: async () => {},
		verifyPackagedOsAudioCodecNativeResources: async () => {},
	};
}
