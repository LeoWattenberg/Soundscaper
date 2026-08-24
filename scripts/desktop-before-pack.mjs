/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import assistanceNativeRuntimeManifest from '../config/assistance-native-runtime-manifest.json' with { type: 'json' };
import {
	assistanceNativeRuntimeStageSummary,
	verifyAssistanceNativeRuntimePayload,
} from '../desktop/assistance-native-runtime-payload.mjs';
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
import {
	verifyFramescaperNativeHostPayloads,
	verifyStagedFramescaperNativeHostPayloads,
} from './lib/framescaper-native-host-payload-staging.mjs';
import {
	professionalNativePayloadOutputRoot,
	verifySoundscaperProfessionalNativePayload,
	verifyStagedSoundscaperProfessionalNativePayload,
} from './lib/soundscaper-professional-native-payload.mjs';

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
	const verifyAssistance = dependencies.verifyStagedAssistanceNativeRuntime
		?? verifyStagedAssistanceNativeRuntime;
	const verifyNativeAddon = dependencies.verifyStagedNativeAddonBeforePack ?? verifyStagedNativeAddonBeforePack;
	const verifyNativeHosts = dependencies.verifyStagedFramescaperNativeHostsBeforePack
		?? verifyStagedFramescaperNativeHostsBeforePack;
	const verifyProfessional = dependencies.verifyStagedSoundscaperProfessionalNativeBeforePack
		?? verifyStagedSoundscaperProfessionalNativeBeforePack;
	await Promise.all([
		verifyFfmpeg({ repositoryRoot, stageManifestPath }),
		verifyAssistance({
			repositoryRoot, stageManifestPath, packagedTarget,
		}),
		verifyNativeAddon({ repositoryRoot, stageManifestPath, packagedTarget }),
		verifyProfessional({ repositoryRoot, stageManifestPath, packagedTarget }),
		verifyNativeHosts({ repositoryRoot, stageManifestPath, packagedTarget }),
	]);
}

export async function verifyStagedSoundscaperProfessionalNativeBeforePack({
	repositoryRoot, stageManifestPath, packagedTarget,
}) {
	const stage = JSON.parse(await readFile(stageManifestPath, 'utf8'));
	if (stage?.productId === 'framescaper') {
		if (stage.soundscaperProfessionalNative !== null) {
			throw new Error('A Framescaper desktop stage cannot carry the Soundscaper professional payload.');
		}
		return null;
	}
	if (stage?.productId !== 'soundscaper' || stage.soundscaperProfessionalNative?.target !== packagedTarget) {
		throw new Error('The Soundscaper desktop stage has no exact professional native payload authority.');
	}
	const release = await verifySoundscaperProfessionalNativePayload({
		repositoryRoot,
		target: packagedTarget,
		targetSource: stage.soundscaperProfessionalNative.targetSource === 'build-host' ? 'build-host' : 'declared',
	});
	return verifyStagedSoundscaperProfessionalNativePayload({
		release,
		outputRoot: professionalNativePayloadOutputRoot(resolve(repositoryRoot, '.desktop-build/runtime'), release),
		stageManifestPath,
	});
}

export async function verifyStagedAssistanceNativeRuntime({
	repositoryRoot,
	stageManifestPath,
	packagedTarget,
}) {
	const stage = JSON.parse(await readFile(stageManifestPath, 'utf8'));
	const expected = assistanceNativeRuntimeStageSummary(
		assistanceNativeRuntimeManifest,
		packagedTarget,
	);
	if (JSON.stringify(stage.assistanceNativeRuntime) !== JSON.stringify(expected)) {
		throw new Error('The desktop stage manifest has invalid assistance native-runtime evidence.');
	}
	return verifyAssistanceNativeRuntimePayload({
		manifest: assistanceNativeRuntimeManifest,
		targetId: packagedTarget,
		outputRoot: resolve(repositoryRoot, '.desktop-build/runtime'),
	});
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

export async function verifyStagedFramescaperNativeHostsBeforePack({
	repositoryRoot,
	stageManifestPath,
	packagedTarget,
}) {
	const stage = JSON.parse(await readFile(stageManifestPath, 'utf8'));
	if (stage?.productId === 'soundscaper') {
		if (stage.framescaperNativeHosts !== null) {
			throw new Error('A Soundscaper desktop stage cannot carry Framescaper native-host payloads.');
		}
		return null;
	}
	if (stage?.productId !== 'framescaper') {
		throw new Error('The desktop stage manifest has no supported product identity.');
	}
	const staged = stage.framescaperNativeHosts;
	if (!staged || typeof staged.target !== 'string') {
		throw new Error('The Framescaper desktop stage does not record native-host payloads.');
	}
	if (staged.target !== packagedTarget) {
		throw new Error(`The staged Framescaper native hosts target ${staged.target} but electron-builder is packing ${packagedTarget}.`);
	}
	const release = await verifyFramescaperNativeHostPayloads({
		repositoryRoot,
		target: staged.target,
		targetSource: staged.targetSource === 'build-host' ? 'build-host' : 'declared',
	});
	return verifyStagedFramescaperNativeHostPayloads({
		release,
		outputRoot: resolve(repositoryRoot, '.desktop-build/runtime'),
		stageManifestPath,
		applicationRoot: resolve(repositoryRoot, '.desktop-build/app'),
	});
}
