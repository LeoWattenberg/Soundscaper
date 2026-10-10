/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTakeCycleRoutedCaptureControls } from '../src/common/editor/controller/recording/internal/take-cycle/take-cycle-routed-capture-controls.ts';
import type { RecordingCaptureControllerLike } from '../src/common/editor/controller/recording/internal/recording-session-service.ts';

test('live microphone controls preserve display audio and retire with their capture', () => {
	const gains: number[] = [];
	const monitoring: boolean[] = [];
	const device = controller(value => gains.push(value), value => monitoring.push(value));
	const display = controller(() => assert.fail('Display audio must retain its input level'),
		() => assert.fail('Display audio must remain unmonitored'));
	let active = true;
	const controls = createTakeCycleRoutedCaptureControls(() => active
		? [{ kind: 'device', controller: device }, { kind: 'display', controller: display }] : null,
		async () => { throw new Error('Unused start'); }, async () => { throw new Error('Unused stop'); });
	controls.setInputGain(0);
	controls.setMonitoring(true);
	controls.setInputGain(.25);
	assert.deepEqual(gains, [0, .25]);
	assert.deepEqual(monitoring, [true]);
	assert.throws(() => controls.setInputGain(Number.NaN), RangeError);
	active = false;
	controls.setInputGain(1);
	controls.setMonitoring(false);
	assert.deepEqual(gains, [0, .25]);
	assert.deepEqual(monitoring, [true]);
	assert.throws(() => controls.pause(), /cannot be paused/u);
	assert.equal(controls.active, false);
});

function controller(
	setInputGain: RecordingCaptureControllerLike['setInputGain'],
	setMonitoring: RecordingCaptureControllerLike['setMonitoring'],
): RecordingCaptureControllerLike {
	return { start() {}, stop() {}, pause: () => false, resume: () => false, setInputGain, setMonitoring };
}
