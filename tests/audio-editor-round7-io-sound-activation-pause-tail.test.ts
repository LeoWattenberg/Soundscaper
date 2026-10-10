/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRecordingController } from '../src/common/editor/recording.js';
import { StreamingRecorderProcessor } from '../src/common/editor/recording-worklet.js';
import { createSoundActivatedRecordingCaptureSession } from '../src/common/editor/controller/recording/internal/sound-activation/sound-activated-recording-capture-session.ts';
import type { RecordingCaptureChunk } from '../src/common/editor/controller/recording/recording-transaction-types.ts';

interface WorkletMessage extends Readonly<Record<string, unknown>> { readonly type: string; }
interface Processor {
	readonly port: {
		onmessage: (event: Readonly<{ data: WorkletMessage }>) => void;
		postMessage: (message: WorkletMessage) => void;
	};
	process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

async function createCapture(enabled = true) {
	const processor = new StreamingRecorderProcessor({ processorOptions: {
		channelCount: 1, chunkFrames: 256,
	} }) as unknown as Processor;
	const pending: WorkletMessage[] = [];
	processor.port.postMessage = message => { pending.push(message); };
	const saved: number[] = [];
	const errors: unknown[] = [];
	const observed: string[] = [];
	const session = createSoundActivatedRecordingCaptureSession(enabled ? {
		getSettings: () => ({ thresholdDb: -40, hysteresisDb: 6, holdFrames: 12_000 }),
		getAddTimestamps: () => true,
		setState: (_source, state) => { observed.push(state); },
	} : undefined, { sourceKey: 'device:default', kind: 'device', sampleRate: 48_000, channelCount: 1 }, () => true);
	let firstWrite: (() => void) | undefined;
	const firstWritten = new Promise<void>(resolve => { firstWrite = resolve; });
	const node = { connect() {}, disconnect() {}, port: {
		onmessage: null as null | ((event: Readonly<{ data: WorkletMessage }>) => void),
		postMessage(message: WorkletMessage) { processor.port.onmessage({ data: message }); }, start() {},
	} };
	const recorderOptions = {
		chunkFrames: 256,
		context: { sampleRate: 48_000, destination: {}, audioWorklet: { async addModule() {} },
			createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
		},
		stream: { getTracks: () => [] }, nodeFactory: () => node,
		onChunk(chunk: RecordingCaptureChunk) {
			for (const segment of session.process(chunk)) saved.push(...segment.channels[0]!);
			firstWrite?.();
		},
		onError(error: unknown) { errors.push(error); },
	};
	const recorder = await createRecordingController(recorderOptions);
	const controller = session.wrapController(recorder);
	const receive = (): void => {
		while (pending.length) node.port.onmessage?.({ data: pending.shift()! });
	};
	const process = (value: number): void => {
		processor.process([[new Float32Array(128).fill(value)]], [[new Float32Array(128)]]);
	};
	controller.start();
	receive();
	process(.25);
	process(.25);
	receive();
	await firstWritten;
	assert.equal(saved.length, 256);
	return { controller, session, recorder, process, receive, saved, observed, errors };
}

for (const enabled of [false, true]) {
	for (const partial of [.125, 0]) test(`${enabled ? 'activated' : 'ordinary'} Pause drains its ${partial ? 'audible' : 'held quiet'} partial PCM`, async () => {
		const capture = await createCapture(enabled);
		try {
			capture.process(partial);
			assert.equal(capture.controller.pause(), true);
			assert.equal(capture.session.state, enabled ? 'paused' : null, 'Pause remains synchronous for controls');
			capture.receive();
			const stopped = capture.controller.stop();
			capture.receive();
			await stopped;
			assert.equal(capture.saved.length, 384);
			assert.ok(capture.saved.slice(256).every(sample => sample === partial));
			assert.equal(capture.session.activationTimestamps.length, enabled ? 1 : 0);
			assert.deepEqual(capture.errors, []);
		} finally { await capture.recorder.dispose(); }
	});
}

test('Resume before the native Pause acknowledgment preserves old held PCM and starts a new capture epoch', async () => {
	const capture = await createCapture();
	try {
		capture.process(0);
		assert.equal(capture.controller.pause(), true);
		capture.process(0); // Actual paused worklet time creates a gap in source frame positions.
		assert.equal(capture.controller.resume(), true);
		capture.process(.5);
		const stopped = capture.controller.stop();
		capture.receive(); // Old partial/paused then resumed partial/stopped share the serialized queue.
		await stopped;
		assert.equal(capture.saved.length, 512);
		assert.ok(capture.saved.slice(256, 384).every(sample => sample === 0));
		assert.ok(capture.saved.slice(384).every(sample => sample === .5));
		assert.deepEqual(capture.session.activationTimestamps.map(stamp => stamp.offsetFrames), [0, 384]);
		assert.deepEqual(capture.errors, []);
	} finally { await capture.recorder.dispose(); }
});

test('a cancelled capture cannot be rearmed by a pending Pause completion', async () => {
	const capture = await createCapture();
	capture.process(.125);
	capture.controller.pause();
	const disposed = capture.controller.dispose?.();
	capture.receive();
	await disposed;
	assert.equal(capture.session.state, 'cancelled');
	assert.equal(capture.observed.at(-1), 'cancelled');
	assert.equal(capture.saved.length, 256);
	assert.deepEqual(capture.errors, []);
});

test('multiple Pause/Resume requests retain their own PCM boundaries before acknowledgments arrive', async () => {
	const capture = await createCapture();
	try {
		capture.process(0);
		capture.controller.pause();
		capture.process(0);
		capture.controller.resume();
		capture.process(.5);
		capture.controller.pause();
		capture.process(0);
		capture.controller.resume();
		capture.process(.75);
		const stopped = capture.controller.stop();
		capture.receive();
		await stopped;
		assert.equal(capture.saved.length, 640);
		assert.deepEqual(capture.session.activationTimestamps.map(stamp => stamp.offsetFrames), [0, 384, 512]);
		assert.ok(capture.saved.slice(512).every(sample => sample === .75));
		assert.deepEqual(capture.errors, []);
	} finally { await capture.recorder.dispose(); }
});

test('a prior ordinary Pause acknowledgment cannot claim a later gated flush callback', async () => {
	const capture = await createCapture(false);
	try {
		capture.process(.125);
		capture.recorder.pause();
		capture.recorder.resume();
		capture.process(.5);
		let framesAtCompletion = -1;
		capture.recorder.pauseAfterFlush(() => { framesAtCompletion = capture.saved.length; });
		const stopped = capture.recorder.stop();
		capture.receive();
		await stopped;
		assert.equal(framesAtCompletion, 512);
		assert.deepEqual(capture.errors, []);
	} finally { await capture.recorder.dispose(); }
});
