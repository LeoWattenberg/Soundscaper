/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
	verifyFfmpegRuntimeManifest,
	verifyStagedFfmpegRuntime,
} from './lib/ffmpeg-runtime-manifest.mjs';
import {
	verifyNativeAddonPayloadManifest,
	verifyStagedNativeAddonPayload,
} from './lib/native-addon-payload-manifest.mjs';

/**
 * Electron Builder beforePack hook. Re-verify the policy-bound runtime after
 * preparation so a changed staging tree never reaches ASAR/resource assembly.
 */
export default async function verifyDesktopRuntimeBeforePack(context = {}) {
	const repositoryRoot = resolve(context.packager?.projectDir ?? resolve(import.meta.dirname, '..'));
	const stageManifestPath = resolve(repositoryRoot, '.desktop-build/stage-manifest.json');
	const release = await verifyFfmpegRuntimeManifest({
		repositoryRoot,
		purpose: 'desktop-assembly',
	});
	await verifyStagedFfmpegRuntime({
		release,
		outputRoot: resolve(repositoryRoot, `.desktop-build/runtime/ffmpeg/${release.manifest.package.version}`),
		stageManifestPath,
		noticePath: resolve(repositoryRoot, '.desktop-build/licenses/THIRD_PARTY_LICENSES.md'),
	});
	await verifyStagedNativeAddonBeforePack({ repositoryRoot, stageManifestPath });
}

/**
 * The staged native payload is re-verified against the target the staging run
 * actually recorded, so a stage tree assembled for one architecture can never
 * be packed as another.
 */
export async function verifyStagedNativeAddonBeforePack({ repositoryRoot, stageManifestPath }) {
	const stage = JSON.parse(await readFile(stageManifestPath, 'utf8'));
	const staged = stage?.nativeAddons;
	if (!staged || typeof staged.target !== 'string') {
		throw new Error('The desktop stage manifest does not record a staged native addon payload.');
	}
	const release = await verifyNativeAddonPayloadManifest({
		repositoryRoot,
		target: staged.target,
		targetSource: staged.targetSource === 'build-host' ? 'build-host' : 'declared',
	});
	return verifyStagedNativeAddonPayload({
		release,
		outputRoot: resolve(repositoryRoot, `.desktop-build/runtime/native/${release.target.id}`),
		stageManifestPath,
	});
}
