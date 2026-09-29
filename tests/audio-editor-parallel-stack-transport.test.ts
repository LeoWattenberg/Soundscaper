/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import { buildProjectGraph, type ProjectGraph } from '../src/common/editor/engine/project-graph.ts';
import { registerParallelStackPlayback } from '../src/common/editor/engine/parallel-stack-playback.ts';
import type { EngineRuntimeHost } from '../src/common/editor/engine/runtime-types.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import { createProject } from './helpers/audio-editor-runtime-harness.js';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';

function delayedPlayback(graphLatencyFrames: number | null = null) {
	const context = new MockAudioContext({ sampleRate: 48_000 });
	const engine = createAudioEditorEngine({ audioContextFactory: () => context as never });
	engine.loadProject(createProject() as EngineProject, new Map([
		['source-1', new MockAudioBuffer(1, 48_000, 48_000) as unknown as AudioBuffer],
	]));
	const runtime = engine as unknown as EngineRuntimeHost;
	// A controlled graph stands in for asynchronous desktop worker startup.
	runtime.projectGraphSelection = 'v21';
	let release: () => void = () => { throw new Error('Preparation has not begun'); };
	let started: () => void = () => { throw new Error('Preparation has not begun'); };
	const entered = new Promise<void>((resolve) => { started = resolve; });
	const meteringRequests: boolean[] = [];
	registerParallelStackPlayback(runtime, (request, signal) => {
		meteringRequests.push(request.metering);
		const graph = buildProjectGraph(request.context, request.destination, request.project, {
			graph: 'legacy', metering: request.metering,
		});
		if (graphLatencyFrames !== null) Object.assign(graph, { latencyFrames: graphLatencyFrames });
		if (meteringRequests.length > 1) return Promise.resolve(graph);
		started();
		return new Promise<ProjectGraph>((resolve, reject) => {
			const aborted = (): void => { reject(new DOMException('Playback cancelled', 'AbortError')); };
			signal.addEventListener('abort', aborted, { once: true });
			release = () => { signal.removeEventListener('abort', aborted); resolve(graph); };
		});
	});
	return { engine, runtime, entered, meteringRequests, release: () => release() };
}

test('a loop changed during worker startup bounds the first scheduled run', async () => {
	const { engine, runtime, entered, release } = delayedPlayback();
	const playing = engine.play();
	await entered;
	assert.equal(engine.getState().state, 'stopped');
	engine.setLoop({ enabled: true, startFrame: 0, endFrame: 4_800 });
	release();
	await playing;
	assert.equal(runtime.playEndFrame, 4_800);
	engine.stop();
	await engine.dispose();
});

test('a short play range changed during worker startup bounds the first scheduled run', async () => {
	const { engine, runtime, entered, release } = delayedPlayback();
	const playing = engine.play();
	await entered;
	engine.setPlayRange({ startFrame: 0, endFrame: 6_000 });
	release();
	await playing;
	assert.equal(runtime.playEndFrame, 6_000);
	engine.stop();
	await engine.dispose();
});

test('a meter added during worker startup receives a metered graph', async () => {
	const { engine, runtime, entered, meteringRequests, release } = delayedPlayback();
	const playing = engine.play();
	await entered;
	const unsubscribe = engine.subscribeMeters(() => {});
	release();
	await playing;
	assert.deepEqual(meteringRequests, [false, true]);
	assert.ok(runtime.graph?.masterAnalyser);
	unsubscribe();
	engine.stop();
	await engine.dispose();
});

test('a newer Play retires a still preparing Play without resurrecting its graph', async () => {
	const { engine, runtime, entered, meteringRequests } = delayedPlayback();
	const first = engine.play();
	await entered;
	const second = engine.play();
	await Promise.all([first, second]);
	assert.equal(engine.getState().state, 'playing');
	assert.equal(meteringRequests.length, 2);
	assert.ok(runtime.graph);
	assert.equal(runtime.graph.abortController.signal.aborted, false);
	engine.stop();
	await engine.dispose();
});

test('clocked recording starts can read active graph latency in context frames', async () => {
	const { engine, entered, release } = delayedPlayback(1_536);
	assert.equal(engine.getPlaybackGraphLatencyFrames(), 0);
	const starting = engine.playAt(0, 0);
	await entered;
	release();
	await starting;
	assert.equal(engine.getPlaybackGraphLatencyFrames(), 1_536);
	engine.stop();
	assert.equal(engine.getPlaybackGraphLatencyFrames(), 0);
	await engine.dispose();
});

test('a worker startup fault rejects clocked playAt without reporting the fault twice', async () => {
	const context = new MockAudioContext({ sampleRate: 48_000 });
	const engine = createAudioEditorEngine({ audioContextFactory: () => context as never });
	engine.loadProject(createProject() as EngineProject, new Map([
		['source-1', new MockAudioBuffer(1, 48_000, 48_000) as unknown as AudioBuffer],
	]));
	const runtime = engine as unknown as EngineRuntimeHost;
	runtime.projectGraphSelection = 'v21';
	const fault = new Error('Parallel worker missed its deadline');
	const errors: unknown[] = [];
	const unsubscribe = engine.subscribePlaybackErrors((error) => { errors.push(error); });
	registerParallelStackPlayback(runtime, async (request) => {
		const graph = buildProjectGraph(request.context, request.destination, request.project, { graph: 'legacy' });
		request.onFailure(fault);
		return graph;
	});
	await assert.rejects(engine.playAt(0, 0), fault);
	assert.deepEqual(errors, [fault]);
	assert.equal(engine.getState().state, 'stopped');
	unsubscribe();
	await engine.dispose();
});
