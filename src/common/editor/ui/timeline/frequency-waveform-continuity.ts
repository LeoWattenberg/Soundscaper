/* SPDX-License-Identifier: AGPL-3.0-only */

import type { WaveformRendering } from '../../design-system-adapters/types.ts';
import type { FrequencyWaveformProjection } from './frequency-waveform-projection.ts';
import { reprojectWaveformRange } from './waveform-plan-continuity.ts';

/** Frequency summaries share the same clip-local frame axis as the ordinary waveform. */
export function reprojectPendingFrequencyWaveform(
	projection: FrequencyWaveformProjection | null | undefined,
	rendering: WaveformRendering,
): FrequencyWaveformProjection | null {
	if (!projection) return null;
	const previous = projection.bands.low;
	const { startFrame, endFrame, pixelWidth } = rendering;
	if (previous.startFrame === startFrame && previous.endFrame === endFrame) return projection;
	const columns = Math.max(1, Math.ceil(pixelWidth));
	const centroidHz = new Float32Array(columns);
	const centroidWeight = new Float32Array(columns);
	for (let column = 0; column < columns; column += 1) {
		const frame = startFrame + (column + 0.5) / columns * (endFrame - startFrame);
		const index = Math.floor((frame - previous.startFrame) / previous.frameCount * projection.centroidHz.length);
		if (index < 0 || index >= projection.centroidHz.length) continue;
		centroidHz[column] = projection.centroidHz[index] ?? 0;
		centroidWeight[column] = projection.centroidWeight[index] ?? 0;
	}
	return {
		...projection,
		bands: {
			low: reprojectWaveformRange(projection.bands.low, startFrame, endFrame, pixelWidth),
			mid: reprojectWaveformRange(projection.bands.mid, startFrame, endFrame, pixelWidth),
			high: reprojectWaveformRange(projection.bands.high, startFrame, endFrame, pixelWidth),
		},
		centroidHz,
		centroidWeight,
	};
}

