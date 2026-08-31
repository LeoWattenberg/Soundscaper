/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	compileInterpolationCurve,
	evaluateInterpolationCurveAtExactPosition,
} from './interpolation-curve.ts';

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
	const localFrame = Math.max(0, Math.min(
		transition.endFrame - transition.startFrame,
		frame - transition.startFrame,
	));
	const progress = transition.curve == null ? localFrame / (
		transition.endFrame - transition.startFrame
	) : evaluateInterpolationCurveAtExactPosition(previewCurve(transition.curve), localFrame);
	if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
		throw new RangeError('An authored video transition weight must be between zero and one.');
	}
	return role === 'outgoing' ? 1 - progress : progress;
}

function previewCurve(value) {
	if (!value || typeof value !== 'object') return compileInterpolationCurve(value);
	let compiled = PREVIEW_CURVES.get(value);
	if (compiled) return compiled;
	compiled = compileInterpolationCurve(value);
	PREVIEW_CURVES.set(value, compiled);
	return compiled;
}
