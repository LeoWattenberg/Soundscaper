/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeRecordingRouting } from '../src/common/editor/recording-routing.js';
import {
	createTrackAudioRecordingStatePort,
	reconcileControllerRecordingRouting,
} from '../src/common/editor/controller/composition/controller-owned-state-composition.ts';
import { createControllerRecordingState } from '../src/common/editor/controller/recording/recording-state.ts';

test('recording state ports mutate only the explicit recording owner', () => {
	const state = createControllerRecordingState({
		recordingRouting: normalizeRecordingRouting(),
		recordingInputGain: 1,
		preferredInputDeviceId: 'default',
	});
	const port = createTrackAudioRecordingStatePort(state);
	const routing = normalizeRecordingRouting({
		routes: { track: { kind: 'device', deviceId: 'input', channelStart: 0, channelCount: 1 } },
	}, [{ id: 'track', type: 'audio' }]);

	port.setRouting(routing);
	port.setRouteHealth('track', 'ready');

	assert.equal(port.getRouting(), routing);
	assert.equal(state.recordingRouting, routing);
	assert.equal(state.recordingRouteHealth.track, 'ready');
});

test('recording routing reconciliation prunes routes and their owner health rows', () => {
	const routing = normalizeRecordingRouting({
		routes: { track: { kind: 'device', deviceId: 'input', channelStart: 0, channelCount: 1 } },
	}, [{ id: 'track', type: 'audio' }]);
	const state = createControllerRecordingState({
		recordingRouting: routing,
		recordingInputGain: 1,
		preferredInputDeviceId: 'default',
	});
	state.recordingRouteHealth.track = 'ready';

	assert.equal(reconcileControllerRecordingRouting(state, [{ id: 'track', type: 'audio' }]), false);
	assert.equal(reconcileControllerRecordingRouting(state, []), true);
	assert.deepEqual(state.recordingRouting.routes, {});
	assert.deepEqual(state.recordingRouteHealth, {});
});
