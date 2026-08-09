/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createSoundActivatedRecordingGate,
	normalizeSoundActivationSettings,
} from '../src/common/editor/controller/sound-activated-recording-gate.ts';

function mono(...samples: number[]): readonly Float32Array[] {
	return [Float32Array.from(samples)];
}

test('sound activation settings are closed, bounded, canonical, and immutable', () => {
	const settings = normalizeSoundActivationSettings({
		thresholdDb: -24,
		hysteresisDb: 6,
		holdFrames: 2,
	});
	assert.deepEqual(settings, { thresholdDb: -24, hysteresisDb: 6, holdFrames: 2 });
	assert.equal(Object.isFrozen(settings), true);
	assert.throws(() => normalizeSoundActivationSettings({
		thresholdDb: -24,
		hysteresisDb: 6,
		holdFrames: 2,
		unknown: true,
	}), /unknown/);
	for (const invalid of [
		{ thresholdDb: -101, hysteresisDb: 6, holdFrames: 2 },
		{ thresholdDb: 1, hysteresisDb: 6, holdFrames: 2 },
		{ thresholdDb: -0, hysteresisDb: 6, holdFrames: 2 },
		{ thresholdDb: -24, hysteresisDb: -1, holdFrames: 2 },
		{ thresholdDb: -24, hysteresisDb: -0, holdFrames: 2 },
		{ thresholdDb: -24, hysteresisDb: 25, holdFrames: 2 },
		{ thresholdDb: -24, hysteresisDb: 6, holdFrames: -0 },
		{ thresholdDb: -24, hysteresisDb: 6, holdFrames: 1.5 },
	]) assert.throws(() => normalizeSoundActivationSettings(invalid), /sound activation/i);
	assert.throws(() => normalizeSoundActivationSettings(Object.assign(new Date(), settings)), /settings/i);
});

test('armed recording starts at threshold and uses hysteresis without chatter', () => {
	const gate = createSoundActivatedRecordingGate({ thresholdDb: -20, hysteresisDb: 6, holdFrames: 0 });
	assert.equal(gate.state, 'disarmed');
	assert.equal(gate.arm(), true);
	assert.equal(gate.arm(), false);

	const result = gate.process(mono(0.01, 0.1, 0.06, 0.06, 0.01, 0.2));
	assert.deepEqual(result.ranges, [
		{ startFrame: 1, endFrame: 4 },
		{ startFrame: 5, endFrame: 6 },
	]);
	assert.deepEqual(result.transitions, [
		{ type: 'activated', frameOffset: 1 },
		{ type: 'suspended', frameOffset: 4 },
		{ type: 'activated', frameOffset: 5 },
	]);
	assert.equal(result.state, 'capturing');
	assert.equal(gate.state, 'capturing');
});

test('hold captures an exact trailing frame budget across chunk boundaries', () => {
	const gate = createSoundActivatedRecordingGate({ thresholdDb: -20, hysteresisDb: 6, holdFrames: 3 });
	gate.arm();
	assert.deepEqual(gate.process(mono(0.2, 0.01, 0.01)).ranges, [{ startFrame: 0, endFrame: 3 }]);
	const suspended = gate.process(mono(0.01, 0.01, 0.2));
	assert.deepEqual(suspended.ranges, [
		{ startFrame: 0, endFrame: 1 },
		{ startFrame: 2, endFrame: 3 },
	]);
	assert.deepEqual(suspended.transitions, [
		{ type: 'suspended', frameOffset: 1 },
		{ type: 'activated', frameOffset: 2 },
	]);
	assert.equal(gate.state, 'capturing');
});

test('pause, resume, cancellation, and re-arming never leak captured ranges', () => {
	const gate = createSoundActivatedRecordingGate({ thresholdDb: -30, hysteresisDb: 3, holdFrames: 4 });
	gate.arm();
	gate.process(mono(1));
	assert.equal(gate.pause(), true);
	assert.equal(gate.pause(), false);
	assert.deepEqual(gate.process(mono(1, 1)).ranges, []);
	assert.equal(gate.resume(), true);
	assert.equal(gate.resume(), false);
	assert.deepEqual(gate.process(mono(0, 1)).ranges, [{ startFrame: 1, endFrame: 2 }]);
	assert.equal(gate.cancel(), true);
	assert.equal(gate.cancel(), false);
	assert.deepEqual(gate.process(mono(1)).ranges, []);
	assert.equal(gate.arm(), true);
	assert.deepEqual(gate.process(mono(1)).ranges, [{ startFrame: 0, endFrame: 1 }]);
});

test('processing validates channel geometry before changing gate state', () => {
	const gate = createSoundActivatedRecordingGate({ thresholdDb: -20, hysteresisDb: 6, holdFrames: 0 });
	gate.arm();
	assert.throws(() => gate.process([]), /channel/i);
	assert.throws(() => gate.process([new Float32Array(2), new Float32Array(1)]), /length/i);
	assert.equal(gate.state, 'armed');
	assert.deepEqual(gate.process([new Float32Array([Number.NaN, 0.2])]).ranges, [
		{ startFrame: 1, endFrame: 2 },
	]);
});
