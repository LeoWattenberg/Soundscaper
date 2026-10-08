/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { StreamingRecorderProcessor } from '../src/common/editor/recording-worklet.js';
import { createRecordingController } from '../src/common/editor/recording.js';
import { createLegacyRecordingCaptureService } from '../src/common/editor/controller/recording/internal/legacy-recording-capture-service.ts';
import { createRoutedRecordingCaptureService } from '../src/common/editor/controller/recording/internal/routed-recording-capture-service.ts';
import { createRecordingCaptureFixture, createScope } from './fixtures/recording-capture-fixture.ts';

interface Processor {
	readonly recording: boolean;
	readonly stopFrame: number;
	readonly port: {
		postMessage(message: unknown): void;
		onmessage: ((event: { readonly data: Readonly<Record<string, unknown>> }) => void) | null;
	};
	process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

function createProcessor(fixedStopFrame?: boolean) {
	const processor = new StreamingRecorderProcessor({
		processorOptions: { channelCount: 1, chunkFrames: 128, fixedStopFrame },
	}) as unknown as Processor;
	const messages: Readonly<Record<string, unknown>>[] = [];
	processor.port.postMessage = (message: unknown) => {
		assert.ok(message && typeof message === 'object');
		messages.push(message as Readonly<Record<string, unknown>>);
	};
	const send = (data: Readonly<Record<string, unknown>>) => {
		assert.ok(processor.port.onmessage);
		processor.port.onmessage({ data });
	};
	const process = (value = 0.5) => {
		assert.equal(processor.process([[new Float32Array(128).fill(value)]], [[new Float32Array(128)]]), true);
	};
	send({ type: 'start', startFrame: 0, stopFrame: 384 });
	return { processor, messages, send, process };
}

function capturedChunks(messages: readonly Readonly<Record<string, unknown>>[]) {
	return messages.filter((message) => message.type === 'audio-chunk').map((message) => {
		assert.ok(Array.isArray(message.channels));
		const channel: unknown = message.channels[0];
		assert.ok(channel instanceof Float32Array);
		return { frameStart: message.frameStart, samples: [...channel] };
	});
}

test('a timed end stays fixed after pause and excludes the paused microphone input', () => {
	const recording = createProcessor(true);
	recording.process();
	recording.send({ type: 'pause' });
	recording.process(1);
	recording.send({ type: 'resume' });
	recording.process();
	assert.equal(recording.processor.stopFrame, 384);
	assert.equal(recording.processor.recording, false);
	assert.deepEqual(capturedChunks(recording.messages), [
		{ frameStart: 0, samples: Array<number>(128).fill(0.5) },
		{ frameStart: 256, samples: Array<number>(128).fill(0.5) },
	]);
	assert.equal(recording.messages.at(-1)?.type, 'stopped');
});

test('a timed end stops the capture even while its pause remains active', () => {
	const recording = createProcessor(true);
	recording.process();
	recording.send({ type: 'pause' });
	recording.process(1);
	recording.process(1);
	recording.process(1);
	assert.equal(recording.processor.recording, false);
	assert.equal(recording.messages.at(-1)?.type, 'stopped');
	assert.deepEqual(capturedChunks(recording.messages), [{ frameStart: 0, samples: Array<number>(128).fill(0.5) }]);
	const previous = recording.messages.length;
	recording.send({ type: 'resume' });
	recording.process(1);
	assert.equal(recording.messages.length, previous, 'a deadline-completed capture cannot resume');
});

for (const fixedStopFrame of [undefined, false]) {
	test(`ordinary bounded punch retains its recorded duration through a pause (${String(fixedStopFrame)})`, () => {
		const recording = createProcessor(fixedStopFrame);
		recording.process();
		recording.send({ type: 'pause' });
		recording.process(1);
		recording.send({ type: 'resume' });
		recording.process();
		assert.equal(recording.processor.recording, true);
		assert.equal(recording.processor.stopFrame, 512);
		recording.process();
		assert.equal(recording.processor.recording, false);
		assert.deepEqual(capturedChunks(recording.messages).map(({ frameStart }) => frameStart), [0, 256, 384]);
	});
}

function createNode() {
	return {
		port: { onmessage: null, start() {}, postMessage() {} },
		connect() {},
		disconnect() {},
	};
}

test('the microphone controller carries a timed deadline to its actual worklet node', async () => {
	let processorOptions: Readonly<Record<string, unknown>> | null = null;
	const options = {
		context: {
			destination: createNode(),
			audioWorklet: { async addModule() {} },
			createMediaStreamSource: createNode,
		},
		stream: { getTracks: () => [] },
		fixedStopFrame: true,
		nodeFactory: (_context: unknown, _name: string, options: { readonly processorOptions: Readonly<Record<string, unknown>> }) => {
			processorOptions = options.processorOptions;
			return createNode();
		},
	};
	const controller = await createRecordingController(options);
	try {
		assert.ok(processorOptions);
		assert.equal((processorOptions as Readonly<Record<string, unknown>>).fixedStopFrame, true);
	} finally {
		await controller.dispose();
	}
});

for (const kind of ['legacy', 'routed'] as const) {
	for (const timed of [true, false]) {
		test(`${kind} capture distinguishes an absolute timed end from an ordinary selected punch (${String(timed)})`, async () => {
			const fixture = createRecordingCaptureFixture({ selection: timed ? null : { startFrame: 20, endFrame: 80 } });
			if (kind === 'routed') fixture.state.recordingRouting = {
				routes: { 'track-1': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 } },
				offsets: {},
			};
			const service = kind === 'legacy'
				? createLegacyRecordingCaptureService(fixture.runtime)
				: createRoutedRecordingCaptureService(fixture.runtime);
			await service.capture({ trackId: 'track-1', ...(timed ? { timedStartTimeMs: 2_000, timedEndTimeMs: 3_000 } : {}) }, createScope(() => true));
			assert.equal(fixture.recorderCreations(), 1);
			const options = fixture.recorderOptions();
			assert.ok(options);
			assert.equal((options as unknown as { readonly fixedStopFrame?: boolean }).fixedStopFrame === true, timed);
			assert.ok(Number.isFinite(fixture.recorderStartOptions[0]?.stopFrame));
		});
	}
}
