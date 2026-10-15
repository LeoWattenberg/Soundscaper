/* SPDX-License-Identifier: AGPL-3.0-only */
import { authenticateFramescaperProjectMediaResourcesV1 } from '../../common/editor/storage/project-media-resource-audit-v1.ts';
import { collectFramescaperImageProjectResourcesCurrentV1 } from '../../common/editor/video-cube-lut-project-references-current-v1.ts';
import type { FramescaperProject } from '../editor-project.ts';
import type { FramescaperScapeImagePublicationDependencies } from '../editor-scape-image-project-publication.ts';

/** Fixed current source owner only; legacy projects keep their existing save
 * and publication order. Complete metadata is checked before any body read. */
export async function prepareFramescaperTimelineImageResourceAuditV1(dependencies: FramescaperScapeImagePublicationDependencies,
	project: FramescaperProject): Promise<void> {
	if (!project.sources.some(source => source.kind === 'image' && (source.schemaVersion === 3 || source.schemaVersion === 4))) return;
	collectFramescaperImageProjectResourcesCurrentV1(project);
	await authenticateFramescaperProjectMediaResourcesV1(dependencies.port, dependencies.media, project);
}
