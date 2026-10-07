/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { libsndfileRiffSamples, libsndfileRifxSamples } from './helpers/libsndfile-rifx-fixture.ts';
import { inspectWavContainerSignature } from '../src/common/editor/controller/import/internal/wav-import-routing.ts';

test('normal RIFX and RIFF files retain distinct import routing signatures', async () => {
	assert.equal(await inspectWavContainerSignature(new File([libsndfileRifxSamples('s16')], 'big-endian.wav'), () => true), 'RIFX');
	assert.equal(await inspectWavContainerSignature(new File([libsndfileRiffSamples()], 'little-endian.wav'), () => true), 'RIFF');
});

for (const format of ['s16', 's24', 'f32', 'f64'] as const) {
	test(`normal libsndfile RIFX ${format} reads actual big-endian samples through the production session`, async () => {
		const bytes = libsndfileRifxSamples(format);
		const original = bytes.slice();
		const prepared = await prepareStreamedAudioImport(new Blob([bytes], { type: 'audio/wav' }));
		try {
			assert.deepEqual([prepared.descriptor.sampleRate, prepared.descriptor.channelCount, prepared.descriptor.frameCount], [48_000, 1, 4]);
			const output: number[] = [];
			await prepared.stream({ chunkFrames: 2, onChunk(channels) {
				assert.equal(channels.length, 1);
				assert.ok(channels[0]!.length <= 2);
				output.push(...channels[0]!);
			} });
			assert.equal(output.length, 4);
			for (const [index, value] of [0.25, -0.5, 0.75, -1].entries()) {
				assert.ok(Math.abs(output[index]! - value) <= 1 / 32_768,
					`${format} sample ${String(index)}: expected ${String(value)}, received ${String(output[index])}`);
			}
			assert.deepEqual(bytes, original);
		} finally { prepared.dispose(); }
	});
}

test('normal libsndfile little-endian WAV retains its original PCM decoding', async () => {
	const bytes = libsndfileRiffSamples();
	const original = bytes.slice();
	const prepared = await prepareStreamedAudioImport(new Blob([bytes], { type: 'audio/wav' }));
	try {
		const output: number[] = [];
		await prepared.stream({ chunkFrames: 2, onChunk: (channels) => { output.push(...channels[0]!); } });
		assert.deepEqual(output, [0.25, -0.5, 0.75, -1]);
		assert.deepEqual(bytes, original);
	} finally { prepared.dispose(); }
});
