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

function controllerHarness() {
	const sent = [];
	const errors = [];
	const source = { connect() {}, disconnect() {} };
	const node = { connect() {}, disconnect() {}, port: {
		onmessage: null,
		postMessage(message) { sent.push(message); },
		start() {},
	} };
	const create = () => createRecordingController({
		context: { sampleRate: 48_000, destination: {}, audioWorklet: { async addModule() {} }, createMediaStreamSource: () => source },
		stream: { getTracks: () => [] }, nodeFactory: () => node,
		onError(error) { errors.push(error); },
	});
	return { create, sent, errors, receive(message) { node.port.onmessage({ data: message }); } };
}

test('confirmed start retries a missed frame without a fatal controller error and preserves finite duration', async () => {
	const harness = controllerHarness();
	const controller = await harness.create();
	const confirmation = controller.startConfirmed({ startFrame: 1_000, stopFrame: 2_000, retryLeadFrames: 512 });
	assert.equal(harness.sent[0].type, 'start');
	assert.equal(harness.sent[0].confirmStart, true);
	harness.receive({ type: 'start-missed', requestId: harness.sent[0].requestId, firstAvailableFrame: 1_280 });
	assert.equal(controller.state, 'recording');
	assert.equal(harness.errors.length, 0);
	assert.equal(harness.sent[1].startFrame, 1_792);
	assert.equal(harness.sent[1].stopFrame, 2_792);
	harness.receive({ type: 'started', requestId: harness.sent[0].requestId, startFrame: 1_000 });
	harness.receive({ type: 'started', requestId: harness.sent[1].requestId, startFrame: 1_792 });
	assert.deepEqual(await confirmation, { startFrame: 1_792, missed: true, firstAvailableFrame: 1_280 });
	assert.equal(harness.errors.length, 0);
	harness.receive({ type: 'stopped', frame: 1_792 });
	await controller.dispose();
});

test('confirmed start resolves on an acknowledged frame without retry', async () => {
	const harness = controllerHarness();
	const controller = await harness.create();
	const confirmation = controller.startConfirmed({ startFrame: 1_000 });
	harness.receive({ type: 'started', requestId: harness.sent[0].requestId, startFrame: 1_000 });
	assert.deepEqual(await confirmation, { startFrame: 1_000 });
	harness.receive({ type: 'stopped', frame: 1_000 });
	await controller.dispose();
});

test('confirmed start can miss more than once and still retain the original recording duration', async () => {
	const harness = controllerHarness();
	const controller = await harness.create();
	const confirmation = controller.startConfirmed({ startFrame: 1_000, stopFrame: 2_000, retryLeadFrames: 128 });
	harness.receive({ type: 'start-missed', requestId: harness.sent[0].requestId, firstAvailableFrame: 1_100 });
	harness.receive({ type: 'start-missed', requestId: harness.sent[1].requestId, firstAvailableFrame: 1_300 });
	assert.deepEqual(harness.sent.slice(1).map(({ startFrame, stopFrame }) => [startFrame, stopFrame]), [
		[1_228, 2_228], [1_556, 2_556],
	]);
	harness.receive({ type: 'started', requestId: harness.sent[2].requestId, startFrame: 1_556 });
	assert.deepEqual(await confirmation, { startFrame: 1_556, missed: true, firstAvailableFrame: 1_300 });
	harness.receive({ type: 'stopped', frame: 1_556 });
	await controller.dispose();
});

test('confirmed reschedule acknowledges a later frame and rejects capture already underway', async () => {
	const harness = controllerHarness();
	const controller = await harness.create();
	const confirmation = controller.startConfirmed({ startFrame: 1_000 });
	harness.receive({ type: 'started', requestId: harness.sent[0].requestId, startFrame: 1_000 });
	await confirmation;
	const reschedule = controller.rescheduleConfirmed({ startFrame: 2_000 });
	assert.equal(harness.sent[1].type, 'reschedule');
	harness.receive({ type: 'rescheduled', requestId: harness.sent[1].requestId, startFrame: 2_000 });
	assert.deepEqual(await reschedule, { startFrame: 2_000 });
	const lateReschedule = controller.rescheduleConfirmed({ startFrame: 3_000 });
	harness.receive({ type: 'reschedule-rejected', requestId: harness.sent[2].requestId, code: 'RECORDING_ALREADY_CAPTURING' });
	await assert.rejects(lateReschedule, /already capturing/u);
	assert.equal(controller.state, 'recording');
	assert.equal(harness.errors.length, 0);
	harness.receive({ type: 'stopped', frame: 2_000 });
	await controller.dispose();
});

test('a rejected reschedule exposes the next available frame without failing capture', async () => {
	const harness = controllerHarness();
	const controller = await harness.create();
	const confirmation = controller.startConfirmed({ startFrame: 1_000 });
	harness.receive({ type: 'started', requestId: harness.sent[0].requestId, startFrame: 1_000 });
	await confirmation;
	const reschedule = controller.rescheduleConfirmed({ startFrame: 2_000 });
	harness.receive({ type: 'reschedule-rejected', requestId: harness.sent[1].requestId,
		code: 'RECORDING_START_MISSED', firstAvailableFrame: 2_048 });
	await assert.rejects(reschedule, (error) => {
		assert.equal(error.code, 'RECORDING_START_MISSED');
		assert.equal(error.firstAvailableFrame, 2_048);
		return true;
	});
	assert.equal(controller.state, 'recording');
	harness.receive({ type: 'stopped', frame: 2_048 });
	await controller.dispose();
});

test('stopping before a confirmed start acknowledgement cancels the wait and completes cleanup', async () => {
	const harness = controllerHarness();
	const controller = await harness.create();
	const confirmation = controller.startConfirmed({ startFrame: 1_000 });
	const stopped = controller.stop();
	await assert.rejects(confirmation, /before its start was acknowledged/u);
	harness.receive({ type: 'stopped', frame: 0 });
	assert.deepEqual(await stopped, { frame: 0 });
	await controller.dispose();
});

test('worklet reports retryable misses and accepts rescheduling only before PCM capture', () => {
	const previousFrame = globalThis.currentFrame;
	try {
		const processor = new StreamingRecorderProcessor({ processorOptions: { channelCount: 1, chunkFrames: 128 } });
		const messages = [];
		processor.port.postMessage = (message) => messages.push(message);
		globalThis.currentFrame = 128;
		processor.process([[new Float32Array(128)]], [[new Float32Array(128)]]);
		processor.port.onmessage({ data: { type: 'start', confirmStart: true, requestId: 1, startFrame: 128 } });
		assert.deepEqual(messages[0], { type: 'start-missed', requestId: 1, firstAvailableFrame: 256 });
		processor.port.onmessage({ data: { type: 'start', confirmStart: true, requestId: 2, startFrame: 512 } });
		assert.equal(messages.at(-1).type, 'started');
		processor.port.onmessage({ data: { type: 'reschedule', requestId: 3, startFrame: 640 } });
		assert.deepEqual(messages.at(-1), { type: 'rescheduled', requestId: 3, startFrame: 640, stopFrame: Infinity });
		globalThis.currentFrame = 640;
		processor.process([[new Float32Array(128).fill(0.5)]], [[new Float32Array(128)]]);
		processor.port.onmessage({ data: { type: 'reschedule', requestId: 4, startFrame: 900 } });
		assert.deepEqual(messages.at(-1), { type: 'reschedule-rejected', requestId: 4, code: 'RECORDING_ALREADY_CAPTURING' });
	} finally {
		if (previousFrame === undefined) delete globalThis.currentFrame;
		else globalThis.currentFrame = previousFrame;
	}
});

test('worklet acknowledges stop after an opt-in start misses and keeps finite duration on reschedule', () => {
	const previousFrame = globalThis.currentFrame;
	try {
		const processor = new StreamingRecorderProcessor({ processorOptions: { channelCount: 1, chunkFrames: 128 } });
		const messages = [];
		processor.port.postMessage = (message) => messages.push(message);
		globalThis.currentFrame = 256;
		processor.port.onmessage({ data: { type: 'start', confirmStart: true, requestId: 1, startFrame: 128 } });
		processor.port.onmessage({ data: { type: 'stop' } });
		assert.deepEqual(messages.at(-1), { type: 'stopped', frame: 0 });
		processor.port.onmessage({ data: { type: 'start', confirmStart: true, requestId: 2, startFrame: 512, stopFrame: 768 } });
		processor.port.onmessage({ data: { type: 'reschedule', requestId: 3, startFrame: 640 } });
		assert.deepEqual(messages.at(-1), { type: 'rescheduled', requestId: 3, startFrame: 640, stopFrame: 896 });
	} finally {
		if (previousFrame === undefined) delete globalThis.currentFrame;
		else globalThis.currentFrame = previousFrame;
	}
});
