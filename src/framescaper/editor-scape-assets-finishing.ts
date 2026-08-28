/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeProjectAssetExtension } from '../common/editor/scape-project-asset-extension.ts';
import { stageFramescaperScapeImportAssetsFinishing } from './editor-scape-asset-import-finishing.ts';
import {
	FRAMESCAPER_SCAPE_ASSET_KINDS_FINISHING,
	planFramescaperScapeExportAssetsFinishing,
	validateFramescaperScapeExportAssetBodyFinishing,
	validateFramescaperScapeImportAssetsFinishing,
} from './editor-scape-asset-plan-finishing.ts';
import { assertFramescaperProjectFinishingProfile } from './editor-domain-runtime-profile.ts';
import {
	cloneFramescaperProjectFinishing,
	validateFramescaperProjectFinishing,
} from './editor-project-finishing.ts';

const SOURCE_KINDS = Object.freeze(['still', 'generator']);

/** Selected finishing-only durable asset ownership for portable Scape archives. */
export function createFramescaperScapeProjectAssetExtensionFinishing(
	profile: unknown,
): Readonly<ScapeProjectAssetExtension> {
	assertFramescaperProjectFinishingProfile(profile);
	const extension: ScapeProjectAssetExtension = {
		assetKinds: FRAMESCAPER_SCAPE_ASSET_KINDS_FINISHING,
		sourceKinds: SOURCE_KINDS,
		planExportAssets: ({ project, store, signal }) => planFramescaperScapeExportAssetsFinishing(
			cloneFramescaperProjectFinishing(profile, project), store, signal,
		),
		validateExportAssetBody: validateFramescaperScapeExportAssetBodyFinishing,
		validateImportAssets: (project, manifest) => validateFramescaperScapeImportAssetsFinishing(
			cloneFramescaperProjectFinishing(profile, project), manifest,
		),
		stageImportAssets: stageFramescaperScapeImportAssetsFinishing,
		validateReboundProject: (project) => { validateFramescaperProjectFinishing(profile, project); },
		sourceStorageRole: (source) => {
			if (source.kind === 'still') return 'media';
			if (source.kind === 'generator') return 'none';
			throw new TypeError(`finishing Scape source kind ${String(source.kind)} is unsupported.`);
		},
	};
	return Object.freeze(extension);
}
