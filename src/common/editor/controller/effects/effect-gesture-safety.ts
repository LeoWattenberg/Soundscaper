/* SPDX-License-Identifier: AGPL-3.0-only */

export const EFFECT_GESTURE_TARGET_CHANGED_CODE = 'EFFECT_GESTURE_TARGET_CHANGED' as const;

/**
 * Raised when a control gesture outlives the effect instance it started from.
 * Callers can distinguish this from invalid effect parameters without parsing
 * localized UI copy.
 */
export class EffectGestureTargetChangedError extends Error {
	readonly code = EFFECT_GESTURE_TARGET_CHANGED_CODE;

	constructor() {
		super('The effect changed before its control gesture completed.');
		this.name = 'EffectGestureTargetChangedError';
	}
}

export function effectParametersMatch(
	left: Readonly<Record<string, unknown>>,
	right: Readonly<Record<string, unknown>>,
): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
