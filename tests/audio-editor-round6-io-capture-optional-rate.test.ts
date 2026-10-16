/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperBrowserAudioRecorder, type FramescaperWorkletRecordingControllerFactory } from '../src/common/editor/controller/capture/internal/browser/framescaper-browser-audio-recorder.ts';

function harness(sampleRate?: number) {
	const context = { sampleRate: 44_100 };
	const output: number[] = [];
	let deliver: Parameters<FramescaperWorkletRecordingControllerFactory>[0]['onChunk'] | null = null;
	let processorCreations = 0;
	class Processor {
		readonly readable = { getReader: () => { throw new Error('Unused processor reader'); } };
		constructor() { processorCreations++; throw new Error('Unknown source format cannot use AudioData'); }
	}
	const options = {
		role: 'microphone' as const,
		track: { kind: 'audio', getSettings: () => ({ channelCount: 1, ...(sampleRate === undefined ? {} : { sampleRate }) }) },
		stream: {}, context, MediaStreamTrackProcessor: Processor,
		recordingControllerFactory: (input: Parameters<FramescaperWorkletRecordingControllerFactory>[0]) => {
			assert.equal(input.context, context);
			deliver = input.onChunk;
			return { start: () => {}, pause: () => true, resume: () => true,
				stop: async () => {}, detach: async () => {} };
		},
		onChunk: (chunk: Readonly<{ frames: number }>) => { output.push(chunk.frames); },
	};
	return { options, output, processorCreations: () => processorCreations,
		deliver: async () => { await deliver?.({ frameStart: 88_200, frames: 3, channels: [new Float32Array([.1, .2, .3])] }); } };
}

test('native microphones without optional sampleRate capture on their actual worklet grid', async () => {
	const fixture = harness();
	const recorder = await createFramescaperBrowserAudioRecorder(fixture.options);
	assert.equal(recorder.backend, 'audio-worklet');
	assert.equal(recorder.sampleRate, fixture.options.context.sampleRate);
	assert.equal(recorder.channelCount, 1);
	await recorder.start();
	await fixture.deliver();
	await recorder.stop();
	await recorder.dispose();
	assert.deepEqual(fixture.output, [3]);
	assert.equal(fixture.processorCreations(), 0);
});

test('missing rate still requires a real recording grid, and invalid exposed rates remain refused', async () => {
	const fixture = harness();
	await assert.rejects(createFramescaperBrowserAudioRecorder({ ...fixture.options, context: null }), /sample rate/iu);
	const invalid = harness(0);
	await assert.rejects(createFramescaperBrowserAudioRecorder(invalid.options), /sample rate/iu);
});
