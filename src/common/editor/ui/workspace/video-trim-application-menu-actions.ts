/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FrameCanonicalEdgeTrimRequest } from '../../frame-canonical-edge-trim-domain.ts';
import type { FrameCanonicalRollRippleTrimRequest } from '../../frame-canonical-roll-ripple-trim-domain.ts';
import type { FrameCanonicalRateStretchRequest } from '../../frame-canonical-rate-stretch-domain.ts';
import type { FrameCanonicalSlipSlideRequest } from '../../frame-canonical-slip-slide-domain.ts';
import type { FrameCanonicalSlipSlideStep } from '../../frame-canonical-slip-slide-step-request.ts';

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
				readonly slipSlide: Readonly<{
					buildStepRequest(step: FrameCanonicalSlipSlideStep): Readonly<FrameCanonicalSlipSlideRequest>;
					preview(request: FrameCanonicalSlipSlideRequest): unknown;
					commit(request: FrameCanonicalSlipSlideRequest): unknown;
				}>;
				readonly rateStretch: Readonly<{
					preview(request: FrameCanonicalRateStretchRequest): unknown;
					commit(request: FrameCanonicalRateStretchRequest): unknown;
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
	buildVideoSlipSlideStepRequest(step: FrameCanonicalSlipSlideStep): Readonly<FrameCanonicalSlipSlideRequest>;
	planVideoSlipSlide(request: FrameCanonicalSlipSlideRequest): unknown;
	commitVideoSlipSlide(request: FrameCanonicalSlipSlideRequest): unknown;
	planVideoRateStretch(request: FrameCanonicalRateStretchRequest): unknown;
	commitVideoRateStretch(request: FrameCanonicalRateStretchRequest): unknown;
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
		buildVideoSlipSlideStepRequest: (step: FrameCanonicalSlipSlideStep) => (
			controller.actions.video.trim.slipSlide.buildStepRequest(step)
		),
		planVideoSlipSlide: (request: FrameCanonicalSlipSlideRequest) => (
			controller.actions.video.trim.slipSlide.preview(request)
		),
		commitVideoSlipSlide: (request: FrameCanonicalSlipSlideRequest) => run(() => (
			controller.actions.video.trim.slipSlide.commit(request)
		)),
		planVideoRateStretch: (request: FrameCanonicalRateStretchRequest) => (
			controller.actions.video.trim.rateStretch.preview(request)
		),
		commitVideoRateStretch: (request: FrameCanonicalRateStretchRequest) => run(() => (
			controller.actions.video.trim.rateStretch.commit(request)
		)),
	});
}
