import assert from 'node:assert/strict';
import test from 'node:test';

import {
	formatProjectBinDuration,
	projectBinPeakRanges,
} from '../src/common/editor/ui/workspace/project-bin-model.ts';

test('project-bin duration carries rounded seconds into the next minute', () => {
	assert.equal(formatProjectBinDuration(5_996, 100, 'en-US'), '1:00.0');
	assert.equal(formatProjectBinDuration(3_599_960, 1_000, 'en-US'), '60:00.0');
});

test('project-bin waveform fallback preserves opposite-polarity stereo peaks', () => {
	const channels = [new Float32Array([1, 0, -1]), new Float32Array([-1, 0, 1])];
	const ranges = projectBinPeakRanges({
		buffer: {
			length: 3,
			numberOfChannels: channels.length,
			getChannelData: (channel) => channels[channel],
		},
	}, { id: 'stereo', sourceDurationFrames: 3 }, 3);

	assert.deepEqual(ranges, [
		{ minimum: -1, maximum: 1 },
		{ minimum: 0, maximum: 0 },
		{ minimum: -1, maximum: 1 },
	]);
});
