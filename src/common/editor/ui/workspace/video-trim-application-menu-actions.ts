/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FrameCanonicalEdgeTrimRequest } from '../../frame-canonical-edge-trim-domain.ts';
import type { FrameCanonicalRollRippleTrimRequest } from '../../frame-canonical-roll-ripple-trim-domain.ts';

interface VideoTrimActionController {
	getTelemetrySnapshot(): Readonly<{ readonly positionFrame?: unknown }>;
	readonly actions: Readonly<{
		readonly video: Readonly<{
			readonly trim: Readonly<{
				preview(request: FrameCanonicalEdgeTrimRequest): unknown;
				commit(request: FrameCanonicalEdgeTrimRequest): unknown;
				readonly rollRipple: Readonly<{
					preview(request: FrameCanonicalRollRippleTrimRequest): unknown;
					commit(request: FrameCanonicalRollRippleTrimRequest): unknown;
				}>;
			}>;
		}>;
	}>;
}

export interface VideoTrimApplicationMenuActions {
	currentVideoPlayheadSample(): number | null;
	planVideoTrim(request: FrameCanonicalEdgeTrimRequest): unknown;
	commitVideoTrim(request: FrameCanonicalEdgeTrimRequest): unknown;
	planVideoRollRippleTrim(request: FrameCanonicalRollRippleTrimRequest): unknown;
	commitVideoRollRippleTrim(request: FrameCanonicalRollRippleTrimRequest): unknown;
}

/** Adapt both trim action branches to the application-menu runtime ports. */
export function createVideoTrimApplicationMenuActions(
	controller: VideoTrimActionController,
	run: (action: () => unknown) => unknown,
): Readonly<VideoTrimApplicationMenuActions> {
	return Object.freeze({
		currentVideoPlayheadSample: () => {
			const value = controller.getTelemetrySnapshot().positionFrame;
			return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
		},
		planVideoTrim: (request: FrameCanonicalEdgeTrimRequest) => (
			controller.actions.video.trim.preview(request)
		),
		commitVideoTrim: (request: FrameCanonicalEdgeTrimRequest) => run(() => (
			controller.actions.video.trim.commit(request)
		)),
		planVideoRollRippleTrim: (request: FrameCanonicalRollRippleTrimRequest) => (
			controller.actions.video.trim.rollRipple.preview(request)
		),
		commitVideoRollRippleTrim: (request: FrameCanonicalRollRippleTrimRequest) => run(() => (
			controller.actions.video.trim.rollRipple.commit(request)
		)),
	});
}
