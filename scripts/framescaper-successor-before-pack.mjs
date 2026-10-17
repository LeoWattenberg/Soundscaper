/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolve } from 'node:path';
import { nativeAddonPayloadTargetForPackagingContext } from './lib/native-addon-payload-manifest.mjs';
import { verifyFramescaperSuccessorDesktopStage } from './lib/framescaper-successor-desktop-package.ts';
export default async function verifySuccessorBeforePack(context) {
	return verifyFramescaperSuccessorDesktopStage(resolve(context.packager.projectDir, '.desktop-build/framescaper-successor'), nativeAddonPayloadTargetForPackagingContext(context));
}
