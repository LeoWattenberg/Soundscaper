/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FrequencyWaveformBands, FrequencyWaveformLevel } from './frequency-waveform-contract.ts';

const BANDS = ['low', 'mid', 'high'] as const;

/** Scan each split-band sample only at the finest pyramid scale. */
export function accumulateFrequencyWaveformBandPeaks(
	level: FrequencyWaveformLevel,
	bands: FrequencyWaveformBands<readonly Float32Array[]>,
	firstFrame: number,
): void {
	for (const band of BANDS) {
		for (let channel = 0; channel < bands[band].length; channel++) {
			const samples = bands[band][channel]!;
			const target = level.bands[band][channel]!;
			let offset = 0;
			while (offset < samples.length) {
				const bucket = Math.floor((firstFrame + offset) / level.blockSize);
				const end = Math.min(samples.length, (bucket + 1) * level.blockSize - firstFrame);
				let minimum = target.minimums[bucket]!;
				let maximum = target.maximums[bucket]!;
				for (; offset < end; offset++) {
					minimum = Math.min(minimum, samples[offset]!);
					maximum = Math.max(maximum, samples[offset]!);
				}
				target.minimums[bucket] = minimum;
				target.maximums[bucket] = maximum;
			}
		}
	}
}

/** Extrema are exact under regrouping; combine completed child buckets once. */
export function combineFrequencyWaveformBandPeaks(levels: readonly FrequencyWaveformLevel[]): void {
	for (let index = 1; index < levels.length; index++) {
		const child = levels[index - 1]!;
		const parent = levels[index]!;
		const ratio = parent.blockSize / child.blockSize;
		for (const band of BANDS) {
			for (let channel = 0; channel < child.bands[band].length; channel++) {
				const source = child.bands[band][channel]!;
				const target = parent.bands[band][channel]!;
				for (let bucket = 0; bucket < target.minimums.length; bucket++) {
					let minimum = Infinity;
					let maximum = -Infinity;
					const end = Math.min(source.minimums.length, (bucket + 1) * ratio);
					for (let childBucket = bucket * ratio; childBucket < end; childBucket++) {
						minimum = Math.min(minimum, source.minimums[childBucket]!);
						maximum = Math.max(maximum, source.maximums[childBucket]!);
					}
					target.minimums[bucket] = minimum;
					target.maximums[bucket] = maximum;
				}
			}
		}
	}
}
