/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { clipLoopUpdateFields } from '../src/common/editor/audio-clip-loop.ts';
import { createAudioClip } from '../src/common/editor/project-media-factory.ts';
import { projectBinPeakRanges } from '../src/common/editor/ui/workspace/project-bin-model.ts';

for (const cached of [false, true]) {
	for (const [offset, reversed, expected] of [
		[0, false, [1, 1, 0, 0, 1, 1, 0, 0]],
		[2, false, [0, 0, 1, 1, 0, 0, 1, 1]],
		[0, true, [0, 0, 1, 1, 0, 0, 1, 1]],
	] as const) {
		test(`bin loop waveform retains repeat and phase ${offset}, reverse ${reversed}, cached ${cached}`, () => {
			const samples = Float32Array.of(1, 1, 0, 0);
			const base = createAudioClip({ id: 'phrase', sourceId: 'recording', durationFrames: 4,
				sourceStartFrame: 0, sourceDurationFrames: 4, reversed });
			const clip = { ...base, binItemId: base.binItemId ?? undefined, ...clipLoopUpdateFields({ ...base, durationFrames: 4,
				sourceStartFrame: 0, sourceDurationFrames: 4 }, { periodFrames: 4, offsetFrames: offset, durationFrames: 8 }) };
			const original = structuredClone(clip);
			const visual = cached ? { peaks: { levels: [{ blockSize: 1,
				channels: [{ minimums: samples, maximums: samples }] }] } }
				: { buffer: { length: 4, numberOfChannels: 1, getChannelData: () => samples } };
			const ranges = projectBinPeakRanges(visual, clip, 8);
			assert.deepEqual(ranges, expected.map(value => ({ minimum: value, maximum: value })));
			assert.deepEqual(projectBinPeakRanges(visual, clip, 1), [{ minimum: 0, maximum: 1 }]);
			assert.deepEqual(clip, original);
			assert.deepEqual(samples, Float32Array.of(1, 1, 0, 0));
		});
	}
}
