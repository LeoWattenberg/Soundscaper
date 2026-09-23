/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareFreesoundUploadFile } from '../src/common/editor/ui/workspace/freesound-upload-file-preparation.ts';

test('browser-decodable uploads are encoded as 24-bit PCM WAV before admission', async () => {
	const channel = Float32Array.of(0, 0.25, -0.25);
	let closed = false;
	let encoderOptions: Readonly<Record<string, unknown>> | undefined;
	const output = await prepareFreesoundUploadFile(
		new File(['compressed'], 'field take.wave', { type: 'audio/x-pn-wav', lastModified: 42 }),
		undefined,
		{
			createDecodeContext: () => ({
				decodeAudioData: async () => ({
					length: channel.length,
					numberOfChannels: 1,
					sampleRate: 48_000,
					getChannelData: () => channel,
				}) as unknown as AudioBuffer,
				close: async () => { closed = true; },
			}),
			encode: (_channels, options) => {
				encoderOptions = options;
				return Uint8Array.of(82, 73, 70, 70);
			},
		},
	);

	assert.equal(closed, true);
	assert.equal(output.name, 'field take.wav');
	assert.equal(output.type, 'audio/wav');
	assert.equal(output.lastModified, 42);
	assert.equal(encoderOptions?.bitDepth, 24);
	assert.equal(encoderOptions?.float, false);
	assert.equal(encoderOptions?.dither, 'triangular');
	assert.equal(encoderOptions?.sampleRate, 48_000);
});

test('preflight rejects a decoded WAV that would exceed the upload limit', async () => {
	await assert.rejects(prepareFreesoundUploadFile(
		new File(['compressed'], 'long.webm', { type: 'audio/webm' }),
		undefined,
		{
			maximumBytes: 10,
			createDecodeContext: () => ({
				decodeAudioData: async () => ({
					length: 10,
					numberOfChannels: 2,
					sampleRate: 48_000,
					getChannelData: () => new Float32Array(10),
				}) as unknown as AudioBuffer,
				close: async () => undefined,
			}),
		},
	), /100 MB/u);
});

test('oversized compressed input is rejected before buffering or decoder creation', async () => {
	let buffered = false;
	let decoderCreated = false;
	const file = {
		name: 'unbounded.webm',
		size: 100_000_001,
		arrayBuffer: async () => { buffered = true; return new ArrayBuffer(0); },
	} as unknown as File;
	await assert.rejects(prepareFreesoundUploadFile(file, undefined, {
		createDecodeContext: () => {
			decoderCreated = true;
			throw new Error('decoder must not be created');
		},
	}), /100 MB/u);
	assert.equal(buffered, false);
	assert.equal(decoderCreated, false);
});
