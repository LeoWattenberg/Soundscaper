/* SPDX-License-Identifier: AGPL-3.0-only */
import { FRAMESCAPER_MASK_RASTER_ASSET_KIND_V1, validateFramescaperMaskRasterArchiveBodyV1, validateFramescaperMaskRasterArchiveAssetsV1 } from './timeline-image-mask-raster-assets-v1.ts';
import type { ScapeProjectAssetExtension } from '../common/editor/scape-project-asset-extension.ts';
import { createFramescaperScapeProjectAssetExtensionTimelineImage, type FramescaperScapeImageProjectCodecTimelineImage } from './editor-scape-assets-timeline-image.ts';
import { planTimelineImageCurrentArchiveAssets, validateTimelineImageCurrentArchiveAssets, validateFramescaperRawImageAssetBodyCurrentV1 } from './editor-scape-asset-plan-timeline-image-current.ts';
import { stageTimelineImageCurrentArchiveAssets } from './editor-scape-asset-import-timeline-image-current.ts';
import { validateFramescaperNativeImageBodyCurrentV1 } from '../common/editor/timeline-image-native-body-current-v1.ts';

/** A single current image-kind owner dispatches V1 unchanged and closes V2
 * recipes/resources without changing legacy frame-pack bytes or handlers. */
export function createFramescaperScapeProjectAssetExtensionTimelineImageCurrent(profile: unknown,
	codec: FramescaperScapeImageProjectCodecTimelineImage): Readonly<ScapeProjectAssetExtension> {
	const legacy = createFramescaperScapeProjectAssetExtensionTimelineImage(profile, codec);
	const current = (project: ReturnType<typeof codec.clone>) => project.sources.some(source => source.kind === 'image' && source.schemaVersion !== 1);
	return Object.freeze({ ...legacy,
		assetKinds: Object.freeze([...legacy.assetKinds, FRAMESCAPER_MASK_RASTER_ASSET_KIND_V1]),
		validateExportAssetBody: async (asset: Parameters<ScapeProjectAssetExtension['validateExportAssetBody']>[0], body: Blob, signal?: AbortSignal) => {
			if (asset.kind === FRAMESCAPER_MASK_RASTER_ASSET_KIND_V1) return validateFramescaperMaskRasterArchiveBodyV1(asset, body, signal);
			const raw = Object.getOwnPropertyDescriptor(asset.source, 'rawImageSource');
			if (raw && !Object.hasOwn(raw, 'value')) throw new TypeError('Frame RAW planned source must be an own data declaration.');
			if (raw) await validateFramescaperRawImageAssetBodyCurrentV1(raw.value, body, signal);
			const native = Object.getOwnPropertyDescriptor(asset.source, 'nativeImageSource');
			if (native && !Object.hasOwn(native, 'value')) throw new TypeError('Frame native planned source must be own data.');
			if (native) await validateFramescaperNativeImageBodyCurrentV1(native.value, body, signal);
			await legacy.validateExportAssetBody(asset, body, signal);
		},
		async planExportAssets(request: Parameters<ScapeProjectAssetExtension['planExportAssets']>[0]) {
			const project = codec.clone(profile, request.project);
			return current(project) ? planTimelineImageCurrentArchiveAssets(project, request.store, request.signal, request)
				: legacy.planExportAssets(request);
		},
		validateImportAssets(projectValue: Parameters<ScapeProjectAssetExtension['validateImportAssets']>[0], manifest: Parameters<ScapeProjectAssetExtension['validateImportAssets']>[1]) {
			const project = codec.clone(profile, projectValue);
			validateFramescaperMaskRasterArchiveAssetsV1(project, manifest);
			return current(project) ? validateTimelineImageCurrentArchiveAssets(project, manifest) : legacy.validateImportAssets(projectValue, manifest);
		},
		stageImportAssets(request: Parameters<ScapeProjectAssetExtension['stageImportAssets']>[0]) {
			const project = codec.clone(profile, request.archiveProject);
			return current(project) ? stageTimelineImageCurrentArchiveAssets(request) : legacy.stageImportAssets(request);
		},
	});
}
