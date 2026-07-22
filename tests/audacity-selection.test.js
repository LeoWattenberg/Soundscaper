import test from 'node:test';
import assert from 'node:assert/strict';

import {
	audacitySelectionChannelCount,
	matchAudacitySelectionChannels,
} from '../src/common/editor/audacity-selection.js';

const PROJECT = {
	sources: [
		{ id: 'mono-a', channelCount: 1 },
		{ id: 'mono-b', channelCount: 1 },
		{ id: 'stereo', channelCount: 2 },
	],
	clips: [
		{ id: 'clip-mono-a', sourceId: 'mono-a', timelineStartFrame: 0, durationFrames: 100 },
		{ id: 'clip-mono-b', sourceId: 'mono-b', timelineStartFrame: 150, durationFrames: 100 },
		{ id: 'clip-stereo', sourceId: 'stereo', timelineStartFrame: 300, durationFrames: 100 },
		{ id: 'clip-other-stereo', sourceId: 'stereo', timelineStartFrame: 0, durationFrames: 400 },
	],
	tracks: [
		{ id: 'target', clipIds: ['clip-mono-a', 'clip-mono-b', 'clip-stereo'] },
		{ id: 'other', clipIds: ['clip-other-stereo'] },
	],
};

test('Audacity selection layout stays mono across mono clips and gaps, but any overlapping stereo clip promotes the range', () => {
	assert.equal(audacitySelectionChannelCount(PROJECT, 'target', 0, 250), 1);
	assert.equal(audacitySelectionChannelCount(PROJECT, 'target', 0, 400), 2);
	assert.equal(audacitySelectionChannelCount(PROJECT, 'target', 200, 320), 2);
	assert.equal(audacitySelectionChannelCount(PROJECT, 'target', 100, 150), 0);
	assert.equal(audacitySelectionChannelCount(PROJECT, 'target', 0, 100), 1);
	assert.equal(audacitySelectionChannelCount(PROJECT, 'missing', 0, 400), 0);
});

test('Audacity selection renders are copied into their resolved mono or stereo layout', () => {
	const left = Float32Array.of(0.1, 0.2);
	const right = Float32Array.of(-0.1, -0.2);
	const mono = matchAudacitySelectionChannels([left, right], 1);
	assert.equal(mono.length, 1);
	assert.deepEqual(mono[0], left);
	assert.notStrictEqual(mono[0], left);

	const stereo = matchAudacitySelectionChannels([left, right], 2);
	assert.equal(stereo.length, 2);
	assert.deepEqual(stereo, [left, right]);
	assert.notStrictEqual(stereo[0], left);
	assert.notStrictEqual(stereo[1], right);

	const upmixed = matchAudacitySelectionChannels([left], 2);
	assert.deepEqual(upmixed, [left, left]);
	assert.notStrictEqual(upmixed[0], upmixed[1]);
	assert.throws(() => matchAudacitySelectionChannels([], 1), /PCM channels/);
	assert.throws(() => matchAudacitySelectionChannels([left], 3), /one or two channels/);
});
