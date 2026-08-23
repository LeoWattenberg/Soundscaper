/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import {
	bindProductVideoVisualPreviewRuntime,
	createProductVideoVisualPreviewRuntime,
} from '../common/editor/ui/workspace/product-video-visual-preview-runtime.ts';

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
