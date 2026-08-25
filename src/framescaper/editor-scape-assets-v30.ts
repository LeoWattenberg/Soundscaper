/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeProjectAssetExtension } from '../common/editor/scape-project-asset-extension.ts';
import { framescaperProjectV27FoundationShapeV28 } from './editor-project-v28-foundation.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v27.ts';
import { framescaperProjectV28FoundationShapeV30 } from './editor-project-v30-foundation.ts';
import { assertFramescaperProjectV30Profile } from './editor-project-runtime-profile-v30.ts';
import { cloneFramescaperProjectV30, validateFramescaperProjectV30 } from './editor-project-v30.ts';
import {
	stageFramescaperScapeImportAssetsV30,
	type FramescaperScapeImportValidationV30,
} from './editor-scape-asset-import-v30.ts';
import {
	FRAMESCAPER_SCAPE_IMAGE_ASSET_KIND_V30,
	planFramescaperScapeImageExportAssetsV30,
	validateFramescaperScapeImageExportAssetBodyV30,
	validateFramescaperScapeImageImportAssetsV30,
} from './editor-scape-asset-plan-v30.ts';
import type { FramescaperScapeImportValidationV27 } from './editor-scape-asset-plan-v27.ts';
import { createFramescaperScapeProjectAssetExtensionV27 } from './editor-scape-assets-v27.ts';

const SOURCE_KINDS = Object.freeze(['still', 'generator', 'image']);

/** V30 `.scape` ownership: immutable V27 assets plus one semantic body per image source. */
export function createFramescaperScapeProjectAssetExtensionV30(
	profile: unknown,
): Readonly<ScapeProjectAssetExtension> {
	assertFramescaperProjectV30Profile(profile);
	const foundation = createFramescaperScapeProjectAssetExtensionV27(
		FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
	);
	const extension: ScapeProjectAssetExtension = {
		assetKinds: Object.freeze([...foundation.assetKinds, FRAMESCAPER_SCAPE_IMAGE_ASSET_KIND_V30]),
		sourceKinds: SOURCE_KINDS,
		async planExportAssets({ project, store, signal }) {
			const selected = cloneFramescaperProjectV30(profile, project);
			const v27Project = framescaperProjectV27FoundationShapeV28(
				framescaperProjectV28FoundationShapeV30(selected),
			);
			const [foundationAssets, imageAssets] = await Promise.all([
				foundation.planExportAssets({ project: v27Project, store, signal }),
				planFramescaperScapeImageExportAssetsV30(selected, store, signal),
			]);
			return Object.freeze([...foundationAssets, ...imageAssets]);
		},
		validateExportAssetBody: (asset, body, signal) => (
			asset.kind === FRAMESCAPER_SCAPE_IMAGE_ASSET_KIND_V30
				? validateFramescaperScapeImageExportAssetBodyV30(asset, body, signal)
				: foundation.validateExportAssetBody(asset, body, signal)
		),
		validateImportAssets(projectValue, manifest) {
			const project = cloneFramescaperProjectV30(profile, projectValue);
			const v27Project = framescaperProjectV27FoundationShapeV28(
				framescaperProjectV28FoundationShapeV30(project),
			);
			return Object.freeze({
				foundation: foundation.validateImportAssets(
					v27Project, manifest,
				) as Readonly<FramescaperScapeImportValidationV27>,
				images: validateFramescaperScapeImageImportAssetsV30(project, manifest),
			} satisfies FramescaperScapeImportValidationV30);
		},
		stageImportAssets: stageFramescaperScapeImportAssetsV30,
		validateReboundProject: (project) => { validateFramescaperProjectV30(profile, project); },
		sourceStorageRole(source) {
			if (source.kind === 'image') return 'media';
			return foundation.sourceStorageRole(source);
		},
	};
	return Object.freeze(extension);
}
