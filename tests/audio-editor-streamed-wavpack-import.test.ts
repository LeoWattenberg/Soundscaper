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

test('a damaged or non-contiguous later WavPack group closes the stream after its valid prefix', async () => {
	const { encoded } = await original(160_000);
	const groups = splitGroups(encoded);
	assert.ok(groups.length >= 3, 'the fixture must contain a later group beyond the first continuation');
	const corruptChecksum = groups[1]!.slice();
	corruptChecksum[12] ^= 1;
	for (const [name, bytes, refusal] of [
		['truncated', concat(groups[0]!, groups[1]!.subarray(0, 10)), /truncated/u],
		['non-contiguous', concat(groups[0]!, groups[2]!), /non-contiguous/u],
		['checksum', concat(groups[0]!, corruptChecksum), /checksum/u],
	] as const) {
		let chunks = 0;
		const prepared = await prepareStreamedAudioImport(new File([bytes], `${name}.wv`), {
			desktopCodec: geometryDecoder(),
		});
		await assert.rejects(prepared.stream({ chunkFrames: 4_096, onChunk() { chunks += 1; } }), refusal);
		assert.ok(chunks > 0, `${name} must fail after the first group supplied PCM`);
		await assert.rejects(prepared.stream({ chunkFrames: 4_096, onChunk() {} }), /decoder is closed/u);
	}
});

test('a later WavPack decoder geometry mismatch refuses the stream and closes its session', async () => {
	const { file } = await original();
	let decodedGroups = 0;
	const prepared = await prepareStreamedAudioImport(file, { desktopCodec: {
		async decode(group) {
			decodedGroups += 1;
			const result = await geometryDecoder().decode(group, {});
			return decodedGroups === 2
				? { ...result, channels: result.channels.slice(0, 1) }
				: result;
		},
	} });
	await assert.rejects(prepared.stream({ chunkFrames: 4_096, onChunk() {} }), /inconsistent source geometry/u);
	assert.equal(decodedGroups, 2);
	await assert.rejects(prepared.stream({ chunkFrames: 4_096, onChunk() {} }), /decoder is closed/u);
});

test('cancelling a pending later WavPack group decode stops the stream before another chunk', async () => {
	const { file } = await original();
	const controller = new AbortController();
	let decodedGroups = 0;
	let secondDecodeStarted!: () => void;
	let resumeSecondDecode!: (value: Awaited<ReturnType<ReturnType<typeof geometryDecoder>['decode']>>) => void;
	const entered = new Promise<void>((resolve) => { secondDecodeStarted = resolve; });
	const blocked = new Promise<Awaited<ReturnType<ReturnType<typeof geometryDecoder>['decode']>>>((resolve) => {
		resumeSecondDecode = resolve;
	});
	const prepared = await prepareStreamedAudioImport(file, { signal: controller.signal, desktopCodec: {
		async decode(group) {
			decodedGroups += 1;
			if (decodedGroups === 2) {
				secondDecodeStarted();
				return blocked;
			}
			return geometryDecoder().decode(group, {});
		},
	} });
	let chunks = 0;
	const streaming = prepared.stream({ chunkFrames: 4_096, onChunk() { chunks += 1; } });
	await entered;
	const beforeAbort = chunks;
	controller.abort();
	await assert.rejects(streaming, (error: Error) => error.name === 'AbortError');
	resumeSecondDecode({ channels: [new Float32Array(1), new Float32Array(1)], sampleRate: 48_000 });
	await assert.rejects(prepared.stream({ chunkFrames: 4_096, onChunk() {} }), /decoder is closed/u);
	assert.equal(chunks, beforeAbort);
});

function geometryDecoder() {
	return {
		async decode(group: Blob, _options: Readonly<Record<string, unknown>>) {
			const bytes = new Uint8Array(await group.arrayBuffer());
			const frames = new DataView(bytes.buffer).getUint32(20, true);
			return { channels: [new Float32Array(frames), new Float32Array(frames)], sampleRate: 48_000 };
		},
	};
}

function splitGroups(bytes: Uint8Array): Uint8Array[] {
	const groups: Uint8Array[] = [];
	let offset = 0;
	let groupStart = 0;
	while (offset < bytes.byteLength) {
		assert.ok(offset + 32 <= bytes.byteLength);
		const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
		const blockLength = view.getUint32(4, true) + 8;
		assert.ok(blockLength >= 32 && offset + blockLength <= bytes.byteLength);
		offset += blockLength;
		if (view.getUint32(24, true) & 0x1000) {
			groups.push(bytes.slice(groupStart, offset));
			groupStart = offset;
		}
	}
	assert.equal(groupStart, bytes.byteLength);
	return groups;
}

function concat(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
	const joined = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) { joined.set(part, offset); offset += part.byteLength; }
	return joined;
}
