/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEbuR128Meter } from './ebu-r128.js';
import { type BextMetadataInput, bextLoudnessOrNull } from './broadcast-wave.ts';

export interface BextLoudnessMeasurementOptions {
	readonly channelWeights?: readonly number[];
}

export function measureBextLoudness(
	channels: readonly Float32Array[],
	sampleRate: number,
	options: BextLoudnessMeasurementOptions = {},
): Readonly<Pick<BextMetadataInput, 'loudnessValue' | 'loudnessRange' | 'maxTruePeakLevel' | 'maxMomentaryLoudness' | 'maxShortTermLoudness'>> {
	const meter = createEbuR128Meter({
		sampleRate,
		channelCount: channels.length,
		channelWeights: options.channelWeights,
		running: true,
	});
	meter.push(channels);
	const value = meter.snapshot().loudness;
	// The meter answers in its own range, which is wider than the chunk's: it
	// floors true peak at -120 dBTP and gates nothing off momentary loudness, so
	// a silent or near-silent programme reports numbers no BEXT field can hold.
	// Those are captured as not measured, because that is what they are.
	return Object.freeze({
		loudnessValue: bextLoudnessOrNull(value.integratedLufs, 'loudnessValue'),
		loudnessRange: bextLoudnessOrNull(value.loudnessRangeLu, 'loudnessRange'),
		maxTruePeakLevel: bextLoudnessOrNull(value.maximumTruePeakDbtp, 'maxTruePeakLevel'),
		maxMomentaryLoudness: bextLoudnessOrNull(value.maximumMomentaryLufs, 'maxMomentaryLoudness'),
		maxShortTermLoudness: bextLoudnessOrNull(value.maximumShortTermLufs, 'maxShortTermLoudness'),
	});
}
