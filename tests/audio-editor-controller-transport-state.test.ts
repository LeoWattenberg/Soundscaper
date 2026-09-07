/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditorControllerState } from '../src/common/editor/controller/state.ts';
import { createControllerTransportState } from '../src/common/editor/controller/transport-state.ts';

function createState(transport = createControllerTransportState()) {
	return {
		transport,
		state: createEditorControllerState({
			transport,
			preferences: { workspace: 'music' },
			recordingRouting: { routes: {}, offsets: {} },
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

test('the transport owner and the flat controller state read and write one value', () => {
	const { transport, state } = createState();
	assert.equal(state.transportState, 'stopped');
	assert.equal(state.playAtSpeedRate, 1);
	state.transportState = 'playing';
	state.positionFrame = 4_800;
	assert.equal(transport.transportState, 'playing', 'engine callbacks writing the flat state reach the owner');
	assert.equal(transport.positionFrame, 4_800);
	const abort = new AbortController();
	transport.playAtSpeedAbort = abort;
	assert.equal(state.playAtSpeedAbort, abort, 'owner writes are visible to legacy readers');
	const meters = { tracks: { track: { peak: -3 } }, master: { peak: -1 } };
	state.meters = meters;
	assert.equal(transport.meters, meters);
	assert.deepEqual({ ...state }.meters, meters, 'owned fields stay enumerable on the flat state');
});

test('transport owners are never shared between controller instances', () => {
	const first = createState();
	const second = createState();
	first.state.metronomePending.push({ stop: () => undefined });
	first.state.metronomeEnabled = true;
	assert.equal(second.state.metronomePending.length, 0);
	assert.equal(second.state.metronomeEnabled, false);
	assert.notEqual(first.transport, second.transport);
});
