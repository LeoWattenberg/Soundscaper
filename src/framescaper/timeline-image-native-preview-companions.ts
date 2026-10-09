/* SPDX-License-Identifier: AGPL-3.0-only */
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import type { ProductVideoVisualPreviewCreateRequest, ProductVideoVisualPreviewSession, ProductVideoVisualProjectBinThumbnailRequest, ProductVideoVisualProjectBinThumbnail } from '../common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from './editor-project-native-media-foundation.ts';
import { framescaperProjectNativeMediaFoundationShapeTimelineImage } from './editor-project-timeline-image-foundation.ts';
import type { FramescaperProjectNativeMedia } from './editor-project-native-media.ts';
import { createFramescaperOpenFxExecutionForFoundationNativeMedia } from './selected-native-media-openfx-execution.ts';
import { createFramescaperOpenFxExecutionForResourceFoundationV16 } from './selected-native-media-openfx-resource-v16.ts';
import type { CreateFramescaperOpenFxExactExecutionNativeMedia } from './video-export-exact-execution-finishing.ts';
import type { CreateFramescaperOpenFxExactExecutionV16 } from './video-export-exact-execution-v16.ts';
import type { FramescaperSelectedOpenFxExecutionNativeMedia } from './selected-native-media-openfx-exact-planes.ts';
/** Capture the native project and host before lazy acquisition; each named plan
 * keeps its matching private native14 pair and authored resource position. */
export function createTimelineImageNativePreviewCompanions(project: FramescaperProjectNativeMedia,
	execute: FramescaperSelectedOpenFxExecutionNativeMedia['execute'] | undefined) {
	if (!execute) {
		if (project.ofxEffects.length > 0) throw new Error('Selected TimelineImage preview requires the native OpenFX frame port.');
		return {};
	}
	return {
		createOpenFxExecution: ({ foundationPlan, timingViews }: Parameters<CreateFramescaperOpenFxExactExecutionNativeMedia>[0]) =>
			createFramescaperOpenFxExecutionForFoundationNativeMedia({ profile: FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE,
				project, foundationPlan, timingViews, execute }),
		createOpenFxExecutionV16: ({ foundationPlan, timingViews }: Parameters<CreateFramescaperOpenFxExactExecutionV16>[0]) =>
			createFramescaperOpenFxExecutionForResourceFoundationV16({ profile: FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE,
				project, foundationPlan, timingViews, execute }),
	};
}

export async function createDefaultInheritedSession(
	request: ProductVideoVisualPreviewCreateRequest,
	store: AudioEditorProjectStore,
	execute?: FramescaperSelectedOpenFxExecutionNativeMedia['execute'],
): Promise<ProductVideoVisualPreviewSession | null> {
	const native = framescaperProjectNativeMediaFoundationShapeTimelineImage(request.project);
	const project = framescaperProjectFinishingFoundationShapeNativeMedia(native);
	const companions = createTimelineImageNativePreviewCompanions(native, execute);
	const module = await import('./editor-selected-finishing-visual-preview.ts');
	return module.createFramescaperSelectedVisualPreviewSessionFinishing({
		...request, project, ...companions,
		profile: FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE,
		store,
	});
}

export async function createDefaultInheritedThumbnail(
	request: ProductVideoVisualProjectBinThumbnailRequest,
	store: AudioEditorProjectStore,
): Promise<ProductVideoVisualProjectBinThumbnail | null> {
	const module = await import('./editor-selected-finishing-visual-preview.ts');
	return module.createFramescaperSelectedProjectBinThumbnailFinishing({
		...request,
		project: framescaperProjectFinishingFoundationShapeNativeMedia(
			framescaperProjectNativeMediaFoundationShapeTimelineImage(request.project),
		),
		profile: FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE,
		store,
	});
}
