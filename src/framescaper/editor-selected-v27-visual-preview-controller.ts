/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	bindProductVideoVisualPreviewRuntime,
	createProductVideoVisualPreviewRuntime,
} from '../common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v27.ts';
import { framescaperProjectV27FoundationShapeV28 } from './editor-project-v28-foundation.ts';
import type { FramescaperProjectV28 } from './editor-project-v28.ts';
import type { FramescaperSelectedOpenFxExecutionV28 } from './selected-v28-openfx-exact-planes.ts';
import { createFramescaperOpenFxExecutionForFoundationV28 } from './selected-v28-openfx-execution.ts';

/** Bind a lazy selected-V27 visual executor without adding an always-visible surface. */
export function bindFramescaperSelectedVisualPreviewControllerV27(options: Readonly<{
	readonly controller: object;
	readonly profile: unknown;
	readonly store: AudioEditorProjectStore;
}>): void {
	if (!options?.controller || typeof options.controller !== 'object') {
		throw new TypeError('Selected V27 visual preview requires a controller owner.');
	}
	bindProductVideoVisualPreviewRuntime(options.controller, createProductVideoVisualPreviewRuntime(
		async (request) => {
			const module = await import('./editor-selected-v27-visual-preview.ts');
			return module.createFramescaperSelectedVisualPreviewSessionV27({
				...request,
				profile: options.profile,
				store: options.store,
			});
		},
		async (request) => {
			const module = await import('./editor-selected-v27-visual-preview.ts');
			return module.createFramescaperSelectedProjectBinThumbnailV27({
				...request,
				profile: options.profile,
				store: options.store,
			});
		},
		async (request) => {
			const module = await import('./editor-selected-v27-timeline-filmstrip.ts');
			return module.createFramescaperSelectedTimelineFilmstripV27({
				...request,
				profile: options.profile,
				store: options.store,
			});
		},
	));
}

/** Retain selected web-core preview for the V27 foundation of a V28 project. */
export function bindFramescaperSelectedVisualPreviewControllerV28(options: Readonly<{
	readonly controller: object;
	readonly profile: unknown;
	readonly store: AudioEditorProjectStore;
	readonly openFxExecute?: FramescaperSelectedOpenFxExecutionV28['execute'];
}>): void {
	if (!options?.controller || typeof options.controller !== 'object') {
		throw new TypeError('Selected V28 visual preview requires a controller owner.');
	}
	const inherited = <Request extends Readonly<{ readonly project: unknown }>>(request: Request) => ({
		...request,
		project: framescaperProjectV27FoundationShapeV28(request.project),
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
						profile: options.profile, project: request.project as FramescaperProjectV28,
						foundationPlan, timingViews, execute: options.openFxExecute!,
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
