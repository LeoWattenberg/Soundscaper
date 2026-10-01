/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	exactVideoPreviewRenderDimension,
	VIDEO_PREVIEW_MAXIMUM_RENDER_DIMENSION,
} from './video-preview-render-size.js';

/** Resolve the physical render-target geometry for preview or exact offline output. */
export function resolveVideoPreviewCompositorSize(canvas, options = {}) {
	const rect = canvas.getBoundingClientRect();
	const pixelRatio = Math.max(1, Number(globalThis.devicePixelRatio) || 1);
	const previewScale = options.outputWidth != null || options.outputHeight != null ? 1
		: options.previewResolution === 'quarter' ? 0.25 : options.previewResolution === 'half' ? 0.5 : 1;
	let width = options.outputWidth == null
		? Math.max(1, Math.round(rect.width * pixelRatio * previewScale))
		: exactVideoPreviewRenderDimension(options.outputWidth, 'width');
	let height = options.outputHeight == null
		? Math.max(1, Math.round(rect.height * pixelRatio * previewScale))
		: exactVideoPreviewRenderDimension(options.outputHeight, 'height');
	const scale = Math.min(
		1,
		VIDEO_PREVIEW_MAXIMUM_RENDER_DIMENSION / Math.max(width, height),
	);
	width = Math.max(1, Math.round(width * scale));
	height = Math.max(1, Math.round(height * scale));
	return Object.freeze({ width, height });
}
