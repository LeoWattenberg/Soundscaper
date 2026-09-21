/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ChunkStreamClient } from '../src/common/editor/chunk-stream-client.js';

for (const scenario of ['caller cancellation', 'protocol failure']) {
	test(`chunk stream ${scenario} rejects and detaches through the same terminal settlement`, async () => {
		const worker = new Endpoint();
		const outputPort = new Endpoint();
		const client = new ChunkStreamClient({ workerFactory: () => worker });
		const handle = client.open({
			streamId: `settlement-${scenario}`,
			source: {
				channelCount: 1,
				frameCount: 128,
				chunkFrames: 128,
				async readStorageChunk() { return [new Float32Array(128)]; },
			},
			outputPort,
		});
		const rejected = Promise.all([handle.ready, handle.primed, handle.done].map(async (promise) => {
			try {
				await promise;
				return null;
			} catch (error) {
				return error;
			}
		}));

		if (scenario === 'caller cancellation') handle.cancel('manual stop');
		else worker.dispatch({
			type: 'stream-ready',
			streamId: handle.streamId,
			protocolVersion: 99,
		});

		const errors = await rejected;
		assert.equal(errors.every((error) => error === errors[0]), true);
		assert.equal(handle.state, 'closed');
		assert.equal(client.streams.size, 0);
		const expectedReason = scenario === 'caller cancellation'
			? 'manual stop'
			: 'Unsupported worker protocol version 99.';
		for (const endpoint of [worker, outputPort]) {
			assert.deepEqual(endpoint.messages.at(-1), {
				type: 'cancel-stream',
				streamId: handle.streamId,
				reason: expectedReason,
			});
		}
		client.dispose();
	});
}

class Endpoint {
	listeners = new Set();
	messages = [];

	addEventListener(type, listener) {
		if (type === 'message') this.listeners.add(listener);
	}

	removeEventListener(type, listener) {
		if (type === 'message') this.listeners.delete(listener);
	}

	start() {}

	postMessage(message) {
		this.messages.push(message);
	}

	dispatch(data) {
		for (const listener of this.listeners) listener({ data });
	}

	terminate() {}
}
