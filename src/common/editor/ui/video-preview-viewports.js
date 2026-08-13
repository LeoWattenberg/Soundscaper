/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	GAUSSIAN_BLUR_RENDER_SCALE,
	finiteNumber,
} from './video-preview-effects.js';

function containViewport(sourceWidth, sourceHeight, outerX, outerY, outerWidth, outerHeight, viewport) {
	const scale = Math.min(outerWidth / sourceWidth, outerHeight / sourceHeight);
	const fittedWidth = Math.max(1, Math.round(sourceWidth * scale));
	const fittedHeight = Math.max(1, Math.round(sourceHeight * scale));
	viewport.x = outerX + Math.round((outerWidth - fittedWidth) / 2);
	viewport.y = outerY + Math.round((outerHeight - fittedHeight) / 2);
	viewport.width = fittedWidth;
	viewport.height = fittedHeight;
	return viewport;
}

/** Mirror export geometry through the physical preview panel and source. */
export function videoPreviewViewports(
	sourceWidth,
	sourceHeight,
	panelWidth,
	panelHeight,
	referenceWidth,
	referenceHeight,
	result = null,
) {
	const output = result || {
		canvas: { x: 0, y: 0, width: 1, height: 1 },
		content: { x: 0, y: 0, width: 1, height: 1 },
		pixelScale: 1,
	};
	const safeSourceWidth = Math.max(1, finiteNumber(sourceWidth, 1));
	const safeSourceHeight = Math.max(1, finiteNumber(sourceHeight, 1));
	const safePanelWidth = Math.max(1, finiteNumber(panelWidth, 1));
	const safePanelHeight = Math.max(1, finiteNumber(panelHeight, 1));
	const safeReferenceWidth = Math.max(1, finiteNumber(referenceWidth, safePanelWidth));
	const safeReferenceHeight = Math.max(1, finiteNumber(referenceHeight, safePanelHeight));
	containViewport(
		safeReferenceWidth,
		safeReferenceHeight,
		0,
		0,
		safePanelWidth,
		safePanelHeight,
		output.canvas,
	);
	containViewport(
		safeSourceWidth,
		safeSourceHeight,
		output.canvas.x,
		output.canvas.y,
		output.canvas.width,
		output.canvas.height,
		output.content,
	);
	output.pixelScale = Math.min(
		safePanelWidth / safeReferenceWidth,
		safePanelHeight / safeReferenceHeight,
	);
	return output;
}

/** Map a full-resolution nested content rect into the active blur target. */
export function videoPreviewBlurViewport(
	contentViewport,
	panelWidth,
	panelHeight,
	blurTargetWidth,
	blurTargetHeight,
	renderScale = GAUSSIAN_BLUR_RENDER_SCALE,
	result = null,
) {
	const output = result || { x: 0, y: 0, width: 1, height: 1 };
	const safeTargetWidth = Math.max(1, Math.floor(finiteNumber(blurTargetWidth, 1)));
	const safeTargetHeight = Math.max(1, Math.floor(finiteNumber(blurTargetHeight, 1)));
	const targetScale = Math.max(0.0001, finiteNumber(renderScale, GAUSSIAN_BLUR_RENDER_SCALE))
		/ GAUSSIAN_BLUR_RENDER_SCALE;
	const scaleX = safeTargetWidth / Math.max(1, panelWidth) * targetScale;
	const scaleY = safeTargetHeight / Math.max(1, panelHeight) * targetScale;
	output.x = Math.min(safeTargetWidth - 1, Math.max(0, Math.round(contentViewport.x * scaleX)));
	output.y = Math.min(safeTargetHeight - 1, Math.max(0, Math.round(contentViewport.y * scaleY)));
	output.width = Math.min(
		safeTargetWidth - output.x,
		Math.max(1, Math.round(contentViewport.width * scaleX)),
	);
	output.height = Math.min(
		safeTargetHeight - output.y,
		Math.max(1, Math.round(contentViewport.height * scaleY)),
	);
	return output;
}
