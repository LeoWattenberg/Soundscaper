/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FrameCanonicalEdgeTrimPlan,
	FrameCanonicalEdgeTrimRequest,
} from '../frame-canonical-edge-trim-domain.ts';
import type { FrameCanonicalClipFocusStep } from '../frame-canonical-clip-focus-step-request.ts';
import type {
	FrameCanonicalRollRippleTrimPlan,
	FrameCanonicalRollRippleTrimRequest,
} from '../frame-canonical-roll-ripple-trim-domain.ts';
import type {
	FrameCanonicalRateStretchPlan,
	FrameCanonicalRateStretchRequest,
} from '../frame-canonical-rate-stretch-domain.ts';
import type {
	FrameCanonicalSlipSlidePlan,
	FrameCanonicalSlipSlideRequest,
} from '../frame-canonical-slip-slide-domain.ts';
import type {
	FrameCanonicalSlipSlidePointerAuthority,
	FrameCanonicalSlipSlidePointerCapture,
} from '../frame-canonical-slip-slide-pointer-request.ts';
import type { FrameCanonicalSlipSlideStep } from '../frame-canonical-slip-slide-step-request.ts';
import type { VideoTrimServices } from './video-trim-composition.ts';

export interface VideoTrimActionFacadeDependencies {
	readonly videoCompositing: boolean;
	readonly productName: string;
	readonly services: VideoTrimServices;
}

export interface VideoTrimActionFacade {
	preview(request: FrameCanonicalEdgeTrimRequest): FrameCanonicalEdgeTrimPlan;
	commit(request: FrameCanonicalEdgeTrimRequest): FrameCanonicalEdgeTrimPlan;
	commitStep(step: FrameCanonicalClipFocusStep): FrameCanonicalEdgeTrimPlan;
	readonly rollRipple: Readonly<{
		preview(request: FrameCanonicalRollRippleTrimRequest): FrameCanonicalRollRippleTrimPlan;
		commit(request: FrameCanonicalRollRippleTrimRequest): FrameCanonicalRollRippleTrimPlan;
	}>;
	readonly slipSlide: Readonly<{
		capturePointerAuthority(
			capture: FrameCanonicalSlipSlidePointerCapture,
		): FrameCanonicalSlipSlidePointerAuthority;
		buildStepRequest(step: FrameCanonicalSlipSlideStep): Readonly<FrameCanonicalSlipSlideRequest>;
		preview(request: FrameCanonicalSlipSlideRequest): FrameCanonicalSlipSlidePlan;
		commit(request: FrameCanonicalSlipSlideRequest): FrameCanonicalSlipSlidePlan;
	}>;
	readonly rateStretch: Readonly<{
		preview(request: FrameCanonicalRateStretchRequest): FrameCanonicalRateStretchPlan;
		commit(request: FrameCanonicalRateStretchRequest): FrameCanonicalRateStretchPlan;
		commitStep(step: FrameCanonicalClipFocusStep): FrameCanonicalRateStretchPlan;
	}>;
}

/** Preserve ordinary trim ports and capability-gate every nested trim port identically. */
export function createVideoTrimActionFacade(
	dependencies: VideoTrimActionFacadeDependencies,
): Readonly<VideoTrimActionFacade> {
	const guard = <Request, Result>(action: (request: Request) => Result) => (
		(request: Request): Result => {
			if (!dependencies.videoCompositing) {
				throw new RangeError(`${dependencies.productName} does not support videoCompositing.`);
			}
			return action(request);
		}
	);
	return Object.freeze({
		preview: guard(dependencies.services.edge.preview),
		commit: guard(dependencies.services.edge.commit),
		commitStep: guard(dependencies.services.edge.commitStep),
		rollRipple: Object.freeze({
			preview: guard(dependencies.services.rollRipple.preview),
			commit: guard(dependencies.services.rollRipple.commit),
		}),
		slipSlide: Object.freeze({
			capturePointerAuthority: guard(dependencies.services.slipSlide.capturePointerAuthority),
			buildStepRequest: guard(dependencies.services.slipSlide.buildStepRequest),
			preview: guard(dependencies.services.slipSlide.preview),
			commit: guard(dependencies.services.slipSlide.commit),
		}),
		rateStretch: Object.freeze({
			preview: guard(dependencies.services.rateStretch.preview),
			commit: guard(dependencies.services.rateStretch.commit),
			commitStep: guard(dependencies.services.rateStretch.commitStep),
		}),
	});
}
