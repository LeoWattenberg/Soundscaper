/* SPDX-License-Identifier: AGPL-3.0-only */

import { join } from 'node:path';

import { flipFuses as flipElectronFuses, FuseVersion, FuseV1Options } from '@electron/fuses';

/**
 * Harden the opt-in test launcher. RunAsNode is intentionally enabled only in
 * this diagnostic flavor because Playwright Test forks Node worker processes.
 */
export default async function hardenDesktopNightlyTests(context, dependencies = {}) {
	const extension = {
		darwin: '.app',
		mas: '.app',
		win32: '.exe',
		linux: '',
	}[context.electronPlatformName];
	if (extension === undefined) {
		throw new Error(`Unsupported Electron fuse platform: ${context.electronPlatformName}`);
	}
	const executableName = context.electronPlatformName === 'linux'
		? context.packager.executableName
		: context.packager.appInfo.productFilename;
	const electronPath = join(context.appOutDir, `${executableName}${extension}`);
	const flipFuses = dependencies.flipFuses ?? flipElectronFuses;
	if (typeof flipFuses !== 'function') throw new TypeError('Electron fuse implementation is unavailable.');
	await flipFuses(electronPath, {
		version: FuseVersion.V1,
		strictlyRequireAllFuses: true,
		[FuseV1Options.RunAsNode]: true,
		[FuseV1Options.EnableCookieEncryption]: true,
		[FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
		[FuseV1Options.EnableNodeCliInspectArguments]: false,
		[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
		[FuseV1Options.OnlyLoadAppFromAsar]: true,
		[FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
		[FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
		[FuseV1Options.WasmTrapHandlers]: true,
	});
}
