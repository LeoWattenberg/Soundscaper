/* SPDX-License-Identifier: AGPL-3.0-only */
import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import { classifyProjectSchemaIdentity } from '../common/editor/project-schema-identity.ts';
import { bindProductVideoVisualPreviewRuntime, createProductVideoVisualPreviewRuntime } from '../common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import type { FramescaperCompositionAssetReader } from './editor-composition-link-resources.ts';

/** Keep the Motion raster/scene closure out of ordinary editor startup. */
export function bindFramescaperSuccessorCompositionPreview(options: Readonly<{
	controller: object; store: AudioEditorProjectStore; readAsset: FramescaperCompositionAssetReader;
}>): void {
	bindProductVideoVisualPreviewRuntime(options.controller, createProductVideoVisualPreviewRuntime(async request => {
		if (classifyProjectSchemaIdentity(request.project, 'framescaper', 'successor').disposition !== 'current') return null;
		const { createFramescaperSuccessorCompositionPreview } = await import('./editor-composition-link-preview.ts');
		return createFramescaperSuccessorCompositionPreview({ ...request, store: options.store, readAsset: options.readAsset });
	}));
}
