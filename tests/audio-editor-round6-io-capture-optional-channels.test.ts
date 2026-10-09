/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperBrowserAudioRecorder, type FramescaperWorkletRecordingControllerFactory } from '../src/common/editor/controller/capture/internal/browser/framescaper-browser-audio-recorder.ts';

test('an omitted hardware channel setting uses the observed native worklet input width', async () => {
	const chunks: Array<readonly Float32Array[]> = [];
	const context = { sampleRate: 48_000 };
	const stream = {};
	let probeCalls = 0;
	let deliver: Parameters<FramescaperWorkletRecordingControllerFactory>[0]['onChunk'] | undefined;
	const recorder = await createFramescaperBrowserAudioRecorder({ role: 'microphone',
		track: { kind: 'audio', getSettings: () => ({}) }, stream, context,
		probeInputChannelCount: async (receivedContext: unknown, receivedStream: unknown) => {
			assert.equal(receivedContext, context); assert.equal(receivedStream, stream);
			probeCalls += 1; return 2;
		},
		MediaStreamTrackProcessor: null,
		recordingControllerFactory: (input) => {
			assert.equal(input.channelCount, 2); deliver = input.onChunk;
			return { start() {}, pause() { return true; }, resume() { return true; }, async stop() {}, async detach() {} };
		},
		onChunk(chunk) { chunks.push(chunk.channels.map(channel => channel.slice())); },
	});
	assert.equal(recorder.channelCount, 2);
	assert.equal(recorder.sampleRate, 48_000);
	assert.equal(probeCalls, 1);
	await recorder.start();
	await deliver?.({ frameStart: 128, frames: 2, channels: [Float32Array.of(.25, .5), Float32Array.of(-.5, -.25)] });
	await recorder.stop();
	await recorder.dispose();
	assert.deepEqual(chunks.map(chunk => chunk.map(channel => [...channel])), [[[.25, .5], [-.5, -.25]]]);
});

test('reported invalid channel metadata is refused without substituting a probe width', async () => {
	let probes = 0;
	await assert.rejects(createFramescaperBrowserAudioRecorder({ role: 'microphone',
		track: { kind: 'audio', getSettings: () => ({ sampleRate: 48_000, channelCount: 0 }) }, stream: {},
		context: { sampleRate: 48_000 }, probeInputChannelCount: async () => { probes += 1; return 2; },
		onChunk() {},
	}), /actual channel count/iu);
	assert.equal(probes, 0);
});
