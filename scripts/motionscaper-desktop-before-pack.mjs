/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolve } from 'node:path';
import { nativeAddonPayloadTargetForPackagingContext } from './lib/native-addon-payload-manifest.mjs';
import { verifyMotionscaperDesktopStage } from './lib/motionscaper-desktop-package.mjs';

export default async function verifyMotionscaperBeforePack(context) {
	return verifyMotionscaperDesktopStage(
		resolve(context.packager.projectDir, '.desktop-build'),
		nativeAddonPayloadTargetForPackagingContext(context),
	);
}
