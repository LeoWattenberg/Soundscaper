/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { filterSoundActivatedRecordingChunk } from '../src/common/editor/controller/sound-activated-recording-chunk.ts';
import { createSoundActivatedRecordingGate } from '../src/common/editor/controller/sound-activated-recording-gate.ts';

test('filters one recorder chunk into exact absolute active segments', () => {
	const gate = createSoundActivatedRecordingGate({ thresholdDb: -20, hysteresisDb: 6, holdFrames: 0 });
	gate.arm();
	const left = Float32Array.from([0, 0.5, 0, 0.25]);
	const right = Float32Array.from([0, -0.4, 0, -0.2]);
	const result = filterSoundActivatedRecordingChunk(gate, {
		frameStart: 100,
		frames: 4,
		channels: [left, right],
	});
	assert.deepEqual(result.transitions, [
		{ type: 'activated', frame: 101 },
		{ type: 'suspended', frame: 102 },
		{ type: 'activated', frame: 103 },
	]);
	assert.deepEqual(result.segments.map(({ frameStart, frames, channels }) => ({
		frameStart,
		frames,
		channels: channels.map((channel) => [...channel]),
	})), [
		{ frameStart: 101, frames: 1, channels: [[left[1]], [right[1]]] },
		{ frameStart: 103, frames: 1, channels: [[left[3]], [right[3]]] },
	]);
	assert.notStrictEqual(result.segments[0]?.channels[0], left);
	assert.deepEqual([...left], [0, 0.5, 0, 0.25]);
	assert.equal(Object.isFrozen(result), true);
	assert.equal(Object.isFrozen(result.segments), true);
	assert.equal(Object.isFrozen(result.transitions), true);
});

test('returns no PCM while armed below threshold and preserves gate state on malformed geometry', () => {
	const gate = createSoundActivatedRecordingGate({ thresholdDb: -20, hysteresisDb: 6, holdFrames: 4 });
	gate.arm();
	assert.deepEqual(filterSoundActivatedRecordingChunk(gate, {
		frameStart: 0,
		frames: 2,
		channels: [Float32Array.from([0, 0])],
	}).segments, []);
	assert.equal(gate.state, 'armed');
	assert.throws(() => filterSoundActivatedRecordingChunk(gate, {
		frameStart: 2,
		frames: 3,
		channels: [Float32Array.from([1, 1])],
	}), /frame count/iu);
	assert.throws(() => filterSoundActivatedRecordingChunk(gate, {
		frameStart: -1,
		frames: 2,
		channels: [Float32Array.from([1, 1])],
	}), /start frame/iu);
	assert.equal(gate.state, 'armed');
});
