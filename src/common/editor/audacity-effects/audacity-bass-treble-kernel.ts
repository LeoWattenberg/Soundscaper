/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Audacity 3.7.7's Bass and Treble shelving biquad, adapted from commit
 * 5ef610ed23260d6d648175735bb16b32536eb30b:
 * libraries/lib-builtin-effects/BassTrebleBase.cpp by Steve Daulton.
 * Audacity distributes that work under GPL; this modified TypeScript
 * adaptation was created for kw.media in 2026 and selects GPL version 3.
 */

import type { AudacityShelfCoefficients } from './audacity-filter-release.ts';
export { audacityShelfCoefficients, type AudacityShelfCoefficients } from './audacity-filter-release.ts';

export function processAudacityShelfSample(
	input: number,
	coefficient: AudacityShelfCoefficients,
	state: number[],
): number {
	const output = Math.fround((coefficient.b0 * input
		+ coefficient.b1 * state[0]!
		+ coefficient.b2 * state[1]!
		- coefficient.a1 * state[2]!
		- coefficient.a2 * state[3]!) / coefficient.a0);
	state[1] = state[0]!;
	state[0] = input;
	state[3] = state[2]!;
	state[2] = output;
	return output;
}
