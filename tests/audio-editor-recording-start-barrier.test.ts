/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createRoutedRecordingController,
	type RecordingCaptureControllerLike,
	type RoutedRecordingSourceSession,
} from '../src/common/editor/controller/recording/internal/recording-session-service.ts';

function capture(startFrame: number) {
	const starts: number[] = [];
	const reschedules: number[] = [];
	let disposals = 0;
	const controller: RecordingCaptureControllerLike = {
		start() { throw new Error('The confirmed path should arm the audio thread.'); },
		async startConfirmed(options) {
			starts.push(options.startFrame);
			return { startFrame };
		},
		async rescheduleConfirmed(options) {
			reschedules.push(options.startFrame);
			return { startFrame: options.startFrame };
		},
		pause() { return true; }, resume() { return true; },
		async stop() {}, async dispose() { disposals += 1; },
		setMonitoring() {}, setInputGain() {},
	};
	return { controller, starts, reschedules, get disposals() { return disposals; } };
}

test('routed recording confirms one shared audio frame before playback can start', async () => {
	const first = capture(1_000);
	const second = capture(1_256);
	const sessions: RoutedRecordingSourceSession[] = [first, second].map(({ controller }) => ({
		kind: 'device', controller, disconnected: false, stopped: false,
		startFrame: 1_000, stopFrame: 2_000,
	}));
	const routed = createRoutedRecordingController(sessions);
	const confirmed = await routed.startConfirmed();
	assert.equal(confirmed, 1_256);
	assert.deepEqual(first.starts, [1_000]);
	assert.deepEqual(second.starts, [1_000]);
	assert.deepEqual(first.reschedules, [1_256]);
	assert.deepEqual(second.reschedules, []);
	assert.deepEqual(sessions.map(({ startFrame, stopFrame }) => ({ startFrame, stopFrame })), [
		{ startFrame: 1_256, stopFrame: 2_256 },
		{ startFrame: 1_256, stopFrame: 2_256 },
	]);
	assert.equal(routed.state, 'recording');
	await routed.dispose();
});

test('a late input acknowledgement delays playback until the other input moves to its frame', async () => {
	const first = capture(1_000);
	const second = capture(1_256);
	let acknowledgeLate: () => void = () => { throw new Error('Late input was not armed.'); };
	const lateAck = new Promise<void>((resolve) => { acknowledgeLate = resolve; });
	second.controller.startConfirmed = async (options) => {
		second.starts.push(options.startFrame);
		await lateAck;
		return { startFrame: 1_256 };
	};
	const sessions: RoutedRecordingSourceSession[] = [first, second].map(({ controller }) => ({
		kind: 'device', controller, disconnected: false, stopped: false,
		startFrame: 1_000, stopFrame: 2_000,
	}));
	const routed = createRoutedRecordingController(sessions);
	const pending = routed.startConfirmed();
	await Promise.resolve();
	assert.deepEqual(first.reschedules, []);
	assert.equal(routed.state, 'ready');
	acknowledgeLate();
	assert.equal(await pending, 1_256);
	assert.deepEqual(first.reschedules, [1_256]);
	assert.equal(routed.state, 'recording');
	await routed.dispose();
});

test('a rejected shared-frame move leaves all armed inputs available for cleanup', async () => {
	const first = capture(1_000);
	const second = capture(1_256);
	first.controller.rescheduleConfirmed = async () => {
		throw new Error('Recording is already capturing and cannot be rescheduled.');
	};
	const sessions: RoutedRecordingSourceSession[] = [first, second].map(({ controller }) => ({
		kind: 'device', controller, disconnected: false, stopped: false,
		startFrame: 1_000, stopFrame: 2_000,
	}));
	const routed = createRoutedRecordingController(sessions);
	await assert.rejects(routed.startConfirmed(), /already capturing/u);
	await routed.dispose();
	assert.equal(first.disposals, 1);
	assert.equal(second.disposals, 1);
	assert.equal(routed.state, 'disposed');
});
