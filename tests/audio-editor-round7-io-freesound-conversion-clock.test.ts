/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeWav } from '../src/common/editor/wav.js';
import { inspectEncodedAudioSampleRate, inspectDecodedAudioSampleRate } from '../src/common/editor/audio-file-metadata.js';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../src/common/editor/wav-import.js';
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

test('a valid production BWF keeps its PCM when the native decoder resolves zero frames', async () => {
	const frames = 11_025;
	const samples = Float32Array.from({ length: frames }, (_, frame) => .2 * Math.sin(2 * Math.PI * 3_000 * frame / 44_100));
	const input = productionRecording(samples, 24);
	assert.equal((await inspectWavBlobPcm(input)).frameCount, frames);
	let closes = 0;
	const output = await prepareFreesoundUploadFile(input, undefined, {
		createDecodeContext: options => {
			assert.equal(options.sampleRate, 44_100);
			return { decodeAudioData: async () => decodedBuffer(0, 44_100), close: async () => { closes += 1; } };
		},
	});
	const descriptor = await inspectWavBlobPcm(output);
	assert.equal(output.name, 'field-recording.wav');
	assert.equal(descriptor.sampleRate, 44_100);
	assert.equal(descriptor.frameCount, frames);
	assert.equal(closes, 1);
	let decodedFrames = 0;
	let maximumError = 0;
	await streamWavBlobPcm(output, { onChunk: (channels: readonly Float32Array[], info: { frameOffset: number }) => {
		const channel = channels[0];
		for (let frame = 0; frame < channel.length; frame += 1) {
			maximumError = Math.max(maximumError, Math.abs(channel[frame] - samples[info.frameOffset + frame]));
		}
		decodedFrames += channel.length;
	} });
	assert.equal(decodedFrames, frames);
	assert.ok(maximumError < 1e-6, `Production PCM error ${maximumError}`);
});

test('a zero-frame native decode cannot publish an empty WAV for a non-PCM source', async () => {
	const input = new File([Uint8Array.from(aacLcM4a44_100Fixture()).buffer], 'field-recording.m4a', { type: 'audio/mp4' });
	let closes = 0;
	await assert.rejects(prepareFreesoundUploadFile(input, undefined, {
		createDecodeContext: () => ({ decodeAudioData: async () => decodedBuffer(0, 44_100), close: async () => { closes += 1; } }),
	}), /could not be decoded into PCM frames/u);
	assert.equal(closes, 1);
});

test('PCM recovery respects the converted byte ceiling before encoding', async () => {
	const input = productionRecording(new Float32Array(11_025), 16);
	assert.ok(input.size < 30_000);
	let encodes = 0;
	await assert.rejects(prepareFreesoundUploadFile(input, undefined, {
		maximumBytes: 30_000,
		createDecodeContext: () => ({ decodeAudioData: async () => decodedBuffer(0, 44_100), close: async () => undefined }),
		encode: () => { encodes += 1; return Uint8Array.of(1); },
	}), /100 MB/u);
	assert.equal(encodes, 0);
});

test('cancellation after native decoder closure prevents PCM recovery and encoding', async () => {
	const controller = new AbortController();
	const reason = new Error('The user cancelled the upload.');
	let encodes = 0;
	await assert.rejects(prepareFreesoundUploadFile(productionRecording(new Float32Array(11_025), 24), controller.signal, {
		createDecodeContext: () => ({ decodeAudioData: async () => decodedBuffer(0, 44_100), close: async () => { controller.abort(reason); } }),
		encode: () => { encodes += 1; return Uint8Array.of(1); },
	}), error => error === reason);
	assert.equal(encodes, 0);
});

function productionRecording(samples: Float32Array, bitDepth: 16 | 24): File {
	return new File([Uint8Array.from(encodeWav([samples], {
		sampleRate: 44_100, bitDepth, dither: 'none',
		bext: { description: 'Production recording', timeReference: '0' },
	})).buffer], 'field-recording.bwf', { type: 'audio/wav' });
}

function decodedBuffer(length: number, sampleRate: number): AudioBuffer {
	return { length, sampleRate, numberOfChannels: 1, getChannelData: () => new Float32Array(length) } as unknown as AudioBuffer;
}
