/* SPDX-License-Identifier: AGPL-3.0-only */
import { stageFramescaperMaskRasterArchiveAssetsV1 } from './timeline-image-mask-raster-assets-v1.ts';
import type { ScapeProjectAssetExtensionImportRequest } from '../common/editor/scape-project-asset-extension.ts';
import type { FramescaperProjectTimelineImage } from './editor-project-timeline-image.ts';
import { stageFramescaperScapeImportAssetsTimelineImage } from './editor-scape-asset-import-timeline-image.ts';
import { timelineImageArchivePackProjection, validateTimelineImageCurrentArchiveAssets } from './editor-scape-asset-plan-timeline-image-current.ts';
import { validateFramescaperNativeImageBodyCurrentV1 } from '../common/editor/timeline-image-native-body-current-v1.ts';

/** Validate the complete V2 resource closure before staging any body, then
 * delegate exact V1 pack authentication/writes under unchanged rebound IDs. */
export async function stageTimelineImageCurrentArchiveAssets(request: Readonly<ScapeProjectAssetExtensionImportRequest>): Promise<void> {
	const archiveProject = request.archiveProject as unknown as FramescaperProjectTimelineImage;
	const expected = validateTimelineImageCurrentArchiveAssets(archiveProject, request.manifest);
	const supplied = request.validation as typeof expected;
	if (JSON.stringify(supplied?.foundation?.references) !== JSON.stringify(expected.foundation.references)
		|| supplied.foundation.descriptorByArchiveId.size !== expected.foundation.descriptorByArchiveId.size
		|| [...expected.foundation.descriptorByArchiveId].some(([key, value]) => JSON.stringify(supplied.foundation.descriptorByArchiveId.get(key)) !== JSON.stringify(value))) {
		throw new Error('Current timeline image archive resource validation changed before staging.');
	}
	if (JSON.stringify(supplied?.masks?.references) !== JSON.stringify(expected.masks.references)
		|| supplied.masks.descriptors.size !== expected.masks.descriptors.size
		|| [...expected.masks.descriptors].some(([key, value]) => JSON.stringify(supplied.masks.descriptors.get(key)) !== JSON.stringify(value))) {
		throw new Error('Frame brush validation changed before native staging.');
	}
	await stageFramescaperMaskRasterArchiveAssetsV1(request, expected.masks);
	await stageFramescaperScapeImportAssetsTimelineImage({ ...request,
		archiveProject: timelineImageArchivePackProjection(archiveProject) as unknown as Record<string, unknown>,
		project: timelineImageArchivePackProjection(request.project as unknown as FramescaperProjectTimelineImage) as unknown as Record<string, unknown>,
		validation: { foundation: expected.foundation, images: supplied.images },
	});
	// Bodies remain provisional in the inherited import transaction. Native RAW
	// authentication must finish before that transaction can publish a project.
	const project = request.project as unknown as FramescaperProjectTimelineImage;
	for (const source of project.sources) if (source.kind === 'image' && (source.schemaVersion === 4 || source.schemaVersion === 5)) {
		if (typeof request.store.loadMediaAsset !== 'function') throw new TypeError('Frame RAW import requires its staged native body reader.');
		const body = await request.store.loadMediaAsset(source.storageKey, request.signal ? { signal: request.signal } : {});
		await validateFramescaperNativeImageBodyCurrentV1(source, body, request.signal);
	}
}
