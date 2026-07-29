/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import {
	verifyFfmpegRuntimeManifest,
	verifyStagedFfmpegRuntime,
} from './lib/ffmpeg-runtime-manifest.mjs';

/**
 * Electron Builder beforePack hook. Re-verify the policy-bound runtime after
 * preparation so a changed staging tree never reaches ASAR/resource assembly.
 */
export default async function verifyDesktopRuntimeBeforePack(context = {}) {
	const repositoryRoot = resolve(context.packager?.projectDir ?? resolve(import.meta.dirname, '..'));
	const release = await verifyFfmpegRuntimeManifest({
		repositoryRoot,
		purpose: 'desktop-assembly',
	});
	await verifyStagedFfmpegRuntime({
		release,
		outputRoot: resolve(repositoryRoot, `.desktop-build/runtime/ffmpeg/${release.manifest.package.version}`),
		stageManifestPath: resolve(repositoryRoot, '.desktop-build/stage-manifest.json'),
		noticePath: resolve(repositoryRoot, '.desktop-build/licenses/THIRD_PARTY_LICENSES.md'),
	});
}
