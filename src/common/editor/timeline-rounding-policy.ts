/* SPDX-License-Identifier: AGPL-3.0-only */

export type TimeRoundingPolicy = 'point' | 'enclosingStart' | 'enclosingEnd' | 'directional';
export type TimeRoundingDirection = 'previous' | 'next';

/** Resolve public boundary semantics to one exact integer-ratio operation. */
export function roundingPolicy(
	policy: TimeRoundingPolicy,
	direction?: TimeRoundingDirection,
): 'point' | 'floor' | 'ceil' {
	if (policy === 'point') return 'point';
	if (policy === 'enclosingStart') return 'floor';
	if (policy === 'enclosingEnd') return 'ceil';
	if (policy === 'directional') {
		if (direction === 'previous') return 'floor';
		if (direction === 'next') return 'ceil';
		throw new RangeError('Directional rounding requires a previous or next direction.');
	}
	throw new RangeError(`Unsupported timeline rounding policy: ${String(policy)}.`);
}
