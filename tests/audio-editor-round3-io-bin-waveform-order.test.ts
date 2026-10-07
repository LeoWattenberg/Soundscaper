/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { projectBinPeakRanges, projectBinWaveformPath } from '../src/common/editor/ui/workspace/project-bin-model.ts';

const channels = [Float32Array.of(0.9, 0.9, 0.5, -0.5, 0.25, -0.25, 0, 0, 0.9, 0.9)];
const clip = { id: 'phrase-then-pause', sourceStartFrame: 2, sourceDurationFrames: 6, reversed: true };

for (const precomputed of [false, true]) {
	test(`reversed bin waveform follows its retained source window with ${precomputed ? 'cached peaks' : 'PCM fallback'}`, () => {
		const visual = precomputed
			? { peaks: { levels: [{ blockSize: 1, channels: [{ minimums: channels[0]!, maximums: channels[0]! }] }] } }
			: { buffer: { length: 10, numberOfChannels: 1, getChannelData: () => channels[0]! } };
		const before = new Float32Array(channels[0]!);
		const forward = projectBinPeakRanges(visual, { ...clip, reversed: false }, 6);
		const reversed = projectBinPeakRanges(visual, clip, 6);
		assert.deepEqual(reversed, [...forward].reverse());
		assert.deepEqual(reversed[0], { minimum: 0, maximum: 0 });
		assert.deepEqual(reversed[5], { minimum: 0.5, maximum: 0.5 });
		assert.deepEqual(channels[0], before);
		assert.equal(clip.sourceStartFrame, 2);
		assert.match(projectBinWaveformPath(visual, clip, 160, 44), /^M0\.00 22\.00V22\.00/u);
	});
}
