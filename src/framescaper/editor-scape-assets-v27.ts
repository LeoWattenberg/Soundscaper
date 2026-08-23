/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeProjectAssetExtension } from '../common/editor/scape-project-asset-extension.ts';
import { stageFramescaperScapeImportAssetsV27 } from './editor-scape-asset-import-v27.ts';
import {
	FRAMESCAPER_SCAPE_ASSET_KINDS_V27,
	planFramescaperScapeExportAssetsV27,
	validateFramescaperScapeExportAssetBodyV27,
	validateFramescaperScapeImportAssetsV27,
} from './editor-scape-asset-plan-v27.ts';
import { assertFramescaperProjectV27Profile } from './editor-project-runtime-profile-v27.ts';
import {
	cloneFramescaperProjectV27,
	validateFramescaperProjectV27,
} from './editor-project-v27.ts';

const SOURCE_KINDS = Object.freeze(['still', 'generator']);

/** Selected V27-only durable asset ownership for portable `.scape` archives. */
export function createFramescaperScapeProjectAssetExtensionV27(
	profile: unknown,
): Readonly<ScapeProjectAssetExtension> {
	assertFramescaperProjectV27Profile(profile);
	const extension: ScapeProjectAssetExtension = {
		assetKinds: FRAMESCAPER_SCAPE_ASSET_KINDS_V27,
		sourceKinds: SOURCE_KINDS,
		planExportAssets: ({ project, store, signal }) => planFramescaperScapeExportAssetsV27(
			cloneFramescaperProjectV27(profile, project), store, signal,
		),
		validateExportAssetBody: validateFramescaperScapeExportAssetBodyV27,
		validateImportAssets: (project, manifest) => validateFramescaperScapeImportAssetsV27(
			cloneFramescaperProjectV27(profile, project), manifest,
		),
		stageImportAssets: stageFramescaperScapeImportAssetsV27,
		validateReboundProject: (project) => { validateFramescaperProjectV27(profile, project); },
		sourceStorageRole: (source) => {
			if (source.kind === 'still') return 'media';
			if (source.kind === 'generator') return 'none';
			throw new TypeError(`V27 Scape source kind ${String(source.kind)} is unsupported.`);
		},
	};
	return Object.freeze(extension);
}
