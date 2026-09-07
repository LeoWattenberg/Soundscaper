/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	compileInterpolationCurve,
	evaluateInterpolationCurveAtExactPosition,
} from './interpolation-curve.ts';
import { multiplyDivideRationals } from './timeline-time.ts';

const PREVIEW_CURVES = new WeakMap();

/** Resolve maintained transition opacity, preferring an exact product plan weight. */
export function resolveVideoTransitionPreviewOpacity(options, transition, clip, role, frame) {
	if (transition == null) return 1;
	if (typeof options.resolveTransitionWeight === 'function') {
		const exact = options.resolveTransitionWeight(clip.id, frame);
		if (exact !== null && exact !== undefined) {
			if (!Number.isFinite(exact) || exact < 0 || exact > 1) {
				throw new RangeError('An exact video transition weight must be between zero and one.');
			}
			return exact;
		}
	}
	const overlapFrames = transition.endFrame - transition.startFrame;
	const localFrame = Math.max(0, Math.min(overlapFrames, frame - transition.startFrame));
	const curve = transition.curve == null ? null : previewCurve(transition.curve);
	const progress = curve == null
		? localFrame / overlapFrames
		: evaluateInterpolationCurveAtExactPosition(curve, curveDomainPosition(curve, localFrame, overlapFrames));
	if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
		throw new RangeError('An authored video transition weight must be between zero and one.');
	}
	return role === 'outgoing' ? 1 - progress : progress;
}

/**
 * Rescale an overlap offset into the curve's own authored domain.
 *
 * A transition's `startFrame`/`endFrame` describe the overlap in whatever domain the
 * timeline was projected into — project samples for a sequence-coordinate document —
 * while an authored curve is written over the sequence frames it was authored for and
 * ends at its exact `durationFrames` anchor. Querying the curve with a raw sample offset
 * would clamp to that final anchor within a fraction of a millisecond, turning an
 * authored dissolve into a hard cut, so the offset is mapped exactly onto the curve's
 * own span. When the two domains already agree the mapping is the identity.
 */
function curveDomainPosition(curve, localFrame, overlapFrames) {
	const domain = curve.anchors.at(-1).position;
	if (!(overlapFrames > 0)) return localFrame;
	return multiplyDivideRationals(localFrame, domain, overlapFrames);
}

function previewCurve(value) {
	if (!value || typeof value !== 'object') return compileInterpolationCurve(value);
	let compiled = PREVIEW_CURVES.get(value);
	if (compiled) return compiled;
	compiled = compileInterpolationCurve(value);
	PREVIEW_CURVES.set(value, compiled);
	return compiled;
}
