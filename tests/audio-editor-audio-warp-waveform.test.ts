/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareAudioWarpWaveformWindow } from '../src/common/editor/ui/timeline/audio-warp-waveform.ts';

test('warped waveform columns consume the shared source map instead of linear clip stretch', () => {
	const project = {
		sampleRate: 4,
		tempoMap: {
			mode: 'musical' as const,
			events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
		},
	};
	const clip = {
		id: 'clip', kind: 'audio', anchor: 'sample', timelineStartFrame: 0,
		durationFrames: 4, sourceStartFrame: 0, sourceDurationFrames: 8,
		gain: 1, fadeInFrames: 0, fadeOutFrames: 0,
		warpMap: {
			feature: 'audio-warp' as const,
			points: [
				{ outer: 0, source: 0, mode: 'forward' as const },
				{ outer: 2, source: 1, mode: 'forward' as const },
				{ outer: 4, source: 8, mode: 'forward' as const },
			],
		},
	};
	const prepared = prepareAudioWarpWaveformWindow(
		project,
		clip,
		[Float32Array.from({ length: 8 }, (_, index) => index / 10)],
		{ startFrame: 0, endFrame: 4, pixelWidth: 4, maxSamples: 8, sourceFrameOffset: 0 },
	);
	assert.equal(prepared.rendering?.mode, 'summary');
	const channel = prepared.rendering?.channels[0] as Readonly<{
		minimum: Float32Array;
		maximum: Float32Array;
	}>;
	const rounded = (values: Float32Array) => [...values].map((value) => Math.round(value * 10) / 10);
	assert.deepEqual(rounded(channel.minimum), [0, 0, 0.1, 0.4]);
	assert.deepEqual(rounded(channel.maximum), [0, 0, 0.4, 0.7]);
	assert.equal(prepared.sampleCount, 8);
});
