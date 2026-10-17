/* SPDX-License-Identifier: AGPL-3.0-only */
import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import { bindProductVideoVisualPreviewRuntime, createProductVideoVisualPreviewRuntime } from '../common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import type { FramescaperCompositionAssetReader } from './editor-composition-link-resources.ts';
import { framescaperCompositionPreviewProject } from './editor-composition-link-preview-project.ts';

/** Keep the Motion raster/scene closure out of ordinary editor startup. */
export function bindFramescaperSuccessorCompositionPreview(options: Readonly<{
	controller: object; store: AudioEditorProjectStore; readAsset: FramescaperCompositionAssetReader;
}>): void {
	bindProductVideoVisualPreviewRuntime(options.controller, createProductVideoVisualPreviewRuntime(async request => {
		const project = framescaperCompositionPreviewProject(request.project); if (!project) return null;
		const { createFramescaperSuccessorCompositionPreview } = await import('./editor-composition-link-preview.ts');
		return createFramescaperSuccessorCompositionPreview({ ...request, project, store: options.store, readAsset: options.readAsset });
	}, async request => {
		const project = framescaperCompositionPreviewProject(request.project); if (!project) return null;
		const { createFramescaperSuccessorProjectBinThumbnail } = await import('./editor-composition-link-thumbnails.ts');
		return createFramescaperSuccessorProjectBinThumbnail({ ...request, project, store: options.store, readAsset: options.readAsset });
	}, async request => {
		const project = framescaperCompositionPreviewProject(request.project); if (!project) return null;
		const { createFramescaperSuccessorTimelineFilmstrip } = await import('./editor-composition-link-thumbnails.ts');
		return createFramescaperSuccessorTimelineFilmstrip({ ...request, project, store: options.store, readAsset: options.readAsset });
	}, {
		ownsSource: (project, sourceId) => framescaperCompositionPreviewProject(project)?.compositionLinks.some(link => link.sourceId === sourceId) ?? false,
		async createFrame(request) {
			const project = framescaperCompositionPreviewProject(request.project); if (!project) return null;
			const { createFramescaperSuccessorSourceFrame } = await import('./editor-composition-link-thumbnails.ts');
			return createFramescaperSuccessorSourceFrame({ ...request, project, store: options.store, readAsset: options.readAsset });
		},
	}));
}
