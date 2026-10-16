/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRecordingController } from '../src/common/editor/recording.js';
import { StreamingRecorderProcessor } from '../src/common/editor/recording-worklet.js';

interface WorkletMessage extends Readonly<Record<string, unknown>> {
	readonly type: string;
}

interface Processor {
	readonly port: {
		onmessage: (event: Readonly<{ data: WorkletMessage }>) => void;
		postMessage: (message: WorkletMessage) => void;
	};
	process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

for (const confirmed of [true, false]) {
	test(`${confirmed ? 'confirmed' : 'ordinary'} recording accepts the actual worklet start and captures PCM`, async () => {
		const processor = new StreamingRecorderProcessor({ processorOptions: {
			channelCount: 1, chunkFrames: 128,
		} }) as unknown as Processor;
		const pending: WorkletMessage[] = [];
		processor.port.postMessage = (message) => { pending.push(message); };
		const chunks: Float32Array[][] = [];
		const errors: unknown[] = [];
		const node = { connect() {}, disconnect() {}, port: {
			onmessage: null as null | ((event: Readonly<{ data: WorkletMessage }>) => void),
			postMessage(message: WorkletMessage) { processor.port.onmessage({ data: message }); },
			start() {}, close() {},
		} };
		const options = {
			chunkFrames: 128,
			context: { sampleRate: 48_000, destination: {},
				audioWorklet: { async addModule() {} },
				createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
			},
			stream: { getTracks: () => [] }, nodeFactory: () => node,
			onChunk: (chunk: Readonly<{ channels: Float32Array[] }>) => { chunks.push(chunk.channels); },
			onError: (error: unknown) => { errors.push(error); },
		};
		const controller = await createRecordingController(options);
		const receive = (): void => {
			while (pending.length) node.port.onmessage?.({ data: pending.shift()! });
		};
		try {
			const start = confirmed ? controller.startConfirmed({ startFrame: 0 }) : controller.start();
			assert.equal(pending[0]?.type, 'started');
			assert.doesNotThrow(receive, 'the real unconfirmed started message belongs to ordinary recording');
			await start;
			assert.equal(controller.state, 'recording');
			processor.process([[new Float32Array(128).fill(0.25)]], [[new Float32Array(128)]]);
			receive();
			const stopped = controller.stop();
			receive();
			await stopped;
			assert.equal(controller.state, 'stopped');
			assert.equal(chunks.length, 1);
			assert.equal(chunks[0]?.[0]?.length, 128);
			assert.equal(chunks[0]?.[0]?.[100], 0.25);
			assert.deepEqual(errors, []);
		} finally {
			const disposed = controller.dispose();
			receive();
			await disposed;
		}
	});
}
