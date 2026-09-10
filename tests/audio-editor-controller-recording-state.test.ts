/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createOwnedStateAccess,
	exposeOwnedFields,
	type OwnedStateWriteScope,
} from '../src/common/editor/controller/shared/owned-state.ts';
import { createControllerRecordingState } from '../src/common/editor/controller/recording/recording-state.ts';
import { createEditorControllerState } from '../src/common/editor/controller/composition/internal/state.ts';

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

test('the recording owner is the only writable recording state', () => {
	const { recording, state } = createState();
	assert.equal(state.monitoring, false);
	assert.equal(Reflect.set(state, 'monitoring', true), false);
	assert.equal(Reflect.deleteProperty(state, 'monitoring'), false);
	assert.equal(recording.monitoring, false, 'flat compatibility readers cannot mutate the owner');
	assert.equal(Object.getOwnPropertyDescriptor(state, 'monitoring')?.set, undefined);
	assert.equal(Object.getOwnPropertyDescriptor(state, 'monitoring')?.configurable, false);
	const rejectFlatRecordingMutation = () => {
		// @ts-expect-error Recording mutations must go through the explicit owner.
		state.monitoring = true;
		// @ts-expect-error Nested recording state is also read-only through the flat view.
		state.recordingRouteHealth.track = 'ready';
	};
	assert.equal(typeof rejectFlatRecordingMutation, 'function');
	assert.equal(recording.monitoring, false);
	recording.monitoring = true;
	assert.equal(state.monitoring, true, 'owner writes are visible to compatibility readers');
	recording.recordingInputGain = 2.5;
	assert.equal(state.recordingInputGain, 2.5, 'owner writes are visible to legacy readers');
	recording.recordingRouteHealth['track-a'] = 'recording';
	assert.deepEqual(recording.recordingRouteHealth, { 'track-a': 'recording' });
	const routing = { routes: { 'track-a': { kind: 'device' as const, deviceId: 'mic', channelStart: 0, channelCount: 1 } }, offsets: {} };
	recording.recordingRouting = routing;
	assert.equal(recording.recordingRouting, routing, 'whole-field reassignment replaces the owner value');
	assert.ok(Object.keys(state).includes('recorder'), 'owned fields stay enumerable on the flat state');
	assert.deepEqual({ ...state }.recordingRouteHealth, { 'track-a': 'recording' });
});

test('recording owners are never shared between controller instances', () => {
	const first = createState();
	const second = createState();
	first.recording.recordingPoolSources.push({ key: 'mic', kind: 'device', channelCount: 1 });
	first.recording.recordingEnumeratedDeviceIds.add('mic');
	assert.equal(second.state.recordingPoolSources.length, 0);
	assert.equal(second.state.recordingEnumeratedDeviceIds.size, 0);
	assert.notEqual(first.recording, second.recording);
});

test('exposing owned fields keeps a read-only view of the owner storage', () => {
	const owner = { count: 1, label: 'a' };
	const target = exposeOwnedFields({ other: true }, owner);
	assert.equal(Reflect.set(target, 'count', 2), false);
	const rejectExposedOwnerMutation = () => {
		// @ts-expect-error Exposed owner fields are read-only.
		target.count = 2;
	};
	assert.equal(typeof rejectExposedOwnerMutation, 'function');
	assert.equal(owner.count, 1);
	owner.label = 'b';
	assert.equal(target.label, 'b');
	assert.equal(target.other, true);
});

test('flat owned fields expose stable recursive read-only collection views', () => {
	const mapKey = { id: 'map-key' };
	const mapValue = { count: 1 };
	const setEntry = { id: 'set-entry' };
	const owner = {
		object: { nested: { count: 1 } },
		frozen: Object.freeze({ nested: Object.freeze({ count: 1 }) }),
		array: [{ count: 1 }],
		map: new Map<object | string, { count: number }>([[mapKey, mapValue]]),
		set: new Set([setEntry]),
	};
	const state = exposeOwnedFields({}, owner);

	assert.equal(state.object, state.object);
	assert.equal(state.object.nested, state.object.nested);
	assert.equal(state.frozen.nested.count, 1, 'frozen owner values remain readable through the view');
	assert.equal(state.frozen.nested, state.frozen.nested);
	assert.deepEqual({ ...state.frozen }, { nested: { count: 1 } });
	assert.equal(JSON.stringify(state.frozen), '{"nested":{"count":1}}');
	assert.equal(state.array, state.array);
	assert.equal(state.map, state.map);
	assert.equal(state.set, state.set);

	assert.throws(() => Reflect.set(state.object.nested, 'count', 2), /read-only/);
	assert.throws(() => Reflect.deleteProperty(state.object, 'nested'), /read-only/);
	assert.throws(() => Reflect.defineProperty(state.object, 'extra', { value: true }), /read-only/);
	assert.throws(() => Reflect.set(state.array, 0, { count: 2 }), /read-only/);
	assert.throws(() => Reflect.apply(Reflect.get(state.array, 'push'), state.array, [{ count: 2 }]), /read-only/);
	assert.throws(() => Reflect.apply(Reflect.get(state.map, 'set'), state.map, ['new', { count: 2 }]), /read-only/);
	assert.throws(() => Reflect.apply(Reflect.get(state.map, 'delete'), state.map, [mapKey]), /read-only/);
	assert.throws(() => Reflect.apply(Reflect.get(state.set, 'add'), state.set, [{ id: 'new' }]), /read-only/);
	assert.throws(() => Reflect.apply(Reflect.get(state.set, 'clear'), state.set, []), /read-only/);

	const [[visibleMapKey, visibleMapValue]] = [...state.map.entries()];
	assert.equal(state.map.has(visibleMapKey), true, 'read-only keys still address their raw map entries');
	assert.equal(state.map.get(visibleMapKey), visibleMapValue);
	assert.throws(() => Reflect.set(visibleMapValue, 'count', 2), /read-only/);
	assert.deepEqual([...state.set].map((entry) => entry.id), ['set-entry']);
	const [visibleSetEntry] = state.set;
	assert.equal(state.set.has(visibleSetEntry), true, 'read-only values still address their raw set entries');
	assert.throws(() => Reflect.set(visibleSetEntry, 'id', 'changed'), /read-only/);

	owner.object.nested.count = 3;
	owner.array.push({ count: 2 });
	owner.map.set('new', { count: 2 });
	owner.set.add({ id: 'new' });
	assert.equal(state.object.nested.count, 3, 'owner writes remain live in the compatibility view');
	assert.equal(state.array.length, 2);
	assert.equal(state.map.get('new')?.count, 2);
	assert.equal(state.set.size, 2);
});

test('owned state access writes only its owner and shared workspace fields', () => {
	const recording = { monitoring: false, routeHealth: new Map<string, string>() };
	const transport = { transportState: 'stopped' };
	const state = exposeOwnedFields(exposeOwnedFields({ selectedClipId: null as string | null }, recording), transport);
	const access = createOwnedStateAccess(state, recording);
	const transportAccess = createOwnedStateAccess(state, transport);
	const acceptRecordingWrites = (
		scope: OwnedStateWriteScope<typeof state, typeof recording>,
	) => scope;
	const acceptTransportWrites = (
		scope: OwnedStateWriteScope<typeof state, typeof transport>,
	) => scope;
	assert.equal(acceptRecordingWrites(access), access);
	assert.equal(acceptTransportWrites(transportAccess), transportAccess);
	const rejectUnscopedOrForeignWrites = () => {
		// @ts-expect-error Flat compatibility state carries no recording write capability.
		acceptRecordingWrites(state);
		// @ts-expect-error Flat compatibility state carries no transport write capability.
		acceptTransportWrites(state);
		// @ts-expect-error Transport ownership cannot satisfy a recording write scope.
		acceptRecordingWrites(transportAccess);
		// @ts-expect-error Recording ownership cannot satisfy a transport write scope.
		acceptTransportWrites(access);
	};
	assert.equal(typeof rejectUnscopedOrForeignWrites, 'function');
	access.monitoring = true;
	access.routeHealth.set('track-a', 'open');
	access.selectedClipId = 'clip-a';
	assert.equal(recording.monitoring, true);
	assert.equal(recording.routeHealth.get('track-a'), 'open');
	assert.equal(state.selectedClipId, 'clip-a');
	assert.equal(Reflect.set(access, 'transportState', 'playing'), false);
	assert.equal(transport.transportState, 'stopped');
	const rejectForeignOwnerMutation = () => {
		// @ts-expect-error Another owner's field remains read-only on this scope.
		access.transportState = 'playing';
	};
	assert.equal(typeof rejectForeignOwnerMutation, 'function');
});
