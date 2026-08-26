/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	bindProductVideoVisualPreviewRuntime,
	createProductVideoVisualPreviewRuntime,
} from '../common/editor/ui/workspace/product-video-visual-preview-runtime.ts';

/** Bind lazy authenticated V30 image preview, Project Bin, and filmstrip routes. */
export function bindFramescaperSelectedImagePreviewControllerV30(options: Readonly<{
	readonly controller: object;
	readonly profile: unknown;
	readonly store: AudioEditorProjectStore;
	readonly cloneProject?: (profile: unknown, project: unknown) => never;
}>): void {
	if (!options?.controller || typeof options.controller !== 'object') {
		throw new TypeError('Selected V30 image preview requires a controller owner.');
	}
	bindProductVideoVisualPreviewRuntime(options.controller, createProductVideoVisualPreviewRuntime(
		async (request) => {
			const module = await import('./editor-selected-v30-image-preview.ts');
			return module.createFramescaperSelectedVisualPreviewSessionV30({
				...request, profile: options.profile, store: options.store,
				...(options.cloneProject ? { cloneProject: options.cloneProject } : {}),
			});
		},
		async (request) => {
			const module = await import('./editor-selected-v30-image-preview.ts');
			return module.createFramescaperSelectedProjectBinThumbnailV30({
				...request, profile: options.profile, store: options.store,
				...(options.cloneProject ? { cloneProject: options.cloneProject } : {}),
			});
		},
		async (request) => {
			const module = await import('./editor-selected-v30-image-filmstrip.ts');
			return module.createFramescaperSelectedTimelineFilmstripV30({
				...request, profile: options.profile, store: options.store,
				...(options.cloneProject ? { cloneProject: options.cloneProject } : {}),
			});
		},
	));
}
