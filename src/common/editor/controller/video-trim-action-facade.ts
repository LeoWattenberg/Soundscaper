/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FrameCanonicalEdgeTrimPlan,
	FrameCanonicalEdgeTrimRequest,
} from '../frame-canonical-edge-trim-domain.ts';
import type {
	FrameCanonicalRollRippleTrimPlan,
	FrameCanonicalRollRippleTrimRequest,
} from '../frame-canonical-roll-ripple-trim-domain.ts';
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
}

/** Preserve ordinary trim ports and capability-gate the nested roll/ripple ports identically. */
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
	});
}
