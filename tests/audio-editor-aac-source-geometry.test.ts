/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { aacSourceMetadata, readAacSourceMetadata, validateAacSourceGeometry } from '../src/common/editor/aac-source-geometry.ts';

function box(type: string, ...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
	const size = 8 + parts.reduce((sum, part) => sum + part.length, 0);
	const bytes = new Uint8Array(size);
	new DataView(bytes.buffer).setUint32(0, size);
	bytes.set(new TextEncoder().encode(type), 4);
	let offset = 8;
	for (const part of parts) { bytes.set(part, offset); offset += part.length; }
	return bytes;
}
function metadataFile(value: string): Blob {
	const data = Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 0);
	return new Blob([box('ftyp'), box('moov', box('udta', box('meta', new Uint8Array(4),
		box('ilst', box('scaf', box('data', data, new TextEncoder().encode(value)))))))]);
}

test('AAC source geometry binds exact source length to bounded priming and padding', () => {
	const metadata = aacSourceMetadata(48_000, 2, 172_800_000);
	assert.equal(metadata, 'SoundscaperAAC1:48000:2:172800000');
	assert.deepEqual(validateAacSourceGeometry(metadata, { sampleRate: 48_000, channelCount: 2, encodedFrames: 172_801_024 }),
		{ sourceFrames: 172_800_000, leadingFrames: 1024, trailingFrames: 0 });
	assert.deepEqual(validateAacSourceGeometry(aacSourceMetadata(48_000, 2, 1025),
		{ sampleRate: 48_000, channelCount: 2, encodedFrames: 2048 }),
		{ sourceFrames: 1025, leadingFrames: 0, trailingFrames: 1023 });
	for (const [value, actual] of [
		['SoundscaperAAC1:44100:2:172800000', { sampleRate: 48_000, channelCount: 2, encodedFrames: 172_801_024 }],
		['SoundscaperAAC1:48000:1:172800000', { sampleRate: 48_000, channelCount: 2, encodedFrames: 172_801_024 }],
		[metadata, { sampleRate: 48_000, channelCount: 2, encodedFrames: 172_802_048 }],
		[metadata, { sampleRate: 48_000, channelCount: 2, encodedFrames: 172_800_001 }],
		['SoundscaperAAC1:48000:2:0001024', { sampleRate: 48_000, channelCount: 2, encodedFrames: 1024 }],
		['SoundscaperAAC1:48000:2:9007199254740992', { sampleRate: 48_000, channelCount: 2, encodedFrames: 1024 }],
		['x'.repeat(129), { sampleRate: 48_000, channelCount: 2, encodedFrames: 1024 }],
	] as const) assert.throws(() => validateAacSourceGeometry(value, actual), /AAC source geometry/u);
});

test('MP4 source metadata uses bounded structural and tag reads without materializing metadata containers', async () => {
	const value = aacSourceMetadata(48_000, 2, 172_800_000);
	const source = metadataFile(value);
	const reads: number[] = [];
	class BoundedBlob extends Blob {
		override arrayBuffer(): Promise<ArrayBuffer> { throw new Error('Whole file read forbidden'); }
		override slice(start?: number, end?: number, type?: string): Blob {
			const length = (end ?? this.size) - (start ?? 0);
			reads.push(length);
			assert.ok(length <= 128);
			return super.slice(start, end, type);
		}
	}
	assert.equal(await readAacSourceMetadata(new BoundedBlob([source])), value);
	assert.ok(reads.length > 1);
	assert.equal(await readAacSourceMetadata(new Blob(['not an MP4 file'])), null);
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(readAacSourceMetadata(source, controller.signal), { name: 'AbortError' });
});

test('MP4 source metadata rejects oversized tags, duplicates, and truncated box geometry', async () => {
	await assert.rejects(readAacSourceMetadata(metadataFile('x'.repeat(129))), /AAC source metadata/u);
	const value = new TextEncoder().encode(aacSourceMetadata(48_000, 2, 1024));
	const item = box('scaf', box('data', Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 0), value));
	const duplicate = new Blob([box('ftyp'), box('moov', box('udta', box('meta', new Uint8Array(4), box('ilst', item, item))))]);
	await assert.rejects(readAacSourceMetadata(duplicate), /AAC source metadata/u);
	const truncated = box('moov');
	new DataView(truncated.buffer).setUint32(0, 1000);
	await assert.rejects(readAacSourceMetadata(new Blob([box('ftyp'), truncated])), /AAC source metadata/u);
	const prefix = new Uint8Array(32);
	const view = new DataView(prefix.buffer);
	for (const [offset, type, size] of [[0, 'ftyp', 8], [8, 'moov', 1_000_000_000 - 8],
		[16, 'udta', 1_000_000_000 - 16], [24, 'free', 1_000_000_000 - 24]] as const) {
		view.setUint32(offset, size); prefix.set(new TextEncoder().encode(type), offset + 4);
	}
	class HugeMetadataBlob extends Blob {
		override get size(): number { return 1_000_000_000; }
		override arrayBuffer(): Promise<ArrayBuffer> { throw new Error('Huge metadata allocation forbidden'); }
		override slice(start?: number, end?: number, type?: string): Blob {
			assert.ok((end ?? this.size) - (start ?? 0) <= 128);
			return super.slice(start, end, type);
		}
	}
	await assert.rejects(readAacSourceMetadata(new HugeMetadataBlob([prefix])), /AAC source metadata/u);
});
