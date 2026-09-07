/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createControllerRecordingState,
	exposeOwnedFields,
} from '../src/common/editor/controller/recording-state.ts';
import { createEditorControllerState } from '../src/common/editor/controller/state.ts';

function createState(recording = createControllerRecordingState({
	recordingRouting: { routes: {}, offsets: {} },
	recordingInputGain: 1,
	preferredInputDeviceId: 'default',
})) {
	return {
		recording,
		state: createEditorControllerState({
			recording,
			preferences: { workspace: 'music' },
			recordingRouting: recording.recordingRouting,
			effectPresets: { presets: [] },
			initialEffectType: 'amplify',
			phase: 'booting',
			readyMessage: 'Ready',
			mobile: false,
			defaultPixelsPerSecond: 120,
			timelineMinimumSeconds: 30,
			recordingInputGain: 1,
			preferredInputDeviceId: 'default',
		}),
	};
}

test('the recording owner and the flat controller state read and write one value', () => {
	const { recording, state } = createState();
	assert.equal(state.monitoring, false);
	state.monitoring = true;
	assert.equal(recording.monitoring, true, 'legacy writers reach the owner');
	recording.recordingInputGain = 2.5;
	assert.equal(state.recordingInputGain, 2.5, 'owner writes are visible to legacy readers');
	state.recordingRouteHealth['track-a'] = 'recording';
	assert.deepEqual(recording.recordingRouteHealth, { 'track-a': 'recording' });
	const routing = { routes: { 'track-a': { kind: 'device' as const, deviceId: 'mic', channelStart: 0, channelCount: 1 } }, offsets: {} };
	state.recordingRouting = routing;
	assert.equal(recording.recordingRouting, routing, 'whole-field reassignment replaces the owner value');
	assert.ok(Object.keys(state).includes('recorder'), 'owned fields stay enumerable on the flat state');
	assert.deepEqual({ ...state }.recordingRouteHealth, { 'track-a': 'recording' });
});

test('recording owners are never shared between controller instances', () => {
	const first = createState();
	const second = createState();
	first.state.recordingPoolSources.push({ key: 'mic', kind: 'device', channelCount: 1 });
	first.state.recordingEnumeratedDeviceIds.add('mic');
	assert.equal(second.state.recordingPoolSources.length, 0);
	assert.equal(second.state.recordingEnumeratedDeviceIds.size, 0);
	assert.notEqual(first.recording, second.recording);
});

test('exposing owned fields keeps the owner as the storage', () => {
	const owner = { count: 1, label: 'a' };
	const target = exposeOwnedFields({ other: true }, owner);
	target.count = 2;
	assert.equal(owner.count, 2);
	owner.label = 'b';
	assert.equal(target.label, 'b');
	assert.equal(target.other, true);
});
