/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createRoutedRecordingController,
	type RecordingCaptureControllerLike,
} from '../src/common/editor/controller/recording-session-service.ts';
import { createSoundActivatedRecordingCaptureSession } from '../src/common/editor/controller/sound-activated-recording-capture-session.ts';

const SETTINGS = Object.freeze({
	thresholdDb: -20,
	hysteresisDb: 6,
	holdFrames: 0,
});

test('routed transition rollback keeps gates, source controllers, and coordinator in parity', () => {
	const sources = Array.from({ length: 3 }, (_, index) => createWrappedSoundActivationSource(index));
	const sessions = sources.map(({ controller }, index) => ({
		kind: 'device' as const,
		controller,
		disconnected: false,
		stopped: false,
		startFrame: 100 + index,
	}));
	const routed = createRoutedRecordingController(sessions);
	routed.start();
	sources[1]?.setPauseFailure('false');
	assert.equal(routed.pause(), false);
	assert.equal(routed.state, 'recording');
	assert.deepEqual(sources.map(({ controllerState }) => controllerState()), [
		'recording',
		'recording',
		'recording',
	]);
	assert.deepEqual(sources.map(({ session }) => session.state), ['armed', 'armed', 'armed']);

	sources[1]?.setPauseFailure(null);
	assert.equal(routed.pause(), true);
	assert.equal(routed.state, 'paused');
	assert.deepEqual(sources.map(({ session }) => session.state), ['paused', 'paused', 'paused']);
	sources[1]?.setResumeFailure('throw');
	assert.throws(() => routed.resume(), /resume failure/iu);
	assert.equal(routed.state, 'paused');
	assert.deepEqual(sources.map(({ controllerState }) => controllerState()), ['paused', 'paused', 'paused']);
	assert.deepEqual(sources.map(({ session }) => session.state), ['paused', 'paused', 'paused']);
});

function createWrappedSoundActivationSource(index: number) {
	let state = 'ready';
	let pauseFailure: 'false' | 'throw' | null = null;
	let resumeFailure: 'false' | 'throw' | null = null;
	const underlying: RecordingCaptureControllerLike = {
		get state() { return state; },
		start() { state = 'recording'; },
		pause() {
			if (pauseFailure === 'throw') throw new Error('pause failure');
			if (pauseFailure === 'false') return false;
			if (state !== 'recording') return false;
			state = 'paused';
			return true;
		},
		resume() {
			if (resumeFailure === 'throw') throw new Error('resume failure');
			if (resumeFailure === 'false') return false;
			if (state !== 'paused') return false;
			state = 'recording';
			return true;
		},
		async stop() { state = 'stopped'; },
		setMonitoring() {},
		setInputGain() {},
	};
	const session = createSoundActivatedRecordingCaptureSession({
		getSettings: () => SETTINGS,
		setState() {},
	}, {
		sourceKey: `device:${index}`,
		kind: 'device',
		sampleRate: 48_000,
		channelCount: 1,
	}, () => true);
	return {
		session,
		controller: session.wrapController(underlying),
		controllerState: () => state,
		setPauseFailure(value: 'false' | 'throw' | null) { pauseFailure = value; },
		setResumeFailure(value: 'false' | 'throw' | null) { resumeFailure = value; },
	};
}
