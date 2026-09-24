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

test('strict native render reports a helper deadline miss instead of publishing dry audio', () => {
	const processor = new NativePluginRealtimeProcessor({ processorOptions: {
		instanceId: 'render-stall-1', inputChannelCount: 1, outputChannelCount: 1,
		queueCapacity: 4, strictRender: true,
	} });
	const control = [];
	processor.port.postMessage = (message) => { control.push(message); };
	const peer = { postMessage() {}, start() {}, close() {} };
	processor.port.onmessage({
		data: { type: NATIVE_PLUGIN_CONTROL.attach, generation: 1 }, ports: [peer],
	});
	for (let block = 0; block < 4; block += 1) {
		processor.process([[new Float32Array(128).fill(1)]], [[new Float32Array(128)]]);
	}
	const output = new Float32Array(128).fill(99);
	processor.process([[new Float32Array(128).fill(1)]], [[output]]);
	assert.equal(output[0], 0);
	assert.deepEqual(control.filter(({ type }) => type === NATIVE_PLUGIN_CONTROL.fault)
		.map(({ reason }) => reason), ['processing-deadline-miss']);
	processor.port.onmessage({ data: {
		type: 'native-plugin-render-status', requestId: 'status-1',
	}, ports: [] });
	assert.deepEqual(control.find(({ type }) => type === 'native-plugin-render-status-result'), {
		type: 'native-plugin-render-status-result', requestId: 'status-1',
		failed: true, reason: 'processing-deadline-miss', instanceId: 'render-stall-1',
	});
});

test('strict native render reports an unavailable helper on its first block', () => {
	const processor = new NativePluginRealtimeProcessor({ processorOptions: {
		instanceId: 'render-missing-1', inputChannelCount: 1, outputChannelCount: 1,
		queueCapacity: 4, strictRender: true,
	} });
	const control = [];
	processor.port.postMessage = (message) => { control.push(message); };
	processor.process([[new Float32Array(128).fill(1)]], [[new Float32Array(128)]]);
	assert.deepEqual(control.filter(({ type }) => type === NATIVE_PLUGIN_CONTROL.fault)
		.map(({ reason }) => reason), ['host-unavailable']);
});

test('an immediate bypass instruction supersedes a pending scheduled one', (context) => {
	const priorFrame = globalThis.currentFrame;
	context.after(() => { globalThis.currentFrame = priorFrame; });
	const processor = new NativePluginRealtimeProcessor({ processorOptions: {
		instanceId: 'bypass-1', inputChannelCount: 1, outputChannelCount: 1, queueCapacity: 4,
	} });
	processor.port.onmessage({ data: {
		type: NATIVE_PLUGIN_CONTROL.bypass, bypassed: true, atContextFrame: 128,
	}, ports: [] });
	processor.port.onmessage({ data: {
		type: NATIVE_PLUGIN_CONTROL.bypass, bypassed: false,
	}, ports: [] });
	globalThis.currentFrame = 128;
	processor.process([[new Float32Array(128).fill(1)]], [[new Float32Array(128)]]);
	assert.equal(processor.bypassed, false);
});

test('native plug-in worklet relays generated parameter RPC without touching the audio thread', () => {
	const processor = new NativePluginRealtimeProcessor({ processorOptions: {
		instanceId: 'parameters-1', inputChannelCount: 1, outputChannelCount: 1, queueCapacity: 4,
	} });
	const control = [];
	processor.port.postMessage = (message) => { control.push(message); };
	const peer = {
		onmessage: null,
		postMessage(message) {
			const replies = {
				capabilities: { kind: 'capabilities', parameterCount: 1, hasVendorUi: false },
				parameters: { kind: 'parameters', parameters: [{
					index: 0, id: 'gain', name: 'Gain', label: '', defaultValue: 0.5,
					minimumValue: 0, maximumValue: 1, flags: 8,
				}] },
				'parameter-get': { kind: 'parameter-value', index: 0, value: 0.5 },
				'parameter-set': { kind: 'parameter-value', index: 0, value: message.value },
			};
			this.onmessage?.({ data: { protocolVersion: 1, requestId: message.requestId, ...replies[message.kind] } });
		},
		start() {}, close() {},
	};
	processor.port.onmessage({
		data: { type: NATIVE_PLUGIN_CONTROL.attach, generation: 1 }, ports: [peer],
	});
	for (const message of [
		{ type: NATIVE_PLUGIN_CONTROL.capabilities, requestId: 'capabilities-1' },
		{ type: NATIVE_PLUGIN_CONTROL.describeParameters, requestId: 'parameters-1' },
		{ type: NATIVE_PLUGIN_CONTROL.readParameter, requestId: 'read-1', index: 0 },
		{ type: NATIVE_PLUGIN_CONTROL.writeParameter, requestId: 'write-1', index: 0, value: 0.75 },
	]) processor.port.onmessage({ data: message, ports: [] });
	assert.deepEqual(control.slice(1).map(({ type, requestId, value }) => [type, requestId, value]), [
		[NATIVE_PLUGIN_CONTROL.capabilitiesResult, 'capabilities-1', undefined],
		[NATIVE_PLUGIN_CONTROL.parameters, 'parameters-1', undefined],
		[NATIVE_PLUGIN_CONTROL.parameterValue, 'read-1', 0.5],
		[NATIVE_PLUGIN_CONTROL.parameterValue, 'write-1', 0.75],
	]);
});
