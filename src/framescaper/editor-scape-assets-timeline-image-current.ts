/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ScapeProjectAssetExtension } from '../common/editor/scape-project-asset-extension.ts';
import { createFramescaperScapeProjectAssetExtensionTimelineImage, type FramescaperScapeImageProjectCodecTimelineImage } from './editor-scape-assets-timeline-image.ts';
import { planTimelineImageCurrentArchiveAssets, validateTimelineImageCurrentArchiveAssets } from './editor-scape-asset-plan-timeline-image-current.ts';
import { stageTimelineImageCurrentArchiveAssets } from './editor-scape-asset-import-timeline-image-current.ts';

/** A single current image-kind owner dispatches V1 unchanged and closes V2
 * recipes/resources without changing legacy frame-pack bytes or handlers. */
export function createFramescaperScapeProjectAssetExtensionTimelineImageCurrent(profile: unknown,
	codec: FramescaperScapeImageProjectCodecTimelineImage): Readonly<ScapeProjectAssetExtension> {
	const legacy = createFramescaperScapeProjectAssetExtensionTimelineImage(profile, codec);
	const current = (project: ReturnType<typeof codec.clone>) => project.sources.some(source => source.kind === 'image' && source.schemaVersion === 2);
	return Object.freeze({ ...legacy,
		async planExportAssets(request: Parameters<ScapeProjectAssetExtension['planExportAssets']>[0]) {
			const project = codec.clone(profile, request.project);
			return current(project) ? planTimelineImageCurrentArchiveAssets(project, request.store, request.signal, request)
				: legacy.planExportAssets(request);
		},
		validateImportAssets(projectValue: Parameters<ScapeProjectAssetExtension['validateImportAssets']>[0], manifest: Parameters<ScapeProjectAssetExtension['validateImportAssets']>[1]) {
			const project = codec.clone(profile, projectValue);
			return current(project) ? validateTimelineImageCurrentArchiveAssets(project, manifest) : legacy.validateImportAssets(projectValue, manifest);
		},
		stageImportAssets(request: Parameters<ScapeProjectAssetExtension['stageImportAssets']>[0]) {
			const project = codec.clone(profile, request.archiveProject);
			return current(project) ? stageTimelineImageCurrentArchiveAssets(request) : legacy.stageImportAssets(request);
		},
	});
}
