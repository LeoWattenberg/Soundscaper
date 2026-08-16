/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { PLATFORM_TRANSFER_HARD_LIMITS } from '../src/common/editor/platform/bounded-transfer.ts';
import {
	adaptNativeAudioInventory, isOpaqueNativeAudioHandle, nativeAudioChannelMap,
	nativeAudioDeviceGroupId, nativeAudioDeviceId, type NativeAudioInventoryReport,
} from '../src/common/editor/controller/native-audio-inventory.ts';
import * as session from '../src/common/editor/controller/native-audio-session.ts';

const INPUT_ID = 'native:alsa:in:hw:0,0';
const OUTPUT_ID = 'native:alsa:out:hw:0,0';
const INVENTORY: NativeAudioInventoryReport = Object.freeze({
	backend: 'alsa',
	status: 'available',
	detail: '',
	devices: Object.freeze([
		Object.freeze({ handle: 'hw:0,0', label: 'Built-in', direction: 'duplex' as const, channelCount: 4, isDefault: true }),
		Object.freeze({ handle: 'usb:2', label: 'Interface', direction: 'input' as const, channelCount: 3 }),
	]),
});

function adapt(devices: readonly unknown[]): ReturnType<typeof adaptNativeAudioInventory> {
	return adaptNativeAudioInventory({ backend: 'alsa', status: 'available', detail: '', devices });
}

test('a device id and channel map are pure functions of what main published', () => {
	assert.equal(nativeAudioDeviceId('alsa', 'audio-input', 'hw:0,0'), INPUT_ID);
	assert.equal(nativeAudioDeviceId('alsa', 'audio-output', 'hw:0,0'), OUTPUT_ID);
	assert.equal(nativeAudioDeviceGroupId('alsa', 'hw:0,0'), 'native:alsa:hw:0,0');
	assert.deepEqual(nativeAudioChannelMap(4), [
		{ index: 0, pairStart: 0 }, { index: 1, pairStart: 0 }, { index: 2, pairStart: 2 }, { index: 3, pairStart: 2 },
	]);
	assert.deepEqual(nativeAudioChannelMap(3).map((channel) => channel.pairStart), [0, 0, null]);
	assert.deepEqual(nativeAudioChannelMap(1), [{ index: 0, pairStart: null }]);
	for (const absent of [0, -1, 1.5, undefined, '2']) assert.deepEqual(nativeAudioChannelMap(absent), []);
	assert.equal(nativeAudioChannelMap(4_096).length, PLATFORM_TRANSFER_HARD_LIMITS.audioChunkChannels);
});

test('the session module re-exports this one surface rather than forking a second device model', () => {
	assert.equal(session.adaptNativeAudioInventory, adaptNativeAudioInventory);
	assert.equal(session.nativeAudioDeviceId, nativeAudioDeviceId);
	assert.equal(session.nativeAudioDeviceGroupId, nativeAudioDeviceGroupId);
	assert.equal(session.nativeAudioChannelMap, nativeAudioChannelMap);
	assert.equal(session.isOpaqueNativeAudioHandle, isOpaqueNativeAudioHandle);
});

test('the inventory adapts into the existing rows and does not depend on enumeration order', () => {
	const inventory = adaptNativeAudioInventory(INVENTORY);
	assert.deepEqual(inventory.inputs.map((row) => row.deviceId), [INPUT_ID, 'native:alsa:in:usb:2']);
	assert.deepEqual(inventory.outputs.map((row) => row.deviceId), [OUTPUT_ID]);
	const duplex = inventory.inputs[0];
	assert.deepEqual({ ...duplex, channels: duplex.channels.length }, {
		deviceId: INPUT_ID, groupId: 'native:alsa:hw:0,0', label: 'Built-in',
		isDefault: true, channelCount: 4, status: 'available', channels: 4,
	});
	assert.equal(inventory.outputs[0].groupId, duplex.groupId, 'both directions of one device share a group');
	assert.equal(inventory.inputs[1].isDefault, false);
	const reversed = adaptNativeAudioInventory({ ...INVENTORY, devices: [...INVENTORY.devices].reverse() });
	assert.deepEqual(reversed, inventory, 'the same devices in another order must adapt identically');
});

test('two devices that collide on one identity resolve to the same winner in any order', () => {
	// A backend that publishes one handle twice must not hand the editor a
	// different channel map depending on which copy it happened to list first.
	const devices = Object.freeze([
		Object.freeze({ handle: 'hw:0,0', label: 'Alpha', direction: 'input' as const, channelCount: 2, isDefault: true }),
		Object.freeze({ handle: 'hw:0,0', label: 'Omega', direction: 'input' as const, channelCount: 8, isDefault: false }),
	]);
	const forward = adapt(devices);
	const reversed = adapt([...devices].reverse());
	assert.deepEqual(reversed, forward, 'which of two colliding devices wins cannot depend on enumeration order');
	assert.deepEqual(forward.inputs.map((row) => [row.label, row.channelCount, row.isDefault]), [['Alpha', 2, true]]);
	assert.deepEqual(forward.rejected, [{ label: 'Omega', reason: 'duplicate-identity' }]);
	// A duplex device collides with itself on neither direction, so it keeps both rows.
	const duplex = adapt([{ handle: 'hw:0,0', label: 'Both', direction: 'duplex', channelCount: 2 }]);
	assert.deepEqual([duplex.inputs.length, duplex.outputs.length, duplex.rejected.length], [1, 1, 0]);
});

test('a handle that reads as a path never becomes a device id', () => {
	const inventory = adaptNativeAudioInventory({
		backend: 'alsa',
		status: 'available',
		detail: 'one refused',
		devices: [
			{ handle: '/dev/snd/pcmC0D0c', label: 'Raw path', direction: 'input' },
			{ handle: 'C:\\Windows\\device', label: 'Raw drive', direction: 'input' },
			{ handle: 'hw:0,0', label: 'Fine', direction: 'input', channelCount: 2 },
			{ handle: 'hw:0,0', label: 'Twice', direction: 'input', channelCount: 2 },
			{ handle: 'hw:9', label: 'Sideways', direction: 'sideways' },
			{ label: 'Handleless', direction: 'input' },
			'not a device',
		],
	});
	assert.deepEqual(inventory.inputs.map((row) => row.deviceId), [INPUT_ID]);
	assert.deepEqual(inventory.rejected, [
		{ label: 'Twice', reason: 'duplicate-identity' },
		{ label: '', reason: 'malformed' },
		{ label: 'Handleless', reason: 'malformed' },
		{ label: 'Raw drive', reason: 'opaque-handle-required' },
		{ label: 'Raw path', reason: 'opaque-handle-required' },
		{ label: 'Sideways', reason: 'unknown-direction' },
	]);
	assert.equal(JSON.stringify(inventory).includes('/dev/snd'), false, 'no raw path may reach renderer state');
	for (const raw of ['/dev/snd/x', '\\\\?\\pipe\\audio', 'C:\\audio', 'hw\\0', 'hw\0']) {
		assert.equal(isOpaqueNativeAudioHandle(raw), false, `${JSON.stringify(raw)} must not read as opaque`);
	}
	assert.equal(isOpaqueNativeAudioHandle('native:alsa:in:hw:0,0'), true);
});

test('a malformed or unbounded inventory is refused outright', () => {
	assert.throws(() => adaptNativeAudioInventory(null), /plain record/u);
	assert.throws(() => adaptNativeAudioInventory({ ...INVENTORY, backend: '' }), /name its backend/u);
	assert.throws(() => adaptNativeAudioInventory({ ...INVENTORY, devices: 'many' }), /bounded device list/u);
	assert.throws(() => adapt(Array.from({ length: 129 }, (_unused, index) => ({ handle: `hw:${index}`, label: '', direction: 'input' }))),
		/bounded device list/u);
	assert.throws(() => adapt([{ handle: 'hw:0', label: 'x'.repeat(257), direction: 'input' }]), /bounded text/u);
});
