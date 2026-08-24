/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createNativeDeviceIoWorkletNode } from '../src/common/editor/native-device-io-worklet-node.js';

test('the renderer node bounds calibration, reports scalar transfer deltas and cancels on disposal', async () => {
	const transfers = [];
	const handle = await createNativeDeviceIoWorkletNode(context(), {
		AudioWorkletNode: FakeAudioWorkletNode,
		direction: 'duplex', channelCount: 2, periodFrames: 128, queueCapacity: 4,
		onTransfer: (value) => transfers.push(value),
	});
	handle.attach({ postMessage() {}, close() {} }, { generation: 1 });
	const measured = handle.calibrate({ maxFrames: 256, timeoutMs: 1_000 });
	const request = handle.node.port.sent.at(-1).message;
	assert.deepEqual(request, {
		type: 'native-device-calibrate', requestId: 1, maxFrames: 256,
	});
	handle.node.port.onmessage({ data: {
		type: 'native-device-transfer', framesTransferred: 4_096, lostFrames: 128,
	} });
	handle.node.port.onmessage({ data: {
		type: 'native-device-calibration-result', requestId: 1, calibrationFrames: 64,
	} });
	assert.equal(await measured, 64);
	assert.deepEqual(transfers, [{ framesTransferred: 4_096, lostFrames: 128 }]);

	const cancelled = handle.calibrate({ maxFrames: 128, timeoutMs: 1_000 });
	handle.dispose();
	await assert.rejects(cancelled, /disposed/iu);
	assert.equal(handle.node.port.sent.some(({ message }) => (
		message.type === 'native-device-calibration-cancel'
	)), true);
});

test('the renderer node refuses calibration outside one attached duplex generation', async () => {
	const output = await createNativeDeviceIoWorkletNode(context(), {
		AudioWorkletNode: FakeAudioWorkletNode,
		direction: 'output', channelCount: 2, periodFrames: 128, queueCapacity: 4,
	});
	await assert.rejects(() => output.calibrate({ maxFrames: 128, timeoutMs: 1_000 }), /duplex/iu);
	const duplex = await createNativeDeviceIoWorkletNode(context(), {
		AudioWorkletNode: FakeAudioWorkletNode,
		direction: 'duplex', channelCount: 2, periodFrames: 128, queueCapacity: 4,
	});
	await assert.rejects(() => duplex.calibrate({ maxFrames: 0, timeoutMs: 1_000 }), /frame window/iu);
	await assert.rejects(() => duplex.calibrate({ maxFrames: 128, timeoutMs: 1_000 }), /bound/iu);
});

function context() {
	return { audioWorklet: { addModule: async () => undefined } };
}

class FakeAudioWorkletNode {
	constructor() {
		this.port = {
			sent: [], onmessage: null, start() {},
			postMessage(message, transfer = []) { this.sent.push({ message, transfer }); },
		};
	}
	connect() {}
	disconnect() {}
}
