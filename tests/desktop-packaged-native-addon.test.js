/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import hardenPackagedElectron, { verifyPackagedNativeAddonResources } from '../scripts/desktop-after-pack.mjs';
import {
	stageVerifiedFfmpegNotice,
	stageVerifiedFfmpegRuntime,
	verifyFfmpegRuntimeManifest,
} from '../scripts/lib/ffmpeg-runtime-manifest.mjs';
import {
	stageVerifiedNativeAddonPayload,
	verifyNativeAddonPayloadManifest,
} from '../scripts/lib/native-addon-payload-manifest.mjs';

const BUILT_TARGET = 'linux-x64';
const PENDING_TARGET = 'mac-arm64';

async function packagedResources(context, target = BUILT_TARGET) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-packaged-native-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const resources = join(root, 'resources');
	const ffmpeg = await verifyFfmpegRuntimeManifest({ repositoryRoot: process.cwd(), purpose: 'desktop-assembly' });
	await stageVerifiedFfmpegRuntime({
		release: ffmpeg,
		outputRoot: join(resources, `runtime/ffmpeg/${ffmpeg.manifest.package.version}`),
	});
	await mkdir(join(resources, 'licenses'), { recursive: true });
	await stageVerifiedFfmpegNotice({ release: ffmpeg, outputPath: join(resources, 'licenses/THIRD_PARTY_LICENSES.md') });
	const release = await verifyNativeAddonPayloadManifest({ repositoryRoot: process.cwd(), target });
	const nativeRoot = join(resources, `runtime/native/${target}`);
	await stageVerifiedNativeAddonPayload({ release, outputRoot: nativeRoot });
	return { root, resources, nativeRoot, release };
}

function packagingContext(appOutDir, resourcesDir) {
	return {
		electronPlatformName: 'linux',
		appOutDir,
		packager: {
			executableName: 'soundscaper',
			appInfo: { productFilename: 'Soundscaper' },
			getResourcesDir(value) {
				assert.equal(value, appOutDir);
				return resourcesDir;
			},
		},
	};
}

test('afterPack verifies the packaged native addon payload before any fuse work', async (context) => {
	const { root, resources, nativeRoot, release } = await packagedResources(context);
	const fuseCalls = [];
	const invoke = () => hardenPackagedElectron(packagingContext(root, resources), {
		repositoryRoot: process.cwd(),
		flipFuses: async (...args) => { fuseCalls.push(args); },
	});
	await invoke();
	assert.equal(fuseCalls.length, 1);

	fuseCalls.length = 0;
	await writeFile(join(nativeRoot, release.payload.name), 'tampered packaged addon');
	await assert.rejects(invoke(), /packaged native addon payload linux-x64.*(?:byte length|digest)/iu);
	assert.equal(fuseCalls.length, 0);
	await writeFile(join(nativeRoot, release.payload.name), release.payload.bytes);

	await writeFile(join(nativeRoot, 'native-addon-payload-manifest.json'), '{"schemaVersion":1}\n');
	await assert.rejects(invoke(), /packaged native addon payload manifest.*verified policy manifest/iu);
	assert.equal(fuseCalls.length, 0);
	await writeFile(join(nativeRoot, 'native-addon-payload-manifest.json'), release.manifestBytes);

	await writeFile(join(nativeRoot, 'libextra.so'), 'unexpected');
	await assert.rejects(invoke(), /packaged native addon payload inventory mismatch/iu);
	assert.equal(fuseCalls.length, 0);
	await rm(join(nativeRoot, 'libextra.so'));

	await invoke();
	assert.equal(fuseCalls.length, 1);
});

test('a package that carries no native target, or more than one, is rejected', async (context) => {
	const { root, resources, nativeRoot } = await packagedResources(context);
	const invoke = () => verifyPackagedNativeAddonResources(packagingContext(root, resources), {
		repositoryRoot: process.cwd(),
	});
	await mkdir(join(resources, 'runtime/native/win-x64'), { recursive: true });
	await assert.rejects(invoke(), /exactly one target; found linux-x64, win-x64/iu);
	await rm(join(resources, 'runtime/native/win-x64'), { recursive: true });
	await rm(nativeRoot, { recursive: true });
	await assert.rejects(invoke(), /exactly one target; found <none>/iu);
});

test('a target whose payload is pending-external packages its manifest and nothing else', async (context) => {
	const { root, resources } = await packagedResources(context, PENDING_TARGET);
	const summary = await verifyPackagedNativeAddonResources(packagingContext(root, resources), {
		repositoryRoot: process.cwd(),
	});
	assert.equal(summary.target, PENDING_TARGET);
	assert.equal(summary.payload, null);
	assert.match(summary.blockedBy, /macOS ARM64 build host/u);
});
