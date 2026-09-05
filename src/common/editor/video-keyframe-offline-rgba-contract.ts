/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The offline RGBA composition hooks a product export strategy supplies.
 *
 * The renderer that calls these lives in `ui/`, because it drives the WebGL
 * preview compositor the workspace also renders through. The vocabulary does
 * not: `controller/product-video-export-strategy.ts` and the Framescaper
 * finishing strategies name these two function shapes to describe what they
 * hand the renderer, and a controller module that reaches into `ui/` for a type
 * cannot be read from a worker, the desktop main process or Node tooling
 * without dragging the presentation module along. So the shapes are declared
 * here, beside `video-keyframe-export-frame-source.ts` whose frame they carry,
 * and `ui/video-keyframe-offline-rgba-renderer.ts` re-exports them for the
 * renderer's own consumers.
 */

import type { VideoKeyframeExportFrame } from './video-keyframe-export-frame-source.ts';

export type VideoKeyframeOfflineRgbaCompositor = (request: Readonly<{
	readonly frame: VideoKeyframeExportFrame;
	readonly layers: readonly Readonly<Record<string, unknown>>[];
	readonly width: number;
	readonly height: number;
	readonly rgba: Uint8Array<ArrayBuffer>;
	readonly signal: AbortSignal;
}>) => PromiseLike<void> | void;

export type VideoKeyframeOfflineRgbaPostprocessor = (request: Readonly<{
	readonly frame: VideoKeyframeExportFrame;
	readonly width: number;
	readonly height: number;
	readonly rgba: Uint8Array<ArrayBuffer>;
	readonly signal: AbortSignal;
}>) => PromiseLike<void> | void;
