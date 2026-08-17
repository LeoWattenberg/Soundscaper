/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { verifyPackagedNativeAddonResources } from '../scripts/desktop-after-pack.mjs';
import { verifyStagedNativeAddonBeforePack } from '../scripts/desktop-before-pack.mjs';
import {
	NATIVE_ADDON_PAYLOAD_MANIFEST_PATH,
	nativeAddonPayloadStageSummary,
	nativeAddonPayloadTargetForPackagingContext,
	stageVerifiedNativeAddonPayload,
	verifyNativeAddonPayloadManifest,
} from '../scripts/lib/native-addon-payload-manifest.mjs';
import { NATIVE_HELPER_ADDON_ROOT } from '../scripts/lib/native-helper-addon-build.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const BUILT_TARGET = 'linux-x64';
// electron-builder hands both hooks its own Arch enum ordinals.
const X64 = 1;
const ARM64 = 3;

function packagingContext(appOutDir, resourcesDir, arch) {
	return {
		electronPlatformName: 'linux',
		arch,
		appOutDir,
		packager: {
			executableName: 'soundscaper',
			appInfo: { productFilename: 'Soundscaper' },
			getResourcesDir: () => resourcesDir,
		},
	};
}

function temporaryRoot(context, prefix) {
	const root = mkdtempSync(join(tmpdir(), prefix));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

async function packagedResources(context) {
	const root = temporaryRoot(context, 'soundscaper-packaged-target-');
	const resources = join(root, 'resources');
	const release = await verifyNativeAddonPayloadManifest({ repositoryRoot, target: BUILT_TARGET });
	await stageVerifiedNativeAddonPayload({ release, outputRoot: join(resources, 'runtime', 'native', BUILT_TARGET) });
	return { root, resources };
}

async function stagedBuildTree(context) {
	const root = temporaryRoot(context, 'soundscaper-staged-target-');
	mkdirSync(join(root, 'config'), { recursive: true });
	cpSync(join(repositoryRoot, NATIVE_HELPER_ADDON_ROOT), join(root, NATIVE_HELPER_ADDON_ROOT), { recursive: true });
	cpSync(join(repositoryRoot, NATIVE_ADDON_PAYLOAD_MANIFEST_PATH), join(root, NATIVE_ADDON_PAYLOAD_MANIFEST_PATH));
	const release = await verifyNativeAddonPayloadManifest({ repositoryRoot: root, target: BUILT_TARGET });
	await stageVerifiedNativeAddonPayload({
		release,
		outputRoot: join(root, '.desktop-build', 'runtime', 'native', BUILT_TARGET),
	});
	const stageManifestPath = join(root, '.desktop-build/stage-manifest.json');
	await writeFile(stageManifestPath, `${JSON.stringify({ nativeAddons: nativeAddonPayloadStageSummary(release) }, null, 2)}\n`);
	return { root, stageManifestPath };
}

test('the packaging context names the target electron-builder is packing', () => {
	assert.equal(nativeAddonPayloadTargetForPackagingContext({ electronPlatformName: 'linux', arch: X64 }), 'linux-x64');
	assert.equal(nativeAddonPayloadTargetForPackagingContext({ electronPlatformName: 'linux', arch: ARM64 }), 'linux-arm64');
	assert.equal(nativeAddonPayloadTargetForPackagingContext({ electronPlatformName: 'darwin', arch: ARM64 }), 'mac-arm64');
	assert.equal(nativeAddonPayloadTargetForPackagingContext({ electronPlatformName: 'mas', arch: ARM64 }), 'mac-arm64');
	assert.equal(nativeAddonPayloadTargetForPackagingContext({ electronPlatformName: 'win32', arch: 'arm64' }), 'win-arm64');
	assert.throws(
		() => nativeAddonPayloadTargetForPackagingContext({ electronPlatformName: 'linux', arch: 0 }),
		/linux-ia32.*not a claimed milestone-5A target/u,
	);
	assert.throws(
		() => nativeAddonPayloadTargetForPackagingContext({ electronPlatformName: 'freebsd', arch: X64 }),
		/Unsupported Electron packaging platform/u,
	);
	assert.throws(
		() => nativeAddonPayloadTargetForPackagingContext({ electronPlatformName: 'linux' }),
		/packaging architecture is unavailable/u,
	);
});

test('beforePack refuses a staged native payload that is not the target being packed', async (context) => {
	const { root, stageManifestPath } = await stagedBuildTree(context);
	const summary = await verifyStagedNativeAddonBeforePack({
		repositoryRoot: root,
		stageManifestPath,
		packagedTarget: BUILT_TARGET,
	});
	assert.equal(summary.target, BUILT_TARGET);
	await assert.rejects(
		() => verifyStagedNativeAddonBeforePack({
			repositoryRoot: root,
			stageManifestPath,
			packagedTarget: 'linux-arm64',
		}),
		/staged native addon payload targets linux-x64.*electron-builder is packing linux-arm64/u,
	);
});

test('afterPack refuses a packaged native payload that is not the target being packed', async (context) => {
	const { root, resources } = await packagedResources(context);
	const summary = await verifyPackagedNativeAddonResources(packagingContext(root, resources, X64), { repositoryRoot });
	assert.equal(summary.target, BUILT_TARGET);
	await assert.rejects(
		() => verifyPackagedNativeAddonResources(packagingContext(root, resources, ARM64), { repositoryRoot }),
		/packaged native addon payload carries linux-x64.*electron-builder is packing linux-arm64/iu,
	);
});
