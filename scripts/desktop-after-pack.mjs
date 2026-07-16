#!/usr/bin/env node

import { join } from 'node:path';

import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses';

/**
 * Electron Builder afterPack hook. Fuses are flipped before macOS ad-hoc or
 * production signing, so no signature reset is needed here.
 */
export default async function hardenPackagedElectron(context) {
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
