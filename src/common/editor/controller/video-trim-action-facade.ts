/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FrameCanonicalEdgeTrimPlan,
	FrameCanonicalEdgeTrimRequest,
} from '../frame-canonical-edge-trim-domain.ts';
import type {
	FrameCanonicalRollRippleTrimPlan,
	FrameCanonicalRollRippleTrimRequest,
} from '../frame-canonical-roll-ripple-trim-domain.ts';
import type {
	FrameCanonicalSlipSlidePlan,
	FrameCanonicalSlipSlideRequest,
} from '../frame-canonical-slip-slide-domain.ts';
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
	readonly rollRipple: Readonly<{
		preview(request: FrameCanonicalRollRippleTrimRequest): FrameCanonicalRollRippleTrimPlan;
		commit(request: FrameCanonicalRollRippleTrimRequest): FrameCanonicalRollRippleTrimPlan;
	}>;
	readonly slipSlide: Readonly<{
		buildStepRequest(step: FrameCanonicalSlipSlideStep): Readonly<FrameCanonicalSlipSlideRequest>;
		preview(request: FrameCanonicalSlipSlideRequest): FrameCanonicalSlipSlidePlan;
		commit(request: FrameCanonicalSlipSlideRequest): FrameCanonicalSlipSlidePlan;
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
		rollRipple: Object.freeze({
			preview: guard(dependencies.services.rollRipple.preview),
			commit: guard(dependencies.services.rollRipple.commit),
		}),
		slipSlide: Object.freeze({
			buildStepRequest: guard(dependencies.services.slipSlide.buildStepRequest),
			preview: guard(dependencies.services.slipSlide.preview),
			commit: guard(dependencies.services.slipSlide.commit),
		}),
	});
}
