/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * The shared lookahead geometry used by Audacity 3.7.7's Compressor and
 * Limiter, adapted from commit 5ef610ed23260d6d648175735bb16b32536eb30b:
 * libraries/lib-dynamic-range-processor/CompressorProcessor.cpp and
 * SimpleCompressor/LookAheadGainReduction.cpp.
 *
 * Named upstream contributors include Matthieu Hodgkinson and Daniel Rudrich.
 * SimpleCompressor is Copyright (c) 2019 Daniel Rudrich and is distributed
 * under GPL version 3. This modified TypeScript adaptation was created for
 * kw.media in 2026.
 */

export function audacityDynamicsLookaheadFrames(lookaheadMs: number, sampleRate: number): number {
	return Math.trunc(lookaheadMs * sampleRate / 1_000);
}

export function applyAudacityLookaheadEnvelopeInPlace(
	envelope: Float64Array,
	lookaheadFrames: number,
	endExclusive: number,
): void {
	let nextGainReduction = 0;
	let step = 0;
	for (let index = endExclusive - 1; index >= 0; index -= 1) {
		const sample = envelope[index]!;
		if (sample > nextGainReduction) {
			envelope[index] = nextGainReduction;
			nextGainReduction += step;
		} else {
			step = -sample / lookaheadFrames;
			nextGainReduction = sample + step;
		}
	}
}
