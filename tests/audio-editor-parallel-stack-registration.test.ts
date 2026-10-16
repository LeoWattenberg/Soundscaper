/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { installParallelStackPlayback } from '../src/common/editor/controller/transport/internal/parallel-stack-registration.ts';
import { prepareParallelStackPlayback, type ParallelStackPlaybackRequest } from '../src/common/editor/engine/parallel-stack-playback.ts';
import { readParallelStackPreferences, readParallelStackStatus, writeParallelStackPreferences, type ParallelStackPreferences } from '../src/common/editor/engine/parallel-stack-preferences.ts';
import type { ProjectGraph } from '../src/common/editor/engine/project-graph.ts';

const request: ParallelStackPlaybackRequest = {
	context: { sampleRate: 48000 } as AudioContext, destination: {} as AudioNode,
	project: {}, metering: false, playbackMode: 'normal', playbackRate: 1, fromFrame: 0, onFailure: () => {},
};

test('disabled preferences and unavailable isolation never prepare a DSP worker', async () => {
	const engine = {};
	let enabled = false;
	installParallelStackPlayback(engine, {
		preferences: () => ({ enabled, workerLimit: 'auto', pipelineFrames: 768 }),
		supported: () => false,
		prepare: () => { throw new Error('must not prepare'); },
	});
	assert.equal(await prepareParallelStackPlayback(engine, request), null);
	assert.equal(readParallelStackStatus(engine).state, 'off');
	enabled = true;
	assert.equal(await prepareParallelStackPlayback(engine, request), null);
	assert.equal(readParallelStackStatus(engine).state, 'unsupported');
});

test('shared audio workers require isolation, shared memory, workers and worklets in either host', async () => {
	const preferences = readParallelStackPreferences();
	const capabilities = {
		crossOriginIsolated: true,
		SharedArrayBuffer: globalThis.SharedArrayBuffer,
		Worker: function Worker() {},
		AudioWorkletNode: function AudioWorkletNode() {},
	};
	const prior = new Map(Object.keys(capabilities)
		.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	const engine = {};
	const variableSpeed = { ...request, playbackRate: 2 };
	try {
		writeParallelStackPreferences({ ...preferences, enabled: true });
		installParallelStackPlayback(engine);
		for (const unavailable of Object.keys(capabilities)) {
			for (const [key, value] of Object.entries(capabilities)) {
				Object.defineProperty(globalThis, key, {
					configurable: true, value: key === unavailable ? undefined : value,
				});
			}
			assert.equal(await prepareParallelStackPlayback(engine, variableSpeed), null);
			assert.equal(readParallelStackStatus(engine).reason,
				'Shared-memory audio workers are unavailable in this session.');
		}
		for (const [key, value] of Object.entries(capabilities)) {
			Object.defineProperty(globalThis, key, { configurable: true, value });
		}
		assert.equal(await prepareParallelStackPlayback(engine, variableSpeed), null);
		assert.match(readParallelStackStatus(engine).reason ?? '', /normal-speed playback/u);
	} finally {
		for (const key of Object.keys(capabilities)) {
			const descriptor = prior.get(key);
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
		writeParallelStackPreferences(preferences);
	}
});

test('one failed generation falls back on next Play and changing configuration permits a retry', async () => {
	const engine = {};
	let preferences: ParallelStackPreferences = { enabled: true, workerLimit: 2, pipelineFrames: 768 };
	let preparations = 0;
	let fail: (error: Error) => void = () => { throw new Error('No active generation'); };
	installParallelStackPlayback(engine, {
		preferences: () => preferences, supported: () => true,
		prepare: async (input) => {
			preparations++;
			fail = input.onFailure;
			return { abortController: new AbortController() } as ProjectGraph;
		},
	});
	const first = await prepareParallelStackPlayback(engine, request);
	assert.ok(first);
	fail(new Error('Deadline missed'));
	first.abortController.abort();
	assert.equal(readParallelStackStatus(engine).state, 'failed');
	assert.equal(await prepareParallelStackPlayback(engine, request), null);
	assert.equal(preparations, 1);
	preferences = { ...preferences, pipelineFrames: 1536 };
	const second = await prepareParallelStackPlayback(engine, request);
	assert.ok(second);
	assert.equal(preparations, 2);
	assert.equal(readParallelStackStatus(engine).state, 'active');
	second.abortController.abort();
	assert.equal(readParallelStackStatus(engine).state, 'ready');
	fail(new Error('Second missed deadline'));
	assert.equal(await prepareParallelStackPlayback(engine, request), null);
	const storage = { setItem: () => {} };
	writeParallelStackPreferences({ ...preferences, enabled: false }, { storage });
	writeParallelStackPreferences(preferences, { storage });
	const retried = await prepareParallelStackPlayback(engine, request);
	assert.ok(retried, 'an explicit off/on change permits a retry even without pressing Play while disabled');
	retried.abortController.abort();
});

test('admission failure preserves a visible reason and returns the conventional graph path', async () => {
	const engine = {};
	installParallelStackPlayback(engine, {
		preferences: () => ({ enabled: true, workerLimit: 2, pipelineFrames: 768 }), supported: () => true,
		prepare: async () => { throw new Error('Unsupported reverb'); },
	});
	assert.equal(await prepareParallelStackPlayback(engine, request), null);
	assert.deepEqual(readParallelStackStatus(engine), { state: 'unsupported', reason: 'Unsupported reverb' });
});
