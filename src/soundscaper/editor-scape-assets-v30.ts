/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAssistanceTranscriptScapeProjectAssetExtensionV1,
} from '../common/editor/assistance/transcript-scape-asset-extension-v1.ts'
import {
	composeScapeProjectAssetExtensions,
} from '../common/editor/scape-project-asset-extension-composition.ts'
import type { ScapeProjectAssetExtension } from '../common/editor/scape-project-asset-extension.ts'
import {
	createSoundscaperNativePluginStateScapeExtensionV30,
} from './editor-native-plugin-state-scape-v30.ts'

/** Preserve the V29 native-state wire while adding V30's assistance body owner. */
export function createSoundscaperScapeProjectAssetExtensionV30():
	Readonly<ScapeProjectAssetExtension> {
	return composeScapeProjectAssetExtensions([
		createSoundscaperNativePluginStateScapeExtensionV30(),
		createAssistanceTranscriptScapeProjectAssetExtensionV1(),
	])
}
