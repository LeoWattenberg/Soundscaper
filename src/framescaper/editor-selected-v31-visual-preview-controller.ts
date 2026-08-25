/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	bindProductVideoVisualPreviewRuntime,
	createProductVideoVisualPreviewRuntime,
} from '../common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v27.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v28.ts';
import { assertFramescaperProjectV31Profile } from './editor-project-runtime-profile-v31.ts';
import { framescaperProjectV27FoundationShapeV28 } from './editor-project-v28-foundation.ts';
import type { FramescaperProjectV28 } from './editor-project-v28.ts';
import { framescaperProjectV28FoundationShapeV31 } from './editor-project-v31-foundation.ts';
import type { FramescaperSelectedOpenFxExecutionV28 } from './selected-v28-openfx-exact-planes.ts';
import { createFramescaperOpenFxExecutionForFoundationV28 } from './selected-v28-openfx-execution.ts';

/** Bind the selected V28 preview implementation to F31's detached foundation. */
export function bindFramescaperSelectedVisualPreviewControllerV31(options: Readonly<{
	readonly controller: object;
	readonly profile: unknown;
	readonly store: AudioEditorProjectStore;
	readonly openFxExecute?: FramescaperSelectedOpenFxExecutionV28['execute'];
}>): void {
	assertFramescaperProjectV31Profile(options.profile);
	if (!options.controller || typeof options.controller !== 'object') {
		throw new TypeError('Selected F31 visual preview requires a controller owner.');
	}
	const projectV28 = (project: unknown): FramescaperProjectV28 => (
		framescaperProjectV28FoundationShapeV31(project)
	);
	const inherited = <Request extends Readonly<{ readonly project: unknown }>>(request: Request) => ({
		...request,
		project: framescaperProjectV27FoundationShapeV28(projectV28(request.project)),
		profile: FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE,
		store: options.store,
	});
	bindProductVideoVisualPreviewRuntime(options.controller, createProductVideoVisualPreviewRuntime(
		async (request) => {
			const module = await import('./editor-selected-v27-visual-preview.ts');
			return module.createFramescaperSelectedVisualPreviewSessionV27({
				...inherited(request),
				...(options.openFxExecute ? { createOpenFxExecution: ({ foundationPlan, timingViews }) => (
					createFramescaperOpenFxExecutionForFoundationV28({
						profile: FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
						project: projectV28(request.project), foundationPlan, timingViews,
						execute: options.openFxExecute!,
					})
				) } : {}),
			});
		},
		async (request) => {
			const module = await import('./editor-selected-v27-visual-preview.ts');
			return module.createFramescaperSelectedProjectBinThumbnailV27(inherited(request) as never);
		},
		async (request) => {
			const module = await import('./editor-selected-v27-timeline-filmstrip.ts');
			return module.createFramescaperSelectedTimelineFilmstripV27(inherited(request) as never);
		},
	));
}
