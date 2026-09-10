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

test('the transport owner is the only writable transport state', () => {
	const { transport, state } = createState();
	assert.equal(state.transportState, 'stopped');
	assert.equal(state.playAtSpeedRate, 1);
	assert.equal(Reflect.set(state, 'transportState', 'playing'), false);
	assert.equal(Reflect.deleteProperty(state, 'transportState'), false);
	assert.equal(Object.getOwnPropertyDescriptor(state, 'transportState')?.set, undefined);
	assert.equal(Object.getOwnPropertyDescriptor(state, 'transportState')?.configurable, false);
	const rejectFlatTransportMutation = () => {
		// @ts-expect-error Transport mutations must go through the explicit owner.
		state.transportState = 'playing';
		// @ts-expect-error Nested transport state is also read-only through the flat view.
		state.metronomePending.push({ stop: () => undefined });
	};
	assert.equal(typeof rejectFlatTransportMutation, 'function');
	assert.equal(transport.transportState, 'stopped');
	transport.transportState = 'playing';
	transport.positionFrame = 4_800;
	assert.equal(state.transportState, 'playing', 'owner writes are visible to compatibility readers');
	assert.equal(transport.positionFrame, 4_800);
	const abort = new AbortController();
	transport.playAtSpeedAbort = abort;
	assert.equal(state.playAtSpeedAbort, abort, 'owner writes are visible to legacy readers');
	const meters = { tracks: { track: { peak: -3 } }, master: { peak: -1 } };
	transport.meters = meters;
	assert.equal(transport.meters, meters);
	assert.deepEqual({ ...state }.meters, meters, 'owned fields stay enumerable on the flat state');
});

test('transport owners are never shared between controller instances', () => {
	const first = createState();
	const second = createState();
	first.transport.metronomePending.push({ stop: () => undefined });
	first.transport.metronomeEnabled = true;
	assert.equal(second.state.metronomePending.length, 0);
	assert.equal(second.state.metronomeEnabled, false);
	assert.notEqual(first.transport, second.transport);
});
