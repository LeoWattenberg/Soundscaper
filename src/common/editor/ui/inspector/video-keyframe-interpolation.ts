/* SPDX-License-Identifier: AGPL-3.0-only */

const CONTINUOUS_KINDS = ['hold', 'linear', 'eased', 'bezier'] as const;
const INTEGER_KINDS = ['hold'] as const;

/** Integer target values cannot traverse fractional interpolation segments. */
export function videoKeyframeInterpolationKinds(integer: boolean): readonly typeof CONTINUOUS_KINDS[number][] {
	return integer ? INTEGER_KINDS : CONTINUOUS_KINDS;
}
