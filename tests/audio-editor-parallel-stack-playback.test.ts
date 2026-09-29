/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	cancelParallelStackPreparation,
	prepareParallelStackPlayback,
	registerParallelStackPlayback,
	type ParallelStackPlaybackRequest,
} from '../src/common/editor/engine/parallel-stack-playback.ts';
import { buildPlaybackGraph } from '../src/common/editor/engine/playback-graph.ts';
import { createAudioPreviewProject } from '../src/common/editor/engine/audio-preview-project.ts';
import { readParallelStackStatus } from '../src/common/editor/engine/parallel-stack-preferences.ts';
import { ENGINE_HANDLE_SCHEDULING_ERROR } from '../src/common/editor/engine/runtime-symbols.ts';
import type { EngineRuntimeHost } from '../src/common/editor/engine/runtime-types.ts';
import type { ProjectGraph } from '../src/common/editor/engine/project-graph.ts';
import { MockAudioContext } from './helpers/mock-audio-context.js';

const request = {} as ParallelStackPlaybackRequest;

test('unregistered engines retain the conventional playback graph', async () => {
	assert.equal(await prepareParallelStackPlayback({}, request), null);
});

test('stop aborts a pending graph and later preparations have fresh signals', async () => {
	const engine = {};
	const signals: AbortSignal[] = [];
	registerParallelStackPlayback(engine, (_request, signal) => {
		signals.push(signal);
		return new Promise((resolve) => signal.addEventListener('abort', () => resolve(null), { once: true }));
	});
	const first = prepareParallelStackPlayback(engine, request);
	assert.equal(signals.length, 1);
	cancelParallelStackPreparation(engine);
	assert.equal(signals[0]!.aborted, true);
	await assert.rejects(first, { name: 'AbortError' });
	const second = prepareParallelStackPlayback(engine, request);
	assert.equal(signals[1]!.aborted, false);
	cancelParallelStackPreparation(engine);
	await assert.rejects(second, { name: 'AbortError' });
});

test('a newer preparation retires its predecessor without clearing the new request', async () => {
	const engine = {};
	const signals: AbortSignal[] = [];
	registerParallelStackPlayback(engine, (_request, signal) => {
		signals.push(signal);
		return new Promise((resolve) => signal.addEventListener('abort', () => resolve(null), { once: true }));
	});
	const first = prepareParallelStackPlayback(engine, request);
	const second = prepareParallelStackPlayback(engine, request);
	await assert.rejects(first, { name: 'AbortError' });
	assert.equal(signals[0]!.aborted, true);
	assert.equal(signals[1]!.aborted, false);
	cancelParallelStackPreparation(engine);
	await assert.rejects(second, { name: 'AbortError' });
	assert.equal(signals[1]!.aborted, true);
});

test('cancellation after a factory returns retires the graph before rejecting it', async () => {
	const engine = {};
	const graph = { abortController: new AbortController() } as ProjectGraph;
	registerParallelStackPlayback(engine, () => {
		const result = Promise.resolve(graph);
		queueMicrotask(() => cancelParallelStackPreparation(engine));
		return result;
	});
	await assert.rejects(prepareParallelStackPlayback(engine, request), { name: 'AbortError' });
	assert.equal(graph.abortController.signal.aborted, true);
});

test('a worker fault during graph handoff stops playback before the graph can be scheduled', async () => {
	const error = new Error('Worker missed its deadline');
	const graph = { abortController: new AbortController() } as ProjectGraph;
	const errors: unknown[] = [];
	const engine = {
		context: {}, project: {}, scrubGeneration: 1, disposed: false,
		graph: null, meterListeners: new Set(), playbackMode: 'normal', playbackRate: 1,
		projectGraphSelection: 'v21',
		[ENGINE_HANDLE_SCHEDULING_ERROR]: (failure: unknown) => { errors.push(failure); },
	} as unknown as EngineRuntimeHost;
	registerParallelStackPlayback(engine, async (input) => {
		input.onFailure(error);
		return graph;
	});
	await assert.rejects(Promise.resolve(buildPlaybackGraph(engine, {} as AudioNode, 0)), error);
	assert.equal(graph.abortController.signal.aborted, true);
	assert.deepEqual(errors, [error]);
});

test('a worker fault after graph handoff retires it before transport can assign it', async () => {
	const error = new Error('Worker missed its deadline');
	const graph = { abortController: new AbortController() } as ProjectGraph;
	const errors: unknown[] = [];
	let fail: (error: Error) => void = () => { throw new Error('No active graph'); };
	const engine = {
		context: {}, project: {}, scrubGeneration: 1, disposed: false,
		graph: null, meterListeners: new Set(), playbackMode: 'normal', playbackRate: 1,
		projectGraphSelection: 'v21',
		[ENGINE_HANDLE_SCHEDULING_ERROR]: (failure: unknown) => { errors.push(failure); },
	} as unknown as EngineRuntimeHost;
	registerParallelStackPlayback(engine, async (input) => {
		fail = input.onFailure;
		return graph;
	});
	assert.equal(await buildPlaybackGraph(engine, {} as AudioNode, 0), graph);
	fail(error);
	assert.equal(graph.abortController.signal.aborted, true);
	assert.equal(graph.abortController.signal.reason, error);
	assert.deepEqual(errors, [error]);
});

test('an explicit legacy graph selection cannot be replaced by parallel admission', () => {
	const context = new MockAudioContext({ sampleRate: 48_000 });
	const project = createAudioPreviewProject({ sampleRate: 48_000, sources: [], clips: [], tracks: [] });
	let preparations = 0;
	const engine = {
		context, project, scrubGeneration: 1, disposed: false,
		graph: null, meterListeners: new Set(), playbackMode: 'normal', playbackRate: 1,
		projectGraphSelection: 'legacy',
	} as unknown as EngineRuntimeHost;
	registerParallelStackPlayback(engine, async () => {
		preparations += 1;
		return { abortController: new AbortController() } as ProjectGraph;
	});
	const graph = buildPlaybackGraph(engine, context.destination as unknown as AudioNode, 0);
	assert.equal(graph instanceof Promise, false);
	assert.ok(graph);
	assert.equal(preparations, 0);
	assert.match(readParallelStackStatus(engine).reason ?? '', /production V21 mixer graph/);
});
