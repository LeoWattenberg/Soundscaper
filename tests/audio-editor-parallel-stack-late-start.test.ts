/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { Worker as NodeWorker } from 'node:worker_threads';
import { createParallelStackSession, type ParallelStackSessionResources } from '../src/common/editor/controller/transport/internal/parallel-stack-session.ts';
import { parallelStackSourceStartTime, type ParallelStackPlaybackRequest } from '../src/common/editor/engine/parallel-stack-playback.ts';
import { compileParallelStackPlan } from '../src/common/editor/engine/parallel-stack-plan.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import type { LateStartResult } from './fixtures/parallel-stack-late-start-worker.ts';

function project(): EngineProject {
	const strip = (id: string) => ({ id, name: id, color: '', gain: 1, pan: 0,
		mute: false, solo: false, collapsed: false, effectsActive: true, effects: [], channelCount: 2 });
	const edge = (id: string, source: object, destination: object) => ({
		id, kind: 'assignment', source, destination, position: 'post-fader',
		level: 1, enabled: true, channelMap: [0, 1],
	});
	return {
		schemaFamily: 'soundscaper', schemaVersion: 1, sampleRate: 48_000, masterChannels: 2,
		tracks: [{ ...strip('track'), type: 'audio' }], master: strip('master'),
		mixer: { schemaVersion: 1, groups: [], sends: [], cues: [], vcas: [],
			outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 2 }],
			edges: [edge('track-master', { kind: 'track', id: 'track' }, { kind: 'master' }),
				edge('master-main', { kind: 'master' }, { kind: 'output', id: 'main' })] },
	} as unknown as EngineProject;
}

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
	const engineProject = project();
	const plan = compileParallelStackPlan(engineProject, { sampleRate: 48_000, workerCount: 1 });
	const request = { context, destination: {} as AudioNode, project: engineProject, metering: false,
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
