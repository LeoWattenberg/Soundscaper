/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TimelineWaveformClip } from './waveform-view-model.ts';

/** Keep FFT context around the painted clip range without changing its pixel timing. */
export function spectrogramPcmContextClip(
	clip: TimelineWaveformClip,
	fftWindowSize: number,
): TimelineWaveformClip {
	const halfWindow = Math.floor(Math.min(8_192, Math.max(0, fftWindowSize)) / 2);
	return {
		...clip,
		waveformStartFrame: Math.max(0, clip.waveformStartFrame - halfWindow),
		waveformEndFrame: Math.min(clip.durationFrames, clip.waveformEndFrame + halfWindow),
	};
}
