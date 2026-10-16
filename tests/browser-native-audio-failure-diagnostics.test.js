/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { sampleNativeAudioFailure } from './browser/helpers/native-audio-failure-diagnostics.js';

function fixture(failure = null) {
	const calls = [];
	let sample = 0;
	const session = {
		async send(method, parameters) {
			calls.push({ method, parameters });
			if (method === failure) throw new Error('diagnostic transport failed');
			if (method === 'Runtime.evaluate') return { result: { objectId: 'prototype' } };
			if (method === 'Runtime.queryObjects') return { objects: { objectId: 'contexts' } };
			if (method === 'Runtime.callFunctionOn') return { result: { value: {
				at: ++sample * 100, contexts: [{ state: 'running', currentTime: sample / 10 }],
			} } };
			return {};
		},
		async detach() { calls.push({ method: 'detach' }); },
	};
	const page = { context: () => ({
		async newCDPSession() { calls.push({ method: 'connect' }); return session; },
	}) };
	return { calls, page };
}

test('native failure evidence samples existing clocks without modifying audio contexts', async () => {
	const { page, calls } = fixture();
	let intervals = 0;
	const result = await sampleNativeAudioFailure(page, 'chromium', async () => { intervals += 1; });
	assert.equal(result.available, true);
	assert.deepEqual(result.samples.map(({ at, contexts }) => [at, contexts[0].currentTime]), [[100, 0.1], [200, 0.2]]);
	assert.equal(intervals, 1);
	assert.deepEqual(calls.map(({ method }) => method), [
		'connect', 'Runtime.evaluate', 'Runtime.queryObjects', 'Runtime.callFunctionOn',
		'Runtime.callFunctionOn', 'Runtime.releaseObjectGroup', 'detach',
	]);
	assert.equal(calls[1].parameters.expression, 'globalThis.AudioContext?.prototype');
	assert.equal(calls[2].parameters.prototypeObjectId, 'prototype');
	for (const { parameters } of calls.filter(({ method }) => method === 'Runtime.callFunctionOn')) {
		assert.equal(parameters.objectId, 'contexts');
		assert.equal(parameters.returnByValue, true);
		assert.doesNotMatch(parameters.functionDeclaration, /\.(?:resume|suspend|close|setSinkId)\s*\(/u);
		assert.match(parameters.functionDeclaration, /currentTime/u);
	}
});

test('a failed native clock probe retains its error and releases the session', async () => {
	const { page, calls } = fixture('Runtime.callFunctionOn');
	const result = await sampleNativeAudioFailure(page, 'chromium', async () => {});
	assert.equal(result.available, false);
	assert.match(result.error, /diagnostic transport failed/u);
	assert.deepEqual(calls.slice(-2).map(({ method }) => method), ['Runtime.releaseObjectGroup', 'detach']);
});

test('engines without CDP do not attempt native clock heap inspection', async () => {
	const { page, calls } = fixture();
	assert.equal((await sampleNativeAudioFailure(page, 'firefox')).available, false);
	assert.deepEqual(calls, []);
});

test('the snapshot distinguishes the native clock from the scheduled transport origin', async () => {
	const { page, calls } = fixture();
	await sampleNativeAudioFailure(page, 'chromium', async () => {});
	const declaration = calls.find(({ method }) => method === 'Runtime.callFunctionOn').parameters.functionDeclaration;
	const native = { state: 'running', currentTime: 10, getOutputTimestamp: () => ({ contextTime: 10 }) };
	const engine = { state: 'playing', context: native, positionFrame: 73_600,
		playbackStartFrame: 73_600, playbackStartTime: 12, playEndFrame: 96_000,
		playbackDurationFrames: 96_000, graph: { latencyFrames: 128 }, pendingPlayRequest: 0 };
	const preview = { dataset: { videoPreviewEvaluatedTimelineSample: '73600' },
		'__reactFiber$fixture': { return: { memoizedProps: { controller: { engine } } } } };
	const snapshot = runInNewContext(`(${declaration}).call(contexts)`, {
		contexts: [native], performance: { now: () => 5_000 },
		document: { querySelector: selector => selector === '[data-video-preview]' ? preview : null,
			querySelectorAll: () => [] },
	});
	assert.equal(snapshot.contexts[0].currentTime, 10);
	assert.equal(snapshot.transport.nativeTime, 10);
	assert.equal(snapshot.transport.playbackStartTime, 12);
	assert.equal(snapshot.transport.positionFrame, 73_600);
	assert.equal(snapshot.transport.playEndFrame, 96_000);
	assert.equal(snapshot.transport.graphLatencyFrames, 128);
	assert.equal(snapshot.preview.videoPreviewEvaluatedTimelineSample, '73600');
	assert.equal(engine.state, 'playing');
	assert.equal(native.state, 'running');
});
