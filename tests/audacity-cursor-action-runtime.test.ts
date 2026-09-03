/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	audacityLongSeekFrame,
	audacitySelectionForAdjustment,
	audacityShortSeekFrame,
	audacityTimelinePixelFrames,
	audacityTimelineStepFrame,
	createAudacityCursorActionRuntime,
} from '../src/common/editor/audacity-action-runtime-helpers.ts';

test('Audacity cursor periods convert the one- and fifteen-second defaults to project frames', () => {
	assert.equal(audacityShortSeekFrame(1_000_000, 48_000, -1), 952_000);
	assert.equal(audacityShortSeekFrame(1_000_000, 48_000, 1), 1_048_000);
	assert.equal(audacityLongSeekFrame(1_000_000, 48_000, -1), 280_000);
	assert.equal(audacityLongSeekFrame(1_000_000, 48_000, 1), 1_720_000);
	assert.equal(audacityLongSeekFrame(10, 48_000, -1), 0);
	assert.equal(audacityTimelinePixelFrames(48_000, 120), 400);
	assert.equal(audacityTimelinePixelFrames(48_000, 120, 10), 4_000);
	assert.equal(audacityTimelinePixelFrames(48_000, 96_000), 1);
	assert.equal(audacityTimelineStepFrame(130_000, -1, {
		sampleRate: 48_000, snap: { enabled: true, unit: 'seconds' },
	}, 120), 96_000);
	assert.equal(audacityTimelineStepFrame(130_000, 1, {
		sampleRate: 48_000, snap: { enabled: true, unit: 'seconds' },
	}, 120), 192_000);
});

test('an empty selection starts extending at the live editing cursor', () => {
	assert.deepEqual(
		audacitySelectionForAdjustment({ startFrame: 0, endFrame: 0 }, 96_000),
		{ startFrame: 96_000, endFrame: 96_000 },
	);
	assert.deepEqual(
		audacitySelectionForAdjustment({ startFrame: 4, endFrame: 8 }, 96_000),
		{ startFrame: 4, endFrame: 8 },
	);
});

test('Audacity cursor actions keep stopped stepping distinct from timed playback seeking', () => {
	const state = { positionFrame: 1_000_000, transportState: 'stopped' };
	const seeks: number[] = [];
	const selections: [number, number][] = [];
	const runtime = createAudacityCursorActionRuntime({
		actions: { transport: { seek: (frame: number) => seeks.push(frame) } },
		getTelemetrySnapshot: () => state,
	}, () => ({ sampleRate: 48_000 }), (startFrame, endFrame) => {
		selections.push([startFrame, endFrame]);
	}, (frame, direction) => audacityTimelineStepFrame(frame, direction, {
		sampleRate: 48_000, snap: { enabled: false },
	}, 120));

	runtime.nudgePlayheadLeft();
	assert.deepEqual(seeks, [999_600], 'stopped Left moves by one visible timeline pixel');
	assert.deepEqual(selections, [[999_600, 999_600]], 'stopped movement relocates the editing cursor');

	state.transportState = 'playing';
	runtime.nudgePlayheadRight();
	assert.deepEqual(seeks, [999_600, 1_048_000], 'playing Right uses Audacity\'s one-second short seek');
	assert.equal(selections.length, 1, 'playback seeking does not change the editing selection');

	state.transportState = 'stopped';
	runtime.cursorShortJumpLeft();
	runtime.cursorLongJumpRight();
	assert.deepEqual(seeks.slice(-2), [952_000, 1_720_000]);
	assert.deepEqual(selections.slice(-2), [[952_000, 952_000], [1_720_000, 1_720_000]]);

	state.transportState = 'playing';
	runtime.cursorLongJumpLeft();
	assert.equal(seeks.at(-1), 280_000);
	assert.equal(selections.length, 3);
	assert.ok(Object.isFrozen(runtime));
});
