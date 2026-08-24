/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

test('native device worklet closes on device loss and every short transfer', async (context) => {
	const original = globalThis.AudioWorkletProcessor;
	class ProcessorBase {
		constructor() {
			this.port = { posted: [], postMessage(value) { this.posted.push(value); }, start() {}, onmessage: null };
		}
	}
	globalThis.AudioWorkletProcessor = ProcessorBase;
	context.after(() => { globalThis.AudioWorkletProcessor = original; });
	const { NativeDeviceIoProcessor } = await import(
		`../src/common/editor/native-device-io-worklet.js?loss=${String(Date.now())}`
	);
	for (const fault of [
		{ direction: 'input', status: 'device-unavailable', framesTransferred: 0, reason: 'device-loss' },
		{ direction: 'output', status: 'ok', framesTransferred: 127, reason: 'short-transfer' },
	]) {
		const processor = new NativeDeviceIoProcessor({ processorOptions: {
			direction: fault.direction, channelCount: 2, periodFrames: 128, queueCapacity: 2,
		} });
		const peer = messagePort();
		processor.port.onmessage({
			data: { type: 'native-device-attach', generation: 1 }, ports: [peer],
		});
		if (fault.direction === 'output') {
			processor.process([[new Float32Array(128), new Float32Array(128)]], [[]]);
		}
		const outbound = peer.posted.find((message) => ['capture-credit', 'audio'].includes(message.kind));
		assert.ok(outbound);
		peer.onmessage({ data: {
			...outbound,
			kind: fault.direction === 'input' ? 'audio' : 'return',
			status: fault.status,
			framesTransferred: fault.framesTransferred,
		} });
		assert.equal(processor.port.posted.at(-1).type, 'native-device-closed');
		assert.equal(processor.port.posted.at(-1).reason, fault.reason);
	}
});

test('duplex calibration injects one bounded impulse and reports only its frame offset', async (context) => {
	const original = globalThis.AudioWorkletProcessor;
	class ProcessorBase {
		constructor() {
			this.port = { posted: [], postMessage(value) { this.posted.push(value); }, start() {}, onmessage: null };
		}
	}
	globalThis.AudioWorkletProcessor = ProcessorBase;
	context.after(() => { globalThis.AudioWorkletProcessor = original; });
	const { NativeDeviceIoProcessor } = await import(
		`../src/common/editor/native-device-io-worklet.js?calibration=${String(Date.now())}`
	);
	const processor = new NativeDeviceIoProcessor({ processorOptions: {
		direction: 'duplex', channelCount: 2, periodFrames: 128, queueCapacity: 2,
	} });
	const peer = messagePort();
	processor.port.onmessage({
		data: { type: 'native-device-attach', generation: 1 }, ports: [peer],
	});
	processor.port.onmessage({
		data: { type: 'native-device-calibrate', requestId: 1, maxFrames: 256 }, ports: [],
	});
	const captures = peer.posted.filter((message) => message.kind === 'capture-credit');
	assert.equal(captures.length, 2);
	peer.onmessage({ data: {
		...captures[0], kind: 'audio', status: 'ok', framesTransferred: 128,
	} });
	processor.process([
		[new Float32Array(128), new Float32Array(128)],
	], [[new Float32Array(128), new Float32Array(128)]]);
	const output = peer.posted.find((message) => message.kind === 'audio');
	assert.ok(output);
	assert.deepEqual([...output.channels[0].slice(0, 8)],
		[0.5, -0.5, 0.25, -0.25, -0.5, 0.5, -0.25, 0.25],
		'a short signed signature enters native output only after a quiet pre-roll');
	assert.equal(output.channels[0].slice(8).some((value) => value !== 0), false);
	const capture = captures[1];
	const signature = [0.05, -0.05, 0.025, -0.025, -0.05, 0.05, -0.025, 0.025];
	capture.channels[0].set(signature, 64);
	peer.onmessage({ data: {
		...capture, kind: 'audio', status: 'ok', framesTransferred: 128,
	} });
	assert.deepEqual(processor.port.posted.at(-1), {
		type: 'native-device-calibration-result', requestId: 1, calibrationFrames: 192,
	});
	assert.equal(Object.hasOwn(processor.port.posted.at(-1), 'channels'), false,
		'calibration never publishes captured PCM to renderer main');
});

test('calibration is duplex-only, cancellable and bounded by captured frames', async (context) => {
	const original = globalThis.AudioWorkletProcessor;
	class ProcessorBase {
		constructor() {
			this.port = { posted: [], postMessage(value) { this.posted.push(value); }, start() {}, onmessage: null };
		}
	}
	globalThis.AudioWorkletProcessor = ProcessorBase;
	context.after(() => { globalThis.AudioWorkletProcessor = original; });
	const { NativeDeviceIoProcessor } = await import(
		`../src/common/editor/native-device-io-worklet.js?calibration-bounds=${String(Date.now())}`
	);
	const outputOnly = new NativeDeviceIoProcessor({ processorOptions: {
		direction: 'output', channelCount: 2, periodFrames: 128, queueCapacity: 2,
	} });
	outputOnly.port.onmessage({ data: {
		type: 'native-device-calibrate', requestId: 1, maxFrames: 128,
	}, ports: [] });
	assert.equal(outputOnly.port.posted.at(-1).reason, 'duplex-required');

	const duplex = new NativeDeviceIoProcessor({ processorOptions: {
		direction: 'duplex', channelCount: 2, periodFrames: 128, queueCapacity: 2,
	} });
	const peer = messagePort();
	duplex.port.onmessage({ data: { type: 'native-device-attach', generation: 1 }, ports: [peer] });
	duplex.port.onmessage({ data: {
		type: 'native-device-calibrate', requestId: 2, maxFrames: 128,
	}, ports: [] });
	const captures = peer.posted.filter((message) => message.kind === 'capture-credit');
	peer.onmessage({ data: {
		...captures[0], kind: 'audio', status: 'ok', framesTransferred: 128,
	} });
	duplex.process([[new Float32Array(128), new Float32Array(128)]],
		[[new Float32Array(128), new Float32Array(128)]]);
	captures[1].channels[0].fill(0.4);
	peer.onmessage({ data: {
		...captures[1], kind: 'audio', status: 'ok', framesTransferred: 128,
	} });
	assert.equal(duplex.port.posted.at(-1).reason, 'timeout');
	assert.notEqual(duplex.port.posted.at(-1).type, 'native-device-calibration-result',
		'unrelated loud input must not be mistaken for the signed loopback signature');
	duplex.port.onmessage({ data: {
		type: 'native-device-calibrate', requestId: 3, maxFrames: 128,
	}, ports: [] });
	duplex.port.onmessage({ data: {
		type: 'native-device-calibration-cancel', requestId: 3,
	}, ports: [] });
	assert.equal(duplex.port.posted.at(-1).reason, 'cancelled');
});

function messagePort() {
	return {
		posted: [], onmessage: null, onmessageerror: null,
		postMessage(value) { this.posted.push(value); }, start() {}, close() {},
	};
}
