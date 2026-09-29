/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRecordingController } from '../src/common/editor/recording.js';
import { StreamingRecorderProcessor } from '../src/common/editor/recording-worklet.js';

test('a recorder start arriving after its absolute frame reports lost capture instead of shifting the take', () => {
	const previousFrame = globalThis.currentFrame;
	try {
		const processor = new StreamingRecorderProcessor({ processorOptions: { channelCount: 1, chunkFrames: 128 } });
		const messages = [];
		processor.port.postMessage = (message) => messages.push(message);
		globalThis.currentFrame = 0;
		processor.process([[new Float32Array(128)]], [[new Float32Array(128)]]);
		globalThis.currentFrame = 128;
		processor.process([[new Float32Array(128)]], [[new Float32Array(128)]]);
		processor.port.onmessage({ data: { type: 'start', startFrame: 128, stopFrame: 512 } });
		globalThis.currentFrame = 256;
		processor.process([[new Float32Array(128).fill(0.5)]], [[new Float32Array(128)]]);
		assert.equal(messages.find((message) => message.type === 'error')?.code, 'RECORDING_START_MISSED');
		assert.equal(messages.some((message) => message.type === 'audio-chunk'), false);
	} finally {
		if (previousFrame === undefined) delete globalThis.currentFrame;
		else globalThis.currentFrame = previousFrame;
	}
});

test('a missed recorder start reaches the capture controller as a fatal error', async () => {
	const source = { connect() {}, disconnect() {} };
	const node = { connect() {}, disconnect() {}, port: { onmessage: null, postMessage() {}, start() {}, close() {} } };
	const errors = [];
	const controller = await createRecordingController({
		context: {
			destination: {}, audioWorklet: { async addModule() {} }, createMediaStreamSource: () => source,
		},
		stream: { getTracks: () => [] },
		nodeFactory: () => node,
		onError: (error) => { errors.push(error); },
	});
	controller.start({ startFrame: 128 });
	node.port.onmessage({ data: { type: 'error', code: 'RECORDING_START_MISSED', message: 'Recording missed its scheduled start.' } });
	assert.equal(controller.state, 'failed');
	assert.equal(errors.length, 1);
	assert.equal(errors[0].code, 'RECORDING_START_MISSED');
	await assert.rejects(controller.stop(), /missed its scheduled start/u);
	await assert.rejects(controller.dispose(), /missed its scheduled start/u);
});
