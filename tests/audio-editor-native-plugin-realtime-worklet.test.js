/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	NATIVE_PLUGIN_CONTROL,
	NativePluginRealtimeProcessor,
} from '../src/common/editor/native-plugin-realtime-worklet.js';

test('native plug-in worklet transports an exact mono-in/stereo-out topology', () => {
	const processor = new NativePluginRealtimeProcessor({ processorOptions: {
		instanceId: 'asymmetric-1', inputChannelCount: 1, outputChannelCount: 2,
		queueCapacity: 4,
	} });
	const control = [];
	processor.port.postMessage = (message) => { control.push(message); };
	const peer = {
		onmessage: null,
		postMessage(message) {
			assert.equal(message.input.length, 1);
			assert.equal(message.output.length, 2);
			message.output[0].fill(0.25);
			message.output[1].fill(0.75);
			this.onmessage?.({ data: {
				...message, kind: 'processed', reportedLatencyFrames: 0,
			} });
		},
		start() {}, close() {},
	};
	processor.port.onmessage({
		data: { type: NATIVE_PLUGIN_CONTROL.attach, generation: 1 }, ports: [peer],
	});
	for (let block = 0; block < 4; block += 1) {
		processor.process([[new Float32Array(128).fill(block + 1)]],
			[[new Float32Array(128), new Float32Array(128)]]);
	}
	const output = [new Float32Array(128), new Float32Array(128)];
	processor.process([[new Float32Array(128).fill(5)]], [output]);
	assert.deepEqual([output[0][0], output[1][0]], [0.25, 0.75]);
	assert.equal(control.some(({ type }) => type === NATIVE_PLUGIN_CONTROL.fault), false);
});

test('native plug-in worklet closes instead of silently remapping a changed input topology', () => {
	const processor = new NativePluginRealtimeProcessor({ processorOptions: {
		instanceId: 'topology-fault-1', inputChannelCount: 1, outputChannelCount: 2,
		queueCapacity: 4,
	} });
	const control = [];
	processor.port.postMessage = (message) => { control.push(message); };
	const peer = { postMessage() {}, start() {}, close() {} };
	processor.port.onmessage({
		data: { type: NATIVE_PLUGIN_CONTROL.attach, generation: 1 }, ports: [peer],
	});
	processor.process([[new Float32Array(128), new Float32Array(128)]],
		[[new Float32Array(128), new Float32Array(128)]]);
	assert.equal(control.some(({ type, reason }) => (
		type === NATIVE_PLUGIN_CONTROL.fault && reason === 'topology-mismatch'
	)), true);
});
