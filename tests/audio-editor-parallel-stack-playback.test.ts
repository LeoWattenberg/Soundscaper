/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	cancelParallelStackPreparation,
	prepareParallelStackPlayback,
	registerParallelStackPlayback,
	type ParallelStackPlaybackRequest,
} from '../src/common/editor/engine/parallel-stack-playback.ts';
import type { ProjectGraph } from '../src/common/editor/engine/project-graph.ts';

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
