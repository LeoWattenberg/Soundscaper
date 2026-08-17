/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
	verifyFfmpegRuntimeManifest,
	verifyStagedFfmpegRuntime,
} from './lib/ffmpeg-runtime-manifest.mjs';
import {
	nativeAddonPayloadOutputRoot,
	nativeAddonPayloadTargetForPackagingContext,
	verifyNativeAddonPayloadManifest,
	verifyStagedNativeAddonPayload,
} from './lib/native-addon-payload-manifest.mjs';

/**
 * Electron Builder beforePack hook. Re-verify the policy-bound runtime after
 * preparation so a changed staging tree never reaches ASAR/resource assembly.
 * The two runtimes occupy disjoint subtrees of the build directory and each
 * verification is a full multi-file read-and-hash pass, so they run together.
 */
export default async function verifyDesktopRuntimeBeforePack(context = {}, dependencies = {}) {
	const repositoryRoot = resolve(context.packager?.projectDir ?? resolve(import.meta.dirname, '..'));
	const stageManifestPath = resolve(repositoryRoot, '.desktop-build/stage-manifest.json');
	const packagedTarget = nativeAddonPayloadTargetForPackagingContext(context);
	const verifyFfmpeg = dependencies.verifyStagedFfmpegBeforePack ?? verifyStagedFfmpegBeforePack;
	const verifyNativeAddon = dependencies.verifyStagedNativeAddonBeforePack ?? verifyStagedNativeAddonBeforePack;
	await Promise.all([
		verifyFfmpeg({ repositoryRoot, stageManifestPath }),
		verifyNativeAddon({ repositoryRoot, stageManifestPath, packagedTarget }),
	]);
}

export async function verifyStagedFfmpegBeforePack({ repositoryRoot, stageManifestPath }) {
	const release = await verifyFfmpegRuntimeManifest({
		repositoryRoot,
		purpose: 'desktop-assembly',
	});
	return verifyStagedFfmpegRuntime({
		release,
		outputRoot: resolve(repositoryRoot, `.desktop-build/runtime/ffmpeg/${release.manifest.package.version}`),
		stageManifestPath,
		noticePath: resolve(repositoryRoot, '.desktop-build/licenses/THIRD_PARTY_LICENSES.md'),
	});
}

/**
 * The staged native payload is re-verified against the target the staging run
 * actually recorded and against the target electron-builder is packing, so a
 * stage tree assembled for one architecture can never be packed as another.
 */
export async function verifyStagedNativeAddonBeforePack({ repositoryRoot, stageManifestPath, packagedTarget }) {
	const stage = JSON.parse(await readFile(stageManifestPath, 'utf8'));
	const staged = stage?.nativeAddons;
	if (!staged || typeof staged.target !== 'string') {
		throw new Error('The desktop stage manifest does not record a staged native addon payload.');
	}
	if (staged.target !== packagedTarget) {
		throw new Error(`The staged native addon payload targets ${staged.target} but electron-builder is packing ${packagedTarget}.`);
	}
	const release = await verifyNativeAddonPayloadManifest({
		repositoryRoot,
		target: staged.target,
		targetSource: staged.targetSource === 'build-host' ? 'build-host' : 'declared',
	});
	return verifyStagedNativeAddonPayload({
		release,
		outputRoot: nativeAddonPayloadOutputRoot(resolve(repositoryRoot, '.desktop-build/runtime'), release),
		stageManifestPath,
	});
}
