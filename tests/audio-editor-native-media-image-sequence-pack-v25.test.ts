/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	createNativeMediaImageSequenceInventoryV25,
} from '../src/common/editor/native-media-image-sequence-v25.ts';
import {
	createNativeMediaImageSequenceSourcePackV25,
	NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_FRAME_BYTES,
	NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_HEADER_BYTES,
	NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_INDEX_BYTES,
	validateNativeMediaImageSequenceSourcePackV25,
} from '../src/common/editor/native-media-image-sequence-pack-v25.ts';
import { resolveNativeMediaImageSequence } from '../src/common/editor/native-media-image-sequence.ts';

const ENCODER = new TextEncoder();
const RATE = Object.freeze({ num: 24_000, den: 1_001 });

test('source-pack v1 is deterministic, inventory/rate bound, and frame-stream readable', async () => {
	const frames = [ENCODER.encode('png-frame-one'), ENCODER.encode('png-frame-two')];
	const inventory = fixtureInventory(frames);
	const chunks: Uint8Array[] = [];
	const reference = await createNativeMediaImageSequenceSourcePackV25({
		inventory: inventory.reference,
		entries: inventory.entries,
		frameRate: RATE,
		frameChunks: (index) => split(frames[index]!, 3),
		write: (chunk) => { chunks.push(chunk.slice()); },
	});
	const pack = concatenate(chunks);
	assert.equal(new TextDecoder().decode(pack.subarray(0, 8)), 'FSISPK01');
	assert.equal(reference.byteLength, pack.byteLength);
	assert.equal(reference.sha256, bytesToHex(sha256(pack)));
	assert.equal(
		pack.byteLength,
		NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_HEADER_BYTES
			+ NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_INDEX_BYTES * frames.length
			+ frames.reduce((total, frame) => total + frame.byteLength, 0),
	);

	const reads: number[] = [];
	const reader = await validateNativeMediaImageSequenceSourcePackV25({
		reference,
		inventory: inventory.reference,
		entries: inventory.entries,
		frameRate: RATE,
		read: (offset, length) => {
			reads.push(length);
			return pack.slice(offset, offset + length);
		},
	});
	for (let index = 0; index < frames.length; index += 1) {
		const decoded: Uint8Array[] = [];
		await reader.readFrame(index, (chunk) => { decoded.push(chunk.slice()); });
		assert.deepEqual(concatenate(decoded), frames[index]);
	}
	assert.equal(Math.max(...reads) <= 16 * 1024 * 1024, true);
});

test('pack creation authenticates every frame and emits no reference after tamper', async () => {
	const frames = [ENCODER.encode('one'), ENCODER.encode('two')];
	const inventory = fixtureInventory(frames);
	let writes = 0;
	await assert.rejects(createNativeMediaImageSequenceSourcePackV25({
		inventory: inventory.reference,
		entries: inventory.entries,
		frameRate: RATE,
		frameChunks: (index) => [index === 1 ? ENCODER.encode('tampered') : frames[index]!],
		write: () => { writes += 1; },
	}), /frame.*digest|length/iu);
	assert.ok(writes > 0, 'a streaming publisher must discard its uncommitted temporary asset on rejection');
});

test('reader refuses pack, inventory, rate, and index substitution before frame publication', async () => {
	const frames = [ENCODER.encode('first'), ENCODER.encode('second')];
	const inventory = fixtureInventory(frames);
	const chunks: Uint8Array[] = [];
	const reference = await createNativeMediaImageSequenceSourcePackV25({
		inventory: inventory.reference, entries: inventory.entries, frameRate: RATE,
		frameChunks: (index) => [frames[index]!], write: (chunk) => { chunks.push(chunk.slice()); },
	});
	const pack = concatenate(chunks);
	for (const mutate of [
		(bytes: Uint8Array) => { bytes[0] ^= 0xff; },
		(bytes: Uint8Array) => { bytes[NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_HEADER_BYTES + 24] ^= 0xff; },
	]) {
		const changed = pack.slice();
		mutate(changed);
		await assert.rejects(validateNativeMediaImageSequenceSourcePackV25({
			reference, inventory: inventory.reference, entries: inventory.entries, frameRate: RATE,
			read: (offset, length) => changed.slice(offset, offset + length),
		}), /digest|magic|index|frame/iu);
	}
	await assert.rejects(validateNativeMediaImageSequenceSourcePackV25({
		reference, inventory: inventory.reference, entries: inventory.entries,
		frameRate: { num: 25, den: 1 },
		read: (offset, length) => pack.slice(offset, offset + length),
	}), /rate/iu);
	await assert.rejects(validateNativeMediaImageSequenceSourcePackV25({
		reference, inventory: inventory.reference, entries: inventory.entries,
		frameRate: { num: 48, den: 2 },
		read: (offset, length) => pack.slice(offset, offset + length),
	}), /reduced.*rational/iu);
});

test('creator rejects unbounded frame and pack arithmetic before requesting bytes', async () => {
	const frames = [ENCODER.encode('x')];
	const inventory = fixtureInventory(frames);
	let opened = false;
	await assert.rejects(createNativeMediaImageSequenceSourcePackV25({
		inventory: inventory.reference,
		entries: [{
			...inventory.entries[0]!, byteLength: NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_FRAME_BYTES + 1,
		}],
		frameRate: RATE,
		frameChunks: () => { opened = true; return frames; },
		write: () => undefined,
	}), /frame.*ceiling/iu);
	assert.equal(opened, false);
});

function fixtureInventory(frames: readonly Uint8Array[]) {
	const fileNames = frames.map((_, index) => `frame_${String(index + 1).padStart(4, '0')}.png`);
	const selection = resolveNativeMediaImageSequence({ fileNames, frameRate: RATE });
	const publication = createNativeMediaImageSequenceInventoryV25(selection, frames.map((frame, index) => ({
		fileName: fileNames[index]!, frameNumber: index + 1,
		byteLength: frame.byteLength, sha256: bytesToHex(sha256(frame)),
	})));
	return {
		reference: publication.reference,
		entries: JSON.parse(new TextDecoder().decode(publication.bytes)).entries as readonly Readonly<{
			fileName: string; frameNumber: number; byteLength: number; sha256: string;
		}>[],
	};
}

function* split(bytes: Uint8Array, size: number): Iterable<Uint8Array> {
	for (let offset = 0; offset < bytes.byteLength; offset += size) {
		yield bytes.subarray(offset, Math.min(bytes.byteLength, offset + size));
	}
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
	const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
	return output;
}
