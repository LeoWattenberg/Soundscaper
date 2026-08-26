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

export interface FramescaperScapeImageProjectCodecV30 {
	readonly authenticate: (profile: unknown) => void;
	readonly clone: (profile: unknown, project: unknown) => ReturnType<typeof cloneFramescaperProjectV30>;
	readonly validate: (profile: unknown, project: unknown) => boolean;
}

const V30_PROJECT_CODEC: FramescaperScapeImageProjectCodecV30 = Object.freeze({
	authenticate: assertFramescaperProjectV30Profile,
	clone: cloneFramescaperProjectV30,
	validate: validateFramescaperProjectV30,
});

/** V30 `.scape` ownership: immutable V27 assets plus one semantic body per image source. */
export function createFramescaperScapeProjectAssetExtensionV30(
	profile: unknown,
	codec: FramescaperScapeImageProjectCodecV30 = V30_PROJECT_CODEC,
): Readonly<ScapeProjectAssetExtension> {
	assertCodec(codec);
	codec.authenticate(profile);
	const foundation = createFramescaperScapeProjectAssetExtensionV27(
		FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
	);
	const extension: ScapeProjectAssetExtension = {
		assetKinds: Object.freeze([...foundation.assetKinds, FRAMESCAPER_SCAPE_IMAGE_ASSET_KIND_V30]),
		sourceKinds: SOURCE_KINDS,
		async planExportAssets({ project, store, signal }) {
			const selected = codec.clone(profile, project);
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
			const project = codec.clone(profile, projectValue);
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
		validateReboundProject: (project) => { codec.validate(profile, project); },
		sourceStorageRole(source) {
			if (source.kind === 'image') return 'media';
			return foundation.sourceStorageRole(source);
		},
	};
	return Object.freeze(extension);
}

function assertCodec(value: unknown): asserts value is FramescaperScapeImageProjectCodecV30 {
	if (!value || typeof value !== 'object') throw new TypeError('A Scape image project codec is required.');
	for (const method of ['authenticate', 'clone', 'validate'] as const) {
		if (typeof (value as Readonly<Record<string, unknown>>)[method] !== 'function') {
			throw new TypeError(`The Scape image project codec requires ${method}.`);
		}
	}
}
