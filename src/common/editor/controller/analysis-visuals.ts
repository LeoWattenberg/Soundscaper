/* SPDX-License-Identifier: AGPL-3.0-only */

import { mixToMono } from './waveform-analysis.ts';

export interface EditorAnalysisVisuals {
	readonly spectrum: Readonly<{
		readonly samples: Float32Array;
		readonly sampleRate: number;
		readonly startFrame: number;
	}>;
	readonly overview: Readonly<{
		readonly samples: Float32Array;
		readonly sampleRate: number;
		readonly step: number;
	}>;
}

export function createEditorAnalysisVisuals(
	channels: readonly Float32Array[],
	sampleRate: number,
): Readonly<EditorAnalysisVisuals> {
	const length = channels[0]?.length || 0;
	const spectrumFrames = Math.min(length, 16_384);
	const spectrumStart = Math.max(0, Math.floor((length - spectrumFrames) / 2));
	const spectrum = mixToMono(channels.map((channel) => (
		channel.subarray(spectrumStart, spectrumStart + spectrumFrames)
	)));
	const step = Math.max(1, Math.ceil(length / 131_072));
	const overview = new Float32Array(Math.ceil(length / step));
	for (let index = 0; index < overview.length; index += 1) {
		const frame = Math.min(length - 1, index * step);
		for (const channel of channels) overview[index] += (channel[frame] || 0) / channels.length;
	}
	return Object.freeze({
		spectrum: Object.freeze({ samples: spectrum, sampleRate, startFrame: spectrumStart }),
		overview: Object.freeze({ samples: overview, sampleRate: sampleRate / step, step }),
	});
}
