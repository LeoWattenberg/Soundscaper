/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	bindProductVideoVisualPreviewRuntime,
	createProductVideoVisualPreviewRuntime,
} from '../common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE } from './editor-domain-runtime-profile.ts';
import { assertFramescaperProjectAssistanceProfile } from './editor-domain-runtime-profile.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from './editor-project-native-media-foundation.ts';
import type { FramescaperProjectNativeMedia } from './editor-project-native-media.ts';
import { framescaperProjectNativeMediaFoundationShapeAssistance } from './editor-project-assistance-foundation.ts';
import type { FramescaperSelectedOpenFxExecutionNativeMedia } from './selected-native-media-openfx-exact-planes.ts';
import { createFramescaperOpenFxExecutionForFoundationNativeMedia } from './selected-native-media-openfx-execution.ts';
import type { CreateFramescaperOpenFxExactExecutionNativeMedia } from './video-export-exact-execution-finishing.ts';

/** Bind the selected nativeMedia preview implementation to assistance's detached foundation. */
export function bindFramescaperSelectedVisualPreviewControllerAssistance(options: Readonly<{
	readonly controller: object;
	readonly profile: unknown;
	readonly store: AudioEditorProjectStore;
	readonly openFxExecute?: FramescaperSelectedOpenFxExecutionNativeMedia['execute'];
}>): void {
	assertFramescaperProjectAssistanceProfile(options.profile);
	if (!options.controller || typeof options.controller !== 'object') {
		throw new TypeError('Selected assistance visual preview requires a controller owner.');
	}
	const projectNativeMedia = (project: unknown): FramescaperProjectNativeMedia => (
		framescaperProjectNativeMediaFoundationShapeAssistance(foundationInput(project))
	);
	const openFxExecute = options.openFxExecute;
	const inherited = <Request extends Readonly<{ readonly project: unknown }>>(request: Request) => ({
		...request,
		project: framescaperProjectFinishingFoundationShapeNativeMedia(projectNativeMedia(request.project)),
		profile: FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE,
		store: options.store,
	});
	bindProductVideoVisualPreviewRuntime(options.controller, createProductVideoVisualPreviewRuntime(
		async (request) => {
			const module = await import('./editor-selected-finishing-visual-preview.ts');
			return module.createFramescaperSelectedVisualPreviewSessionFinishing({
				...inherited(request),
				...(openFxExecute ? { createOpenFxExecution: ({ foundationPlan, timingViews }:
					Parameters<CreateFramescaperOpenFxExactExecutionNativeMedia>[0]) => (
					createFramescaperOpenFxExecutionForFoundationNativeMedia({
						profile: FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE,
						project: projectNativeMedia(request.project), foundationPlan, timingViews,
						execute: openFxExecute,
					})
				) } : {}),
			});
		},
		async (request) => {
			const module = await import('./editor-selected-finishing-visual-preview.ts');
			return module.createFramescaperSelectedProjectBinThumbnailFinishing(inherited(request) as never);
		},
		async (request) => {
			const module = await import('./editor-selected-finishing-timeline-filmstrip.ts');
			return module.createFramescaperSelectedTimelineFilmstripFinishing({
				...inherited(request),
				...(openFxExecute ? { createOpenFxExecution: ({ foundationPlan, timingViews }:
					Parameters<CreateFramescaperOpenFxExactExecutionNativeMedia>[0]) => (
					createFramescaperOpenFxExecutionForFoundationNativeMedia({
						profile: FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE,
						project: projectNativeMedia(request.project), foundationPlan, timingViews,
						execute: openFxExecute,
					})
				) } : {}),
			} as never);
		},
	));
}

function foundationInput(value: unknown): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
	const family = Object.getOwnPropertyDescriptor(value, 'schemaFamily');
	return family?.enumerable && Object.hasOwn(family, 'value') && family.value === 'framescaper'
		? value
		: value;
}
