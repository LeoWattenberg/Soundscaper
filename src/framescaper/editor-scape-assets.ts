/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAssistanceTranscriptScapeProjectAssetExtensionV1,
} from '../common/editor/assistance/transcript-scape-asset-extension-v1.ts';
import { composeScapeProjectAssetExtensions } from
	'../common/editor/scape-project-asset-extension-composition.ts';
import type { ScapeProjectAssetExtension } from '../common/editor/scape-project-asset-extension.ts';
import { framescaperProjectTimelineImageFoundationShapeAssistance } from './editor-project-assistance-foundation.ts';
import { createFramescaperScapeProjectAssetExtensionTimelineImage } from './editor-scape-assets-timeline-image.ts';
import { validateFramescaperProject } from './editor-project.ts';
import { assertFramescaperProjectRuntimeProfile } from './editor-project-runtime-profile.ts';

/** Complete Framescaper v1 Scape media-body extension. */
export function createFramescaperScapeProjectAssetExtension(
	profile: unknown,
): Readonly<ScapeProjectAssetExtension> {
	assertFramescaperProjectRuntimeProfile(profile);
	const images = createFramescaperScapeProjectAssetExtensionTimelineImage(profile, {
		authenticate: assertFramescaperProjectRuntimeProfile,
		clone: (_codecProfile, project) => framescaperProjectTimelineImageFoundationShapeAssistance(
			project,
		),
		validate: validateFramescaperProject,
	});
	return composeScapeProjectAssetExtensions([
		images,
		createAssistanceTranscriptScapeProjectAssetExtensionV1(),
	]);
}
