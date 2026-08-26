/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeManifest } from '../common/editor/scape-archive-envelope.ts';
import type {
	ScapeProjectAssetExtension,
	ScapeProjectAssetExtensionExportRequest,
	ScapeProjectAssetExtensionImportRequest,
} from '../common/editor/scape-project-asset-extension.ts';
import {
	SOUNDSCAPER_SCAPE_NATIVE_PLUGIN_STATE_ENCODING_V29,
	SOUNDSCAPER_SCAPE_NATIVE_PLUGIN_STATE_KIND_V29,
	SOUNDSCAPER_SCAPE_NATIVE_PLUGIN_STATE_MIME_V29,
	adaptSoundscaperScapeNativePluginStateStoreV29,
	createSoundscaperNativePluginStateScapeExtensionV29,
	type SoundscaperScapeNativePluginStateStoreV29,
} from './editor-native-plugin-state-scape-v29.ts';
import {
	borrowSoundscaperProjectV29FromV30,
} from './editor-project-v30-foundation.ts';
import { validateSoundscaperProjectV30 } from './editor-project-v30-validation.ts';

export const SOUNDSCAPER_SCAPE_NATIVE_PLUGIN_STATE_KIND_V30 =
	SOUNDSCAPER_SCAPE_NATIVE_PLUGIN_STATE_KIND_V29;
export const SOUNDSCAPER_SCAPE_NATIVE_PLUGIN_STATE_ENCODING_V30 =
	SOUNDSCAPER_SCAPE_NATIVE_PLUGIN_STATE_ENCODING_V29;
export const SOUNDSCAPER_SCAPE_NATIVE_PLUGIN_STATE_MIME_V30 =
	SOUNDSCAPER_SCAPE_NATIVE_PLUGIN_STATE_MIME_V29;

export type SoundscaperScapeNativePluginStateStoreV30 =
	SoundscaperScapeNativePluginStateStoreV29;

/** Reuse the unchanged native body wire behind exact V30 document admission. */
export function createSoundscaperNativePluginStateScapeExtensionV30():
	Readonly<ScapeProjectAssetExtension> {
	const delegate = createSoundscaperNativePluginStateScapeExtensionV29();
	return Object.freeze({
		assetKinds: delegate.assetKinds,
		sourceKinds: delegate.sourceKinds,
		planExportAssets: (request: ScapeProjectAssetExtensionExportRequest) => {
			const borrowed = borrowSoundscaperProjectV29FromV30(request.project);
			return delegate.planExportAssets!({ ...request, project: borrowed.project });
		},
		validateExportAssetBody: delegate.validateExportAssetBody,
		validateImportAssets: (project: unknown, manifest: ScapeManifest) => {
			const borrowed = borrowSoundscaperProjectV29FromV30(project);
			return delegate.validateImportAssets!(borrowed.project, manifest);
		},
		stageImportAssets: (request: ScapeProjectAssetExtensionImportRequest) => {
			const borrowed = borrowSoundscaperProjectV29FromV30(request.project);
			return delegate.stageImportAssets!({ ...request, project: borrowed.project });
		},
		validateReboundProject: (project: unknown) => { validateSoundscaperProjectV30(project); },
		sourceStorageRole: delegate.sourceStorageRole,
	});
}

/** Native body reads remain on the unchanged content-addressed store transport. */
export function adaptSoundscaperScapeNativePluginStateStoreV30<Store extends object>(
	store: Store & SoundscaperScapeNativePluginStateStoreV30,
): Store {
	return adaptSoundscaperScapeNativePluginStateStoreV29(store);
}
