/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { openAsBlob } from 'node:fs';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDedicatedAudioEncodeSession } from '../src/common/editor/dedicated-audio-encode-session.ts';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { decodeDedicatedAudioFile } from '../src/common/editor/browser-dedicated-audio-codec.ts';

// 1.38 GB of intermediate PCM passes through bounded encoder/decoder packets.
const cases = [
	{ format: 'mp3', settings: { bitrateKbps: 192 } },
	{ format: 'mp2', settings: { bitrateKbps: 192 } },
	{ format: 'flac', settings: { compressionLevel: 5 } },
	{ format: 'wavpack', settings: { compressionLevel: 2 } },
	{ format: 'opus', settings: { bitrateKbps: 128, vbrMode: 1 } },
	{ format: 'ogg-vorbis', settings: { quality: 6 } },
] as const;
for (const { format, settings } of cases) {
	test(`one hour of stereo 48 kHz ${format} imports through bounded reads and awaited source chunks`, {
		skip: process.env.SCAPE_LONG_AUDIO_IMPORT_REFERENCE !== '1', timeout: format === 'wavpack' ? 900_000 : 300_000,
	}, async () => {
		const directory = await mkdtemp(join(tmpdir(), 'soundscaper-hour-import-'));
		const path = join(directory, format === 'wavpack' ? 'hour.wv' : `hour.${format}`);
		const file = await open(path, 'wx');
		const frames = 48_000 * 3600;
		const session = await openDedicatedAudioEncodeSession({
			format, frameCount: frames, sampleRate: 48_000, channelCount: 2,
			settings,
		}, { loadPayload: async (_format, url) => new Uint8Array(await readFile(url)) });
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async (url) => {
			assert.ok(url instanceof URL && url.protocol === 'file:');
			return new Response(await readFile(url));
		};
		try {
			const pcm = new Uint8Array(16_384 * 8);
			for (let offset = 0; offset < frames;) {
				const count = Math.min(16_384, frames - offset);
				const encoded = session.write(pcm.subarray(0, count * 8), count);
				if (encoded.length) await file.write(encoded);
				offset += count;
			}
			const final = session.finish();
			await file.write(final.bytes);
			if (final.prefixPatch.length) await file.write(final.prefixPatch, 0, final.prefixPatch.length, 0);
			await file.close();
			session.close();
			const original = await openAsBlob(path, { type: format === 'mp3' ? 'audio/mpeg' : `audio/${format}` });
			assert.ok(original.size > 0 && original.size <= 1_000_000_000);
			const slice = original.slice.bind(original);
			let maximumReadBytes = 0;
			Object.defineProperty(original, 'arrayBuffer', { value() { throw new Error('Whole-file compressed reads are forbidden.'); } });
			Object.defineProperty(original, 'slice', { value(start?: number, end?: number, type?: string) {
				const range = slice(start, end, type);
				maximumReadBytes = Math.max(maximumReadBytes, range.size);
				assert.ok(range.size <= 4 * 1024 ** 2);
				return range;
			} });
			const prepared = await prepareStreamedAudioImport(original, format === 'wavpack' ? {
				// Node has no browser Worker; this port runs that worker's same reviewed decode entry.
				desktopCodec: { async decode(group) {
					assert.ok(group.size <= 4 * 1024 ** 2);
					const decoded = await decodeDedicatedAudioFile({ format: 'wavpack',
						input: new Uint8Array(await group.arrayBuffer()), maximumOutputBytes: 2 * 1024 ** 2,
					}, { loadPayload: async (_format, url) => new Uint8Array(await readFile(url)) });
					assert.ok(decoded.interleaved.byteLength <= 65_536 * 8);
					const data = new DataView(decoded.interleaved.buffer);
					const channels = Array.from({ length: decoded.channelCount }, (_, channel) => Float32Array.from({ length: decoded.frameCount }, (_value, frame) => data.getFloat32((frame * decoded.channelCount + channel) * 4, true)));
					return { channels, sampleRate: decoded.sampleRate };
				} },
			} : {});
			assert.equal(prepared.descriptor.frameCount, frames);
			assert.equal(prepared.descriptor.sampleRate, 48_000);
			assert.equal(prepared.descriptor.channelCount, 2);
			let writtenFrames = 0;
			let maximumRetainedPcmBytes = 0;
			let writing = false;
			await prepared.stream({ chunkFrames: 16_384, async onChunk(channels) {
				assert.equal(writing, false);
				writing = true;
				try {
					assert.equal(channels.length, 2);
					maximumRetainedPcmBytes = Math.max(maximumRetainedPcmBytes, channels.reduce((sum, channel) => sum + channel.byteLength, 0));
					writtenFrames += channels[0]!.length;
					assert.ok(channels.every((channel) => channel.length === channels[0]!.length));
					await Promise.resolve();
				} finally { writing = false; }
			} });
			assert.equal(writtenFrames, frames);
			assert.ok(maximumRetainedPcmBytes <= 16_384 * 8);
			assert.ok(maximumReadBytes > 0 && maximumReadBytes <= 4 * 1024 ** 2);
		} finally {
			globalThis.fetch = originalFetch;
			session.close();
			await file.close().catch(() => undefined);
			await rm(directory, { recursive: true, force: true });
		}
	});
}
