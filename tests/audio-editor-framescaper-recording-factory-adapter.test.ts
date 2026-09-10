/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptFramescaperRecordingControllerFactory } from '../src/common/editor/controller/capture/framescaper-recording-factory-adapter.ts';
import type { RecordingControllerFactoryOptions } from '../src/common/editor/controller/recording/recording-transaction-types.ts';

function input() {
	return {
		context: { sampleRate: 48000, currentTime: 0, resume: async () => {} },
		stream: { getAudioTracks: () => [] }, channelCount: 2, chunkFrames: 128,
		monitor: false, inputGain: 1, maxPendingChunks: 4,
		onChunk: async () => {}, onError: () => {},
	};
}

test('recording adapter preserves host ownership and waits for chunk consumers', async () => {
	let captured: RecordingControllerFactoryOptions | undefined;
	const controller = { start() {}, pause() {}, resume() {}, setMonitoring() {}, setInputGain() {}, stop: async () => {} };
	const adapted = adaptFramescaperRecordingControllerFactory(async options => {
		captured = options;
		return controller;
	});
	assert.ok(adapted);
	const options = input();
	let release = () => {};
	const pending = new Promise<void>(resolve => { release = resolve; });
	options.onChunk = () => pending;
	assert.equal(await adapted(options), controller);
	assert.ok(captured);
	assert.equal(captured.context, options.context);
	assert.equal(captured.stream, options.stream);
	assert.equal(captured.chunkFrames, 128);
	assert.equal(captured.maxPendingChunks, 4);
	captured.onState('recording');
	let finished = false;
	const delivery = captured.onChunk({ frameStart: 0, frames: 1, channels: [new Float32Array(1)] }).then(() => { finished = true; });
	await Promise.resolve();
	assert.equal(finished, false);
	release();
	await delivery;
	assert.equal(finished, true);
});

test('recording adapter rejects invalid hosts before allocating a recorder', async () => {
	let calls = 0;
	const adapted = adaptFramescaperRecordingControllerFactory(async () => {
		calls += 1;
		return { start() {}, pause() {}, resume() {}, setMonitoring() {}, setInputGain() {}, stop: async () => {} };
	});
	assert.ok(adapted);
	for (const context of [null, {}, { sampleRate: 0, currentTime: 0, resume() {} }]) {
		await assert.rejects(async () => adapted({ ...input(), context }), /audio context/i);
	}
	await assert.rejects(async () => adapted({ ...input(), stream: {} }), /media stream/i);
	assert.equal(calls, 0);
	assert.equal(adaptFramescaperRecordingControllerFactory(), undefined);
});
