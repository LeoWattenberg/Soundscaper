/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import assistanceNativeRuntimeManifest from '../config/assistance-native-runtime-manifest.json' with { type: 'json' };
import { stageAssistanceNativeRuntimePayload } from '../desktop/assistance-native-runtime-payload.mjs';
import hardenPackagedElectron, { verifyPackagedNativeAddonResources } from '../scripts/desktop-after-pack.mjs';
import { DESKTOP_CODEC_POLICY } from '../scripts/lib/desktop-codec-policy.mjs';
import {
	stageVerifiedNativeAddonPayload,
	verifyNativeAddonPayloadManifest,
} from '../scripts/lib/native-addon-payload-manifest.mjs';
import {
	professionalNativePayloadOutputRoot,
	stageVerifiedSoundscaperProfessionalNativePayload,
	verifySoundscaperProfessionalNativePayload,
} from '../scripts/lib/soundscaper-professional-native-payload.mjs';

const BUILT_TARGET = 'linux-x64';
const PENDING_TARGET = 'mac-arm64';

async function packagedResources(context, target = BUILT_TARGET) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-packaged-native-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const resources = join(root, 'resources');
	const stageManifestPath = join(root, 'stage-manifest.json');
	await writeFile(stageManifestPath, `${JSON.stringify({ desktopCodecPolicy: DESKTOP_CODEC_POLICY })}\n`);
	const release = await verifyNativeAddonPayloadManifest({ repositoryRoot: process.cwd(), target });
	const nativeRoot = join(resources, `runtime/native/${target}`);
	await stageVerifiedNativeAddonPayload({ release, outputRoot: nativeRoot });
	const professional = await verifySoundscaperProfessionalNativePayload({
		repositoryRoot: process.cwd(), target,
	});
	await stageVerifiedSoundscaperProfessionalNativePayload({
		release: professional,
		outputRoot: professionalNativePayloadOutputRoot(join(resources, 'runtime'), professional),
	});
	if (target === BUILT_TARGET) {
		await stageAssistanceNativeRuntimePayload({
			manifest: assistanceNativeRuntimeManifest,
			targetId: target,
			nodeModulesRoot: join(process.cwd(), 'node_modules'),
			outputRoot: join(resources, 'runtime'),
		});
	}
	return { root, resources, nativeRoot, release, stageManifestPath };
}

// electron-builder names the packed platform with Node's vocabulary and the
// packed architecture with an ordinal of its own Arch enum.
const PACKED_PLATFORMS = { linux: 'linux', mac: 'darwin', win: 'win32' };
const PACKED_ARCHITECTURES = { x64: 1, arm64: 3 };

function packagingContext(appOutDir, resourcesDir, target = BUILT_TARGET) {
	const [platform, architecture] = target.split('-');
	return {
		electronPlatformName: PACKED_PLATFORMS[platform],
		arch: PACKED_ARCHITECTURES[architecture],
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
	const { root, resources, nativeRoot, release, stageManifestPath } = await packagedResources(context);
	const fuseCalls = [];
	const invoke = () => hardenPackagedElectron(packagingContext(root, resources), {
		repositoryRoot: process.cwd(),
		stageManifestPath,
		verifyPackagedElectronAlternateFfmpeg: async () => {},
		flipFuses: async (...args) => { fuseCalls.push(args); },
		writeDesktopPackageContentManifest: async () => {},
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

test('the addon verifier leaves the closed Framescaper host subtrees to their owner', async (context) => {
	const { root, resources } = await packagedResources(context);
	await mkdir(join(resources, 'runtime/native/framescaper-media-host/linux-x64'), { recursive: true });
	await mkdir(join(resources, 'runtime/native/framescaper-openfx-host/linux-x64'), { recursive: true });
	const framescaperContext = packagingContext(root, resources);
	framescaperContext.packager.appInfo.productFilename = 'Framescaper';
	await assert.doesNotReject(() => verifyPackagedNativeAddonResources(framescaperContext, {
		repositoryRoot: process.cwd(),
	}));
	await assert.rejects(
		() => verifyPackagedNativeAddonResources(packagingContext(root, resources), {
			repositoryRoot: process.cwd(),
		}),
		/Soundscaper resources carry Framescaper native-host payloads/iu,
	);
});

test('a target whose payload is pending-external packages its manifest and nothing else', async (context) => {
	const { root, resources } = await packagedResources(context, PENDING_TARGET);
	const summary = await verifyPackagedNativeAddonResources(packagingContext(root, resources, PENDING_TARGET), {
		repositoryRoot: process.cwd(),
	});
	assert.equal(summary.target, PENDING_TARGET);
	assert.equal(summary.payload, null);
	assert.match(summary.blockedBy, /macOS ARM64 build host/u);
});
