/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeWav } from '../src/common/editor/wav.js';
import { inspectEncodedAudioSampleRate, inspectDecodedAudioSampleRate } from '../src/common/editor/audio-file-metadata.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { prepareFreesoundUploadFile } from '../src/common/editor/ui/workspace/freesound-upload-file-preparation.ts';
import { aacLcM4a44_100Fixture } from './helpers/os-audio-codec-fixtures.ts';

for (const sampleRate of [44_100, 96_000]) test(`ordinary ${sampleRate} Hz BWF conversion preserves the input PCM grid`, async () => {
	const frames = sampleRate / 4;
	const input = new File([Uint8Array.from(encodeWav([new Float32Array(frames)], {
		sampleRate, bitDepth: 24, bext: { description: 'Production recording', timeReference: '0' },
	})).buffer], 'field-recording.bwf', { type: 'audio/wav' });
	let requested: AudioContextOptions | undefined;
	let closes = 0;
	const output = await prepareFreesoundUploadFile(input, undefined, {
		createDecodeContext: (options?: AudioContextOptions) => {
			requested = options;
			const nativeRate = options?.sampleRate ?? 44_100;
			return {
				decodeAudioData: async bytes => {
					assert.equal(inspectEncodedAudioSampleRate(bytes), sampleRate);
					return decodedBuffer(Math.floor(nativeRate / 4), nativeRate);
				},
				close: async () => { closes += 1; },
			};
		},
	});
	const descriptor = await inspectWavBlobPcm(output);
	assert.equal(descriptor.sampleRate, sampleRate);
	assert.equal(descriptor.frameCount, frames);
	assert.equal(closes, 1);
	if (sampleRate !== 44_100) assert.equal(requested?.sampleRate, sampleRate);
});

test('a container rate that may describe an AAC core never pins the reconstructed decode clock', async () => {
	const bytes = Uint8Array.from(aacLcM4a44_100Fixture());
	assert.equal(inspectEncodedAudioSampleRate(bytes), 44_100);
	assert.equal(inspectDecodedAudioSampleRate(bytes), null);
	let requested: AudioContextOptions | undefined;
	const output = await prepareFreesoundUploadFile(new File([bytes.buffer], 'recording.m4a', { type: 'audio/mp4' }), undefined, {
		createDecodeContext: (options?: AudioContextOptions) => {
			requested = options;
			return { decodeAudioData: async () => decodedBuffer(1_024, 48_000), close: async () => undefined };
		},
	});
	assert.equal(requested?.sampleRate, undefined);
	assert.equal((await inspectWavBlobPcm(output)).sampleRate, 48_000);
});

function decodedBuffer(length: number, sampleRate: number): AudioBuffer {
	return { length, sampleRate, numberOfChannels: 1, getChannelData: () => new Float32Array(length) } as unknown as AudioBuffer;
}
