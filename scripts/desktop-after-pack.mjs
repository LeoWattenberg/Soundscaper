#!/usr/bin/env node

import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { flipFuses as flipElectronFuses, FuseVersion, FuseV1Options } from '@electron/fuses';

import assistanceNativeRuntimeManifest from '../config/assistance-native-runtime-manifest.json' with { type: 'json' };
import { verifyAssistanceNativeRuntimePayload } from '../desktop/assistance-native-runtime-payload.mjs';
import {
	assertDesktopCodecPolicy,
	auditDesktopFfmpegAbsence,
} from './lib/desktop-codec-policy.mjs';
import { verifyPackagedElectronAlternateFfmpeg } from './lib/electron-alternate-ffmpeg.mjs';
import {
	NATIVE_ADDON_RUNTIME_PREFIX,
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
	PROFESSIONAL_NATIVE_RUNTIME_PREFIX,
	professionalNativePayloadOutputRoot,
	verifySoundscaperProfessionalNativePayload,
	verifyStagedSoundscaperProfessionalNativePayload,
} from './lib/soundscaper-professional-native-payload.mjs';
import { writeDesktopPackageContentManifest } from './lib/desktop-package-content-manifest.mjs';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FRAMESCAPER_NATIVE_HOST_PREFIXES = Object.freeze([
	'framescaper-media-host',
	'framescaper-openfx-host',
]);
const SOUNDSCAPER_PROFESSIONAL_PREFIX = PROFESSIONAL_NATIVE_RUNTIME_PREFIX.split('/').at(-1);

/**
 * Electron Builder afterPack hook. Fuses are flipped before macOS ad-hoc or
 * production signing, so no signature reset is needed here.
 */
export default async function hardenPackagedElectron(context, dependencies = {}) {
	const auditCodecPolicy = dependencies.auditPackagedDesktopCodecPolicy
		?? auditPackagedDesktopCodecPolicy;
	const verifyAssistance = dependencies.verifyPackagedAssistanceNativeRuntime
		?? verifyPackagedAssistanceNativeRuntime;
	const verifyNativeAddon = dependencies.verifyPackagedNativeAddonResources
		?? verifyPackagedNativeAddonResources;
	const verifyProfessional = dependencies.verifyPackagedSoundscaperProfessionalNativeResources
		?? verifyPackagedSoundscaperProfessionalNativeResources;
	const verifyNativeHosts = dependencies.verifyPackagedFramescaperNativeHostResources
		?? verifyPackagedFramescaperNativeHostResources;
	const verifyElectronFfmpeg = dependencies.verifyPackagedElectronAlternateFfmpeg
		?? verifyPackagedElectronAlternateFfmpeg;
	// The absence audit and native payload verifiers cover disjoint policy
	// concerns, so they run together before fuse or signing work begins.
	await Promise.all([
		auditCodecPolicy(context, dependencies),
		verifyElectronFfmpeg(context, dependencies),
		verifyAssistance(context, dependencies),
		verifyNativeAddon(context, dependencies),
		verifyProfessional(context, dependencies),
		verifyNativeHosts(context, dependencies),
	]);
	const extension = {
		darwin: '.app',
		mas: '.app',
		win32: '.exe',
		linux: '',
	}[context.electronPlatformName];
	if (extension === undefined) throw new Error(`Unsupported Electron fuse platform: ${context.electronPlatformName}`);
	const executableName = context.electronPlatformName === 'linux'
		? context.packager.executableName
		: context.packager.appInfo.productFilename;
	const electronPath = join(context.appOutDir, `${executableName}${extension}`);
	const flipFuses = dependencies.flipFuses ?? flipElectronFuses;
	if (typeof flipFuses !== 'function') throw new TypeError('Electron fuse implementation is unavailable.');
	await flipFuses(electronPath, {
		version: FuseVersion.V1,
		strictlyRequireAllFuses: true,
		[FuseV1Options.RunAsNode]: false,
		[FuseV1Options.EnableCookieEncryption]: true,
		[FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
		[FuseV1Options.EnableNodeCliInspectArguments]: false,
		[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
		[FuseV1Options.OnlyLoadAppFromAsar]: true,
		// Electron's stock distribution ships one shared V8 snapshot. Enabling
		// the browser-specific fuse without also supplying
		// browser_v8_context_snapshot.bin prevents packaged startup.
		[FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
		[FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
		[FuseV1Options.WasmTrapHandlers]: true,
	});
	const resourcesRoot = context.packager.getResourcesDir(context.appOutDir);
	const repositoryRoot = resolve(dependencies.repositoryRoot ?? REPOSITORY_ROOT);
	const writeContentManifest = dependencies.writeDesktopPackageContentManifest
		?? writeDesktopPackageContentManifest;
	await writeContentManifest({
		resourcesRoot: resolve(resourcesRoot),
		runtimeManifestPath: resolve(repositoryRoot, '.desktop-build/stage-manifest.json'),
		productId: packagingProductId(context),
		targetId: nativeAddonPayloadTargetForPackagingContext(context),
	});
}

export async function verifyPackagedAssistanceNativeRuntime(context, dependencies = {}) {
	const resourcesRoot = context?.packager?.getResourcesDir?.(context.appOutDir);
	if (typeof resourcesRoot !== 'string' || resourcesRoot.length === 0) {
		throw new TypeError('Electron packaged resources directory is unavailable.');
	}
	const targetId = nativeAddonPayloadTargetForPackagingContext(context);
	try {
		return await verifyAssistanceNativeRuntimePayload({
			manifest: dependencies.assistanceNativeRuntimeManifest ?? assistanceNativeRuntimeManifest,
			targetId,
			outputRoot: resolve(resourcesRoot, 'runtime'),
		});
	} catch (error) {
		throw packagedResourceError(error);
	}
}

export async function auditPackagedDesktopCodecPolicy(context, dependencies = {}) {
	const repositoryRoot = resolve(dependencies.repositoryRoot ?? REPOSITORY_ROOT);
	const stageManifestPath = resolve(dependencies.stageManifestPath
		?? resolve(repositoryRoot, '.desktop-build/stage-manifest.json'));
	const stage = JSON.parse(await readFile(stageManifestPath, 'utf8'));
	assertDesktopCodecPolicy(stage?.desktopCodecPolicy, 'The packaged desktop codec policy');
	const resourcesRoot = context?.packager?.getResourcesDir?.(context.appOutDir);
	if (typeof resourcesRoot !== 'string' || resourcesRoot.length === 0) {
		throw new TypeError('Electron packaged resources directory is unavailable.');
	}
	return auditDesktopFfmpegAbsence({
		root: resolve(resourcesRoot),
		label: 'Packaged desktop resources',
	});
}

/**
 * The packed native payload is verified before any fuse is flipped, against the
 * target the packaged tree names and against the target electron-builder says
 * it is producing, so neither a resource tree that lost or gained a byte nor a
 * consistent tree assembled for another architecture can reach a signed package.
 */
export async function verifyPackagedNativeAddonResources(context, dependencies = {}) {
	const repositoryRoot = resolve(dependencies.repositoryRoot ?? REPOSITORY_ROOT);
	const resourcesRoot = context?.packager?.getResourcesDir?.(context.appOutDir);
	if (typeof resourcesRoot !== 'string' || resourcesRoot.length === 0) {
		throw new TypeError('Electron packaged resources directory is unavailable.');
	}
	const packagedTarget = nativeAddonPayloadTargetForPackagingContext(context);
	// Exactly one target may be packaged: zero means the payload never shipped,
	// and more than one means the package carries another architecture's bytes.
	const runtimeRoot = resolve(resourcesRoot, 'runtime');
	const entries = await readdir(resolve(runtimeRoot, NATIVE_ADDON_RUNTIME_PREFIX), { withFileTypes: true }).catch(() => []);
	const framescaper = packagingProductId(context) === 'framescaper';
	const unexpectedHostPrefixes = entries.filter(({ name }) => (
		FRAMESCAPER_NATIVE_HOST_PREFIXES.includes(name) && !framescaper
	));
	if (unexpectedHostPrefixes.length > 0) {
		throw new Error(`Packaged Soundscaper resources carry Framescaper native-host payloads: ${unexpectedHostPrefixes.map(({ name }) => name).join(', ')}.`);
	}
	const targets = entries
		.filter((entry) => entry.isDirectory()
			&& !FRAMESCAPER_NATIVE_HOST_PREFIXES.includes(entry.name)
			&& entry.name !== SOUNDSCAPER_PROFESSIONAL_PREFIX)
		.map(({ name }) => name);
	if (targets.length !== 1) {
		throw new Error(`Packaged native addon payload must carry exactly one target; found ${targets.join(', ') || '<none>'}.`);
	}
	if (targets[0] !== packagedTarget) {
		throw new Error(`Packaged native addon payload carries ${targets[0]} but electron-builder is packing ${packagedTarget}.`);
	}
	const release = await verifyNativeAddonPayloadManifest({ repositoryRoot, target: targets[0] });
	try {
		return await verifyStagedNativeAddonPayload({
			release,
			outputRoot: nativeAddonPayloadOutputRoot(runtimeRoot, release),
		});
	} catch (error) {
		throw packagedResourceError(error);
	}
}

export async function verifyPackagedSoundscaperProfessionalNativeResources(context, dependencies = {}) {
	const repositoryRoot = resolve(dependencies.repositoryRoot ?? REPOSITORY_ROOT);
	const resourcesRoot = context?.packager?.getResourcesDir?.(context.appOutDir);
	if (typeof resourcesRoot !== 'string' || resourcesRoot.length === 0) {
		throw new TypeError('Electron packaged resources directory is unavailable.');
	}
	const product = packagingProductId(context);
	const prefix = resolve(resourcesRoot, 'runtime', PROFESSIONAL_NATIVE_RUNTIME_PREFIX);
	if (product === 'framescaper') {
		const entries = await readdir(prefix).catch(() => []);
		if (entries.length !== 0) throw new Error('Packaged Framescaper resources carry the Soundscaper professional payload.');
		return null;
	}
	const target = nativeAddonPayloadTargetForPackagingContext(context);
	const release = await verifySoundscaperProfessionalNativePayload({ repositoryRoot, target });
	try {
		return await verifyStagedSoundscaperProfessionalNativePayload({
			release,
			outputRoot: professionalNativePayloadOutputRoot(resolve(resourcesRoot, 'runtime'), release),
		});
	} catch (error) {
		throw packagedResourceError(error);
	}
}

export async function verifyPackagedFramescaperNativeHostResources(context, dependencies = {}) {
	if (packagingProductId(context) === 'soundscaper') return null;
	const repositoryRoot = resolve(dependencies.repositoryRoot ?? REPOSITORY_ROOT);
	const resourcesRoot = context?.packager?.getResourcesDir?.(context.appOutDir);
	if (typeof resourcesRoot !== 'string' || resourcesRoot.length === 0) {
		throw new TypeError('Electron packaged resources directory is unavailable.');
	}
	const target = nativeAddonPayloadTargetForPackagingContext(context);
	const release = await verifyFramescaperNativeHostPayloads({ repositoryRoot, target });
	try {
		return await verifyStagedFramescaperNativeHostPayloads({
			release,
			outputRoot: resolve(resourcesRoot, 'runtime'),
		});
	} catch (error) {
		throw packagedResourceError(error);
	}
}

function packagingProductId(context) {
	const productName = context?.packager?.appInfo?.productFilename;
	if (productName === 'Framescaper' || productName === 'framescaper') return 'framescaper';
	if (productName === 'Soundscaper' || productName === 'soundscaper') return 'soundscaper';
	throw new Error(`Unsupported packaged desktop product: ${String(productName)}.`);
}

function packagedResourceError(error) {
	if (!(error instanceof Error)) return error;
	const message = error.message
		.replace(/^Staged/u, 'Packaged')
		.replace(/^staged/u, 'packaged');
	return new Error(message, { cause: error });
}
