/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { Worker as NodeWorker } from 'node:worker_threads';
import { createParallelStackSession, type ParallelStackSessionResources } from '../src/common/editor/controller/transport/internal/parallel-stack-session.ts';
import { parallelStackSourceStartTime, type ParallelStackPlaybackRequest } from '../src/common/editor/engine/parallel-stack-playback.ts';
import type { ParallelStackPlan } from '../src/common/editor/engine/parallel-stack-types.ts';
import type { LateStartResult } from './fixtures/parallel-stack-late-start-worker.ts';

test('a late start message chooses a future audio frame on the actual worklet thread', { timeout: 10_000 }, async () => {
	const worker = new NodeWorker(new URL('./fixtures/parallel-stack-late-start-worker.ts', import.meta.url));
	try {
		const [result] = await once(worker, 'message') as [LateStartResult];
		assert.equal(result.requested, 0);
		assert.ok(result.actual >= 768);
		assert.equal(result.actual % 128, 0);
		assert.equal(result.before, true);
		assert.equal(result.active, true);
		assert.equal(result.fault, 0);
	} finally { await worker.terminate(); }
});

test('the session schedules sources from the worklet acknowledged frame when startup is late', async () => {
	class Port extends EventTarget {
		generation = 0;
		workerIndex = 0;
		postMessage(message: { type: string; startFrame?: number; shared?: { geometry: { generation: number } }; workerIndex?: number }): void {
			if (message.shared) this.generation = message.shared.geometry.generation;
			if (message.workerIndex !== undefined) this.workerIndex = message.workerIndex;
			const startFrame = message.startFrame === undefined ? undefined : message.startFrame + 512;
			queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: {
				type: message.type === 'start' ? 'started' : 'ready', generation: this.generation,
				workerIndex: this.workerIndex, startFrame,
			} })));
		}
		start(): void {}
		close(): void {}
	}
	const port = new Port();
	const context = { sampleRate: 48_000, currentTime: 0, createGain: () => ({
		connect: () => {}, disconnect: () => {}, channelCount: 2,
	}) } as unknown as AudioContext;
	const plan = {
		blockFrames: 256, bankCount: 8, workerCount: 1, planeCount: 2,
		tasks: [{ worker: 0, dependencies: [] }], tracks: [{ id: 'track', channels: 1, inputPlanes: [0] }],
		outputs: [{ id: 'main', role: 'main', channels: 1, planes: [1] }], stripTaps: [],
		inputPlaneIndices: [[0]], outputPlaneIndices: [[1]], latencyFrames: 0,
	} as unknown as ParallelStackPlan;
	const request = { context, destination: {} as AudioNode, project: {}, metering: false,
		playbackMode: 'normal', playbackRate: 1, fromFrame: 0, onFailure: () => {},
	} as ParallelStackPlaybackRequest;
	const resources: ParallelStackSessionResources = {
		loadWorklet: async () => {},
		createWorker: () => Object.assign(new Port(), { terminate: () => {} }) as unknown as Worker,
		createNode: (_context, options) => {
			port.generation = (options.processorOptions as { shared: { geometry: { generation: number } } }).shared.geometry.generation;
			queueMicrotask(() => port.dispatchEvent(new MessageEvent('message', { data: { type: 'ready', generation: port.generation } })));
			return Object.assign(new EventTarget(), { port, connect: () => {}, disconnect: () => {} }) as unknown as AudioWorkletNode;
		},
	};
	const graph = await createParallelStackSession(request, plan, 768, new AbortController().signal, resources);
	try {
		assert.equal(parallelStackSourceStartTime(graph, 0), (Math.ceil(0.05 * 48_000 / 128) * 128 + 512) / 48_000);
	} finally { graph.abortController.abort(); }
});
