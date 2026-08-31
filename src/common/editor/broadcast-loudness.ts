/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEbuR128Meter } from './ebu-r128.js';
import type { BextMetadataInput } from './broadcast-wave.ts';

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
	return Object.freeze({
		loudnessValue: finite(value.integratedLufs),
		loudnessRange: finite(value.loudnessRangeLu),
		maxTruePeakLevel: finite(value.maximumTruePeakDbtp),
		maxMomentaryLoudness: finite(value.maximumMomentaryLufs),
		maxShortTermLoudness: finite(value.maximumShortTermLufs),
	});
}

function finite(value: unknown): number | null {
	return Number.isFinite(value) ? Number(value) : null;
}
