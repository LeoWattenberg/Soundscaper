/* SPDX-License-Identifier: AGPL-3.0-only */

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
	const progress = Math.max(0, Math.min(
		1,
		(frame - transition.startFrame) / (transition.endFrame - transition.startFrame),
	));
	return role === 'outgoing' ? 1 - progress : progress;
}
