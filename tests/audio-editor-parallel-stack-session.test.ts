/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createParallelStackSession,
	type ParallelStackSessionResources,
} from '../src/common/editor/controller/transport/internal/parallel-stack-session.ts';
import type { ParallelStackPlaybackRequest } from '../src/common/editor/engine/parallel-stack-playback.ts';
import type { ParallelStackPlan } from '../src/common/editor/engine/parallel-stack-types.ts';

class Port extends EventTarget {
	closed = false;
	generation = 0;
	workerIndex = 0;
	postMessage(message: { type: string; startFrame?: number; shared?: { geometry: { generation: number } }; workerIndex?: number }): void {
		if (message.shared) this.generation = message.shared.geometry.generation;
		if (message.workerIndex !== undefined) this.workerIndex = message.workerIndex;
		queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', {
			data: { type: message.type === 'start' ? 'started' : 'ready', startFrame: message.startFrame, generation: this.generation, workerIndex: this.workerIndex },
		})));
	}
	start(): void { /* EventTarget already receives messages. */ }
	close(): void { this.closed = true; }
}

class WorkerPort extends Port {
	terminated = false;
	terminate(): void { this.terminated = true; }
}

function fixture() {
	const workers: WorkerPort[] = [];
	const port = new Port();
	const node = Object.assign(new EventTarget(), { port, connect: () => {}, disconnect: () => {} }) as unknown as AudioWorkletNode;
	const context = {
		sampleRate: 48_000, currentTime: 1,
		createGain: () => ({ connect: () => {}, disconnect: () => {}, channelCount: 2 }),
	} as unknown as AudioContext;
	const plan = {
		version: 1, blockFrames: 256, bankCount: 8, workerCount: 2, planeCount: 4, latencyFrames: 0,
		tasks: [{ worker: 0, dependencies: [] }, { worker: 1, dependencies: [0] }],
		tracks: [{ id: 'a', channels: 2, inputPlanes: [0, 1] }],
		outputs: [{ id: 'main', role: 'main', channels: 2, planes: [2, 3] }],
		stripTaps: [], inputPlaneIndices: [[0, 1]], outputPlaneIndices: [[2, 3]],
	} as unknown as ParallelStackPlan;
	const request = {
		context, destination: {} as AudioNode, project: {}, metering: false,
		playbackMode: 'normal', playbackRate: 1, fromFrame: 0, onFailure: () => {},
	} as ParallelStackPlaybackRequest;
	const resources: ParallelStackSessionResources = {
		loadWorklet: async () => {},
		createWorker: () => {
			const worker = new WorkerPort();
			workers.push(worker);
			return worker as unknown as Worker;
		},
		createNode: (_context, options) => {
			port.generation = (options.processorOptions as { shared: { geometry: { generation: number } } }).shared.geometry.generation;
			queueMicrotask(() => port.dispatchEvent(new MessageEvent('message', { data: { type: 'ready', generation: port.generation } })));
			return node;
		},
	};
	return { workers, port, request, resources, plan };
}

test('session starts every worker before arming and owns disposal through graph abort', async () => {
	const { workers, port, request, resources, plan } = fixture();
	const graph = await createParallelStackSession(request, plan, 768, new AbortController().signal, resources);
	assert.equal(workers.length, 2);
	assert.equal(graph.latencyFrames, 768);
	assert.equal(graph.trackInputs.size, 1);
	assert.equal(port.closed, false);
	graph.abortController.abort();
	graph.abortController.abort();
	assert.ok(workers.every((worker) => worker.terminated));
	assert.equal(port.closed, true);
});

test('cancel during worker preparation terminates every created worker', async () => {
	const { workers, request, resources, plan } = fixture();
	const signal = new AbortController();
	const pending = createParallelStackSession(request, plan, 768, signal.signal, {
		...resources,
		createWorker: () => {
			const worker = new WorkerPort();
			worker.postMessage = () => {};
			workers.push(worker);
			queueMicrotask(() => signal.abort());
			return worker as unknown as Worker;
		},
	});
	await assert.rejects(pending, { name: 'AbortError' });
	assert.ok(workers.length > 0);
	assert.ok(workers.every((worker) => worker.terminated));
});

test('worker construction failure cleans up peers already prepared', async () => {
	const { workers, request, resources, plan } = fixture();
	let calls = 0;
	await assert.rejects(createParallelStackSession(request, plan, 768, new AbortController().signal, {
		...resources,
		createWorker: (index) => {
			if (++calls === 2) throw new Error('Worker quota');
			return resources.createWorker(index);
		},
	}), /Worker quota/u);
	assert.ok(workers.every((worker) => worker.terminated));
});
