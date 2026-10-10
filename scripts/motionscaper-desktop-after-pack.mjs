/* SPDX-License-Identifier: AGPL-3.0-only */
import { join, resolve } from 'node:path';
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses';
import { nativeAddonPayloadTargetForPackagingContext } from './lib/native-addon-payload-manifest.mjs';
import { verifyPackagedElectronAlternateFfmpeg } from './lib/electron-alternate-ffmpeg.mjs';
import { verifyMotionscaperDesktopStage, verifyMotionscaperPackagedResources } from './lib/motionscaper-desktop-package.mjs';

export default async function hardenMotionscaperAfterPack(context) {
	const stage = await verifyMotionscaperDesktopStage(
		resolve(context.packager.projectDir, '.desktop-build'), nativeAddonPayloadTargetForPackagingContext(context),
	);
	await verifyMotionscaperPackagedResources(context.packager.getResourcesDir(context.appOutDir), stage);
	await verifyPackagedElectronAlternateFfmpeg(context);
	const extensions = { darwin: '.app', win32: '.exe', linux: '' };
	const extension = extensions[context.electronPlatformName];
	if (extension === undefined) throw new Error('Unsupported Motionscaper package platform.');
	const name = context.electronPlatformName === 'linux' ? context.packager.executableName : context.packager.appInfo.productFilename;
	await flipFuses(join(context.appOutDir, `${name}${extension}`), {
		version: FuseVersion.V1, strictlyRequireAllFuses: true,
		[FuseV1Options.RunAsNode]: false, [FuseV1Options.EnableCookieEncryption]: true,
		[FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
		[FuseV1Options.EnableNodeCliInspectArguments]: false,
		[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
		[FuseV1Options.OnlyLoadAppFromAsar]: true,
		[FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
		[FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
		[FuseV1Options.WasmTrapHandlers]: true,
	});
}
