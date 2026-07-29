#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { flipFuses as flipElectronFuses, FuseVersion, FuseV1Options } from '@electron/fuses';

import {
	verifyFfmpegRuntimeManifest,
	verifyStagedFfmpegRuntime,
} from './lib/ffmpeg-runtime-manifest.mjs';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Electron Builder afterPack hook. Fuses are flipped before macOS ad-hoc or
 * production signing, so no signature reset is needed here.
 */
export default async function hardenPackagedElectron(context, dependencies = {}) {
	await verifyPackagedFfmpegResources(context, dependencies);
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
}

export async function verifyPackagedFfmpegResources(context, dependencies = {}) {
	const repositoryRoot = resolve(dependencies.repositoryRoot ?? REPOSITORY_ROOT);
	const release = await verifyFfmpegRuntimeManifest({ repositoryRoot, purpose: 'desktop-assembly' });
	const resourcesRoot = context?.packager?.getResourcesDir?.(context.appOutDir);
	if (typeof resourcesRoot !== 'string' || resourcesRoot.length === 0) {
		throw new TypeError('Electron packaged resources directory is unavailable.');
	}
	try {
		return await verifyStagedFfmpegRuntime({
			release,
			outputRoot: resolve(resourcesRoot, `runtime/ffmpeg/${release.manifest.package.version}`),
			noticePath: resolve(resourcesRoot, 'licenses/THIRD_PARTY_LICENSES.md'),
		});
	} catch (error) {
		throw packagedResourceError(error);
	}
}

function packagedResourceError(error) {
	if (!(error instanceof Error)) return error;
	const message = error.message
		.replace(/^Staged/u, 'Packaged')
		.replace(/^staged/u, 'packaged');
	return new Error(message, { cause: error });
}
