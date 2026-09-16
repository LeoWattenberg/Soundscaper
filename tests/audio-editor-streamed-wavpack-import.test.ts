/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { encodeDedicatedAudioPcm, decodeDedicatedAudioFile } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';

const loadPayload = async (_format: unknown, url: URL) => new Uint8Array(await readFile(url));

async function original(frames = 96_000) {
	const pcm = new Float32Array(frames * 2);
	for (let frame = 0; frame < frames; frame++) { pcm[frame * 2] = Math.sin(frame * 0.1) * 0.2; pcm[frame * 2 + 1] = Math.cos(frame * 0.03) * 0.1; }
	const encoded = await encodeDedicatedAudioPcm({ format: 'wavpack', input: new Uint8Array(pcm.buffer),
		frameCount: frames, channelCount: 2, sampleRate: 48_000, settings: { compressionLevel: 2 }, maximumOutputBytes: 2 * 1024 * 1024,
	}, { loadPayload });
	class RangedOriginal extends File {
		override arrayBuffer(): Promise<ArrayBuffer> { throw new Error('whole-file read forbidden'); }
	}
	return { pcm, encoded, file: new RangedOriginal([encoded], 'recording.wv', { type: 'audio/wavpack' }) };
}

test('bounded WavPack groups preserve exact lossless PCM across source chunk boundaries', async () => {
	const { file, pcm } = await original();
	const requests: number[] = [];
	const prepared = await prepareStreamedAudioImport(file, { desktopCodec: {
		async decode(group) {
			requests.push(group.size);
			assert.ok(group.size < 4 * 1024 * 1024);
			const decoded = await decodeDedicatedAudioFile({ format: 'wavpack', input: new Uint8Array(await group.arrayBuffer()), maximumOutputBytes: 2 * 1024 * 1024 }, { loadPayload });
			const data = new DataView(decoded.interleaved.buffer);
			const channels = Array.from({ length: decoded.channelCount }, (_, channel) => Float32Array.from({ length: decoded.frameCount }, (_value, frame) => data.getFloat32((frame * decoded.channelCount + channel) * 4, true)));
			return { channels, sampleRate: decoded.sampleRate };
		},
	} });
	assert.equal(prepared.descriptor.frameCount, pcm.length / 2);
	let position = 0;
	await prepared.stream({ chunkFrames: 16_384, onChunk(channels) {
		assert.ok(channels[0]!.length <= 16_384);
		for (let frame = 0; frame < channels[0]!.length; frame++) {
			assert.equal(channels[0]![frame], pcm[(position + frame) * 2]);
			assert.equal(channels[1]![frame], pcm[(position + frame) * 2 + 1]);
		}
		position += channels[0]!.length;
	} });
	assert.equal(position, pcm.length / 2);
	assert.ok(requests.length > 1);
});

test('the original WavPack checksum is checked before header indexes are rewritten', async () => {
	const { encoded } = await original(48_000);
	encoded[12] ^= 1;
	await assert.rejects(prepareStreamedAudioImport(new File([encoded], 'corrupt.wv')), /checksum/u);
});
