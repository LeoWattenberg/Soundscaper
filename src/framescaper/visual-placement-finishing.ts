/* SPDX-License-Identifier: AGPL-3.0-only */

import type { UnifiedExactRenderVisualFrameEntryV13 } from '../common/editor/unified-exact-render-visual-consumers-v13.ts';
import type { VideoCanvasFit } from '../common/editor/video-canvas-fit.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../common/editor/video-clip-composition.ts';
import {
	resolveVideoRenderDescription,
	type VideoRenderDescription,
} from '../common/editor/video-render-description.ts';

export interface FramescaperVisualCanvasFinishing {
	readonly width: number;
	readonly height: number;
	readonly fit?: VideoCanvasFit;
}

export interface FramescaperVisualPlacementFinishing {
	readonly width: number;
	readonly height: number;
	readonly renderDescription: VideoRenderDescription;
}

/** Resolve one shared materialization size and canvas placement for playback and exact output. */
export function resolveFramescaperVisualPlacementFinishing(
	entry: UnifiedExactRenderVisualFrameEntryV13,
	canvas: FramescaperVisualCanvasFinishing,
): FramescaperVisualPlacementFinishing {
	if (!entry || typeof entry !== 'object' || !('source' in entry.authoredState)) {
		throw new TypeError('A source-backed finishing visual entry is required.');
	}
	const sourceWidth = dimension(entry.authoredState.source.width, 'finishing visual source width');
	const sourceHeight = dimension(entry.authoredState.source.height, 'finishing visual source height');
	const canvasWidth = dimension(canvas?.width, 'finishing visual canvas width');
	const canvasHeight = dimension(canvas?.height, 'finishing visual canvas height');
	const scale = Math.min(1, canvasWidth / sourceWidth, canvasHeight / sourceHeight);
	const width = entry.modelKind === 'external-generator'
		? canvasWidth : Math.max(1, Math.round(sourceWidth * scale));
	const height = entry.modelKind === 'external-generator'
		? canvasHeight : Math.max(1, Math.round(sourceHeight * scale));
	return Object.freeze({
		width,
		height,
		renderDescription: resolveVideoRenderDescription({
			composition: Object.freeze({
				...DEFAULT_VIDEO_CLIP_COMPOSITION,
				blendMode: entry.blendMode,
			}),
			sourceDisplaySize: { width, height },
			canvas,
			opacityStart: entry.opacity,
		}),
	});
}

function dimension(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 65_536) {
		throw new RangeError(`${name} must be a positive bounded dimension.`);
	}
	return Number(value);
}
