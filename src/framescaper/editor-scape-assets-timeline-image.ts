/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeProjectAssetExtension } from '../common/editor/scape-project-asset-extension.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from './editor-project-native-media-foundation.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { framescaperProjectNativeMediaFoundationShapeTimelineImage } from './editor-project-timeline-image-foundation.ts';
import { assertFramescaperProjectTimelineImageProfile } from './editor-domain-runtime-profile.ts';
import { cloneFramescaperProjectTimelineImage, validateFramescaperProjectTimelineImage } from './editor-project-timeline-image.ts';
import {
	stageFramescaperScapeImportAssetsTimelineImage,
	type FramescaperScapeImportValidationTimelineImage,
} from './editor-scape-asset-import-timeline-image.ts';
import {
	FRAMESCAPER_SCAPE_IMAGE_ASSET_KIND_TIMELINE_IMAGE,
	planFramescaperScapeImageExportAssetsTimelineImage,
	validateFramescaperScapeImageExportAssetBodyTimelineImage,
	validateFramescaperScapeImageImportAssetsTimelineImage,
} from './editor-scape-asset-plan-timeline-image.ts';
import type { FramescaperScapeImportValidationFinishing } from './editor-scape-asset-plan-finishing.ts';
import { createFramescaperScapeProjectAssetExtensionFinishing } from './editor-scape-assets-finishing.ts';

const SOURCE_KINDS = Object.freeze(['still', 'generator', 'image']);

export interface FramescaperScapeImageProjectCodecTimelineImage {
	readonly authenticate: (profile: unknown) => void;
	readonly clone: (profile: unknown, project: unknown) => ReturnType<typeof cloneFramescaperProjectTimelineImage>;
	readonly validate: (profile: unknown, project: unknown) => boolean;
}

const BASELINE_PROJECT_CODEC: FramescaperScapeImageProjectCodecTimelineImage = Object.freeze({
	authenticate: assertFramescaperProjectTimelineImageProfile,
	clone: cloneFramescaperProjectTimelineImage,
	validate: validateFramescaperProjectTimelineImage,
});

/** timelineImage Scape ownership: immutable finishing assets plus one semantic body per image source. */
export function createFramescaperScapeProjectAssetExtensionTimelineImage(
	profile: unknown,
	codec: FramescaperScapeImageProjectCodecTimelineImage = BASELINE_PROJECT_CODEC,
): Readonly<ScapeProjectAssetExtension> {
	assertCodec(codec);
	codec.authenticate(profile);
	const foundation = createFramescaperScapeProjectAssetExtensionFinishing(
		FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE,
	);
	const extension: ScapeProjectAssetExtension = {
		assetKinds: Object.freeze([...foundation.assetKinds, FRAMESCAPER_SCAPE_IMAGE_ASSET_KIND_TIMELINE_IMAGE]),
		sourceKinds: SOURCE_KINDS,
		async planExportAssets({ project, store, signal }) {
			const selected = codec.clone(profile, project);
			const foundationProject = framescaperProjectFinishingFoundationShapeNativeMedia(
				framescaperProjectNativeMediaFoundationShapeTimelineImage(selected),
			);
			const [foundationAssets, imageAssets] = await Promise.all([
				foundation.planExportAssets({ project: foundationProject, store, signal }),
				planFramescaperScapeImageExportAssetsTimelineImage(selected, store, signal),
			]);
			return Object.freeze([...foundationAssets, ...imageAssets]);
		},
		validateExportAssetBody: (asset, body, signal) => (
			asset.kind === FRAMESCAPER_SCAPE_IMAGE_ASSET_KIND_TIMELINE_IMAGE
				? validateFramescaperScapeImageExportAssetBodyTimelineImage(asset, body, signal)
				: foundation.validateExportAssetBody(asset, body, signal)
		),
		validateImportAssets(projectValue, manifest) {
			const project = codec.clone(profile, projectValue);
			const foundationProject = framescaperProjectFinishingFoundationShapeNativeMedia(
				framescaperProjectNativeMediaFoundationShapeTimelineImage(project),
			);
			return Object.freeze({
				foundation: foundation.validateImportAssets(
					foundationProject, manifest,
				) as Readonly<FramescaperScapeImportValidationFinishing>,
				images: validateFramescaperScapeImageImportAssetsTimelineImage(project, manifest),
			} satisfies FramescaperScapeImportValidationTimelineImage);
		},
		stageImportAssets: stageFramescaperScapeImportAssetsTimelineImage,
		validateReboundProject: (project) => { codec.validate(profile, project); },
		sourceStorageRole(source) {
			if (source.kind === 'image') return 'media';
			return foundation.sourceStorageRole(source);
		},
	};
	return Object.freeze(extension);
}

function assertCodec(value: unknown): asserts value is FramescaperScapeImageProjectCodecTimelineImage {
	if (!value || typeof value !== 'object') throw new TypeError('A Scape image project codec is required.');
	for (const method of ['authenticate', 'clone', 'validate'] as const) {
		if (typeof (value as Readonly<Record<string, unknown>>)[method] !== 'function') {
			throw new TypeError(`The Scape image project codec requires ${method}.`);
		}
	}
}
