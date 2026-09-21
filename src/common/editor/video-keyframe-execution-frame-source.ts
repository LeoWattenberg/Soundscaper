/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertVideoKeyframeExportFrame,
	type VideoKeyframeExportFrameSource,
} from './video-keyframe-export-frame-source.ts';
import type { Rational } from './timeline-time.ts';

export interface AuthenticatedVideoKeyframeExecutionFrameSource {
	readonly frameCount: number;
	readonly canvas: Readonly<{
		readonly width: number;
		readonly height: number;
		readonly frameRate: Rational;
	}>;
	frame(index: number): unknown;
}

/** Project authenticated source frames through the exact geometry admitted by an encoder workload. */
export function createAuthenticatedVideoKeyframeExecutionFrameSource(
	frameSource: VideoKeyframeExportFrameSource,
	geometry: Readonly<{
		readonly frameCount: number;
		readonly width: number;
		readonly height: number;
		readonly frameRate: Rational;
	}>,
): AuthenticatedVideoKeyframeExecutionFrameSource {
	return Object.freeze({
		frameCount: geometry.frameCount,
		canvas: Object.freeze({
			width: geometry.width,
			height: geometry.height,
			frameRate: geometry.frameRate,
		}),
		frame(index: number): unknown {
			const frame: unknown = frameSource.frame(index);
			assertVideoKeyframeExportFrame(frameSource, frame);
			return frame;
		},
	});
}
