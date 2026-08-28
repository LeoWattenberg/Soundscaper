/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAssistanceTranscriptScapeProjectAssetExtensionV1 } from
	'../common/editor/assistance/transcript-scape-asset-extension-v1.ts';
import { composeScapeProjectAssetExtensions } from
	'../common/editor/scape-project-asset-extension-composition.ts';
import type { ScapeProjectAssetExtension } from '../common/editor/scape-project-asset-extension.ts';
import { createSoundscaperNativePluginStateScapeExtension } from
	'./editor-native-plugin-state-scape.ts';

export function createSoundscaperScapeProjectAssetExtension(): Readonly<ScapeProjectAssetExtension> {
	return composeScapeProjectAssetExtensions([
		createSoundscaperNativePluginStateScapeExtension(),
		createAssistanceTranscriptScapeProjectAssetExtensionV1(),
	]);
}
