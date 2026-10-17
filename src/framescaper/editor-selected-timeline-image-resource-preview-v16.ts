/* SPDX-License-Identifier: AGPL-3.0-only */

import { sameProjectSnapshot } from '../common/editor/storage/project-snapshot-equality.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE, FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { cloneFramescaperProjectTimelineImage, type FramescaperProjectTimelineImage } from './editor-project-timeline-image.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from './editor-project-native-media-foundation.ts';
import { createTimelineImagePictureCarrier } from './timeline-image-picture-carrier.ts';
import { hasSelectedCubeLutPictureV2 } from './selected-preview-resource-policy.ts';
import { createFramescaperSelectedVisualPreviewSessionFinishing } from './editor-selected-finishing-visual-preview.ts';
import { createFramescaperVideoExportImageExecutionTimelineImageV16 } from './video-export-image-execution-timeline-image-v16.ts';
import { createFramescaperOpenFxExecutionForResourceFoundationV16 } from './selected-native-media-openfx-resource-v16.ts';
import type { FramescaperSelectedVisualPreviewOptionsTimelineImage } from './editor-selected-timeline-image-image-preview.ts';
import type { CreateFramescaperOpenFxExactExecutionV16 } from './video-export-exact-execution-v16.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;
/** The owning TimelineImage admission runs before this pure capability choice. */
export function requiresTimelineImageResourcePreviewV16(project: FramescaperProjectTimelineImage): boolean {
	return project.sources.some(source => source.kind === 'image' && source.schemaVersion !== 1) || hasSelectedCubeLutPictureV2(project) || (Array.isArray(project.videoVisualPresentations)
		&& project.videoVisualPresentations.some((row: Readonly<{ enabled?: boolean; grade?: Readonly<{ lut?: unknown }> }>) => row.enabled && row.grade?.lut != null));
}

/** Preserve original track order with transparent placeholder nodes and scoped
 * image planes. Complete16 and native14 OpenFX remain privately paired. */
export async function createTimelineImageResourcePreviewV16(options: FramescaperSelectedVisualPreviewOptionsTimelineImage,
	project: FramescaperProjectTimelineImage) {
	const nativeProject = createTimelineImagePictureCarrier(project);
	const foundation = framescaperProjectFinishingFoundationShapeNativeMedia(nativeProject);
	const execute = options.openFxExecute, clone = options.cloneProject ?? cloneFramescaperProjectTimelineImage;
	if (nativeProject.ofxEffects.length > 0 && !execute) throw new Error('Selected resource TimelineImage preview requires the native OpenFX frame port.');
	const live = options.project, profile = options.profile, store = options.store;
	const externalCurrent = options.assertCurrentV16;
	const currentSignal = options.signal ?? new AbortController().signal;
	const assertCurrent = (signal: AbortSignal) => {
		Reflect.apply(CHECK, signal, []);
		if (externalCurrent) try { Reflect.apply(externalCurrent, options, []); }
		catch (error) { Reflect.apply(CHECK, signal, []); throw error; }
		let current: FramescaperProjectTimelineImage;
		try { current = Reflect.apply(clone, undefined, [profile, live]) as FramescaperProjectTimelineImage; }
		catch (error) { Reflect.apply(CHECK, signal, []); throw error; }
		Reflect.apply(CHECK, signal, []);
		if (!sameProjectSnapshot(current, project)) throw new Error('The selected resource TimelineImage preview is stale.');
	};
	const createOpenFxExecutionV16: CreateFramescaperOpenFxExactExecutionV16 | undefined = execute ? ({ foundationPlan, timingViews }) =>
		createFramescaperOpenFxExecutionForResourceFoundationV16({ profile: FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE,
			project: nativeProject, foundationPlan, timingViews, execute }) : undefined;
	return createFramescaperSelectedVisualPreviewSessionFinishing({
		project: foundation, profile: FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE,
		store, width: options.width, height: options.height, ...(options.fit ? { fit: options.fit } : {}),
		...(options.signal ? { signal: options.signal } : {}),
		...(createOpenFxExecutionV16 ? { createOpenFxExecutionV16 } : {}),
		assertCurrentV16() { assertCurrent(currentSignal); },
		createSupplementalPictureExecutionV16({ foundationPlan, timingSidecars, signal, assertCurrent: inherited }) {
			return createFramescaperVideoExportImageExecutionTimelineImageV16({ project, profile, foundationPlan, timingSidecars, store,
				signal, assertCurrent() { inherited(); assertCurrent(signal); },
			});
		},
	});
}
