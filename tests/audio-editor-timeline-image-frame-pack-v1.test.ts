/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	createFramescaperImageFramePackV1,
	FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES,
	FRAMESCAPER_IMAGE_FRAME_PACK_INDEX_BYTES,
	openFramescaperImageFramePackV1,
} from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import {
	FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
	type FramescaperImageSourceV1,
} from '../src/common/editor/timeline-image-model.ts';

const ENCODER = new TextEncoder();

test('frame-pack v1 is deterministic and exposes authenticated original, receipt, timing, and RGBA frames', async () => {
	const input = packFixture();
	const first = createFramescaperImageFramePackV1(input);
	const second = createFramescaperImageFramePackV1(packFixture());
	assert.deepEqual(first.bytes, second.bytes);
	assert.equal(new TextDecoder().decode(first.bytes.subarray(0, 8)), 'FSCIAB01');
	assert.equal(first.contentSha256, bytesToHex(sha256(first.bytes)));
	assert.equal(first.assetByteLength, first.bytes.byteLength);
	assert.equal(first.originalSha256, bytesToHex(sha256(input.original)));
	assert.equal(first.frameCount, 2);
	assert.equal(first.durationTicks, '50000');
	assert.equal(first.hasAlpha, true);

	const source = sourceFrom(first);
	const reads: Readonly<{ offset: number; length: number }>[] = [];
	const reader = await openFramescaperImageFramePackV1({
		source,
		read: (offset, length) => {
			reads.push({ offset, length });
			return first.bytes.slice(offset, offset + length);
		},
	});
	assert.deepEqual(await reader.readOriginal(), input.original);
	assert.deepEqual(reader.receipt, {
		decoder: { id: 'browser-native', version: '1' }, schemaVersion: 1,
	});
	assert.deepEqual(reader.timings, [
		{ presentationTicks: 0n, durationTicks: 33_334n },
		{ presentationTicks: 33_334n, durationTicks: 16_666n },
	]);
	assert.deepEqual(await reader.readFrame(0), input.frames[0]!.rgba);
	assert.deepEqual(await reader.readFrame(1), input.frames[1]!.rgba);
	assert.ok(reads.every(({ length }) => length <= 16 * 1024 * 1024));
	assert.equal(
		first.bytes.byteLength > FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES
			+ 2 * FRAMESCAPER_IMAGE_FRAME_PACK_INDEX_BYTES,
		true,
	);
});

test('writer canonicalizes receipt JSON and rejects noncanonical pixels or timing', () => {
	const left = createFramescaperImageFramePackV1({
		...packFixture(), receipt: { schemaVersion: 1, z: 'last', a: 'first' },
	});
	const right = createFramescaperImageFramePackV1({
		...packFixture(), receipt: { a: 'first', z: 'last', schemaVersion: 1 },
	});
	assert.deepEqual(left.bytes, right.bytes);
	assert.throws(() => createFramescaperImageFramePackV1({
		...packFixture(), frames: [{
			presentationTicks: 0n, durationTicks: 50_000n,
			rgba: Uint8Array.of(1, 2, 3, 0, 4, 5, 6, 255),
		}], width: 2, height: 1,
	}), /transparent.*RGB/iu);
	assert.throws(() => createFramescaperImageFramePackV1({
		...packFixture(), frames: [
			packFixture().frames[0]!,
			{
				...packFixture().frames[1]!,
				rgba: Uint8Array.of(1, 2, 3, 0, 4, 5, 6, 255),
			},
		],
	}), /transparent.*RGB/iu);
	assert.throws(() => createFramescaperImageFramePackV1({
		...packFixture(), frames: [
			packFixture().frames[0]!,
			{ ...packFixture().frames[1]!, presentationTicks: 34_000n },
		],
	}), /continuous/iu);
	assert.throws(() => createFramescaperImageFramePackV1({
		...packFixture(), receipt: { schemaVersion: 1, unsafe: Number.NaN },
	}), /receipt/iu);
});

test('reader fails closed on body, section, index, and compressed-frame substitution', async () => {
	const publication = createFramescaperImageFramePackV1(packFixture());
	const source = sourceFrom(publication);
	const bodyTamper = publication.bytes.slice();
	bodyTamper[0] ^= 0xff;
	await assert.rejects(open(bodyTamper, source), /digest/iu);

	const headerTamper = publication.bytes.slice();
	new DataView(headerTamper.buffer).setUint32(20, 1, true);
	await assert.rejects(open(headerTamper, reboundSource(source, headerTamper)), /header|reserved/iu);

	const indexTamper = publication.bytes.slice();
	const tamperedIndexOffset = Number(new DataView(indexTamper.buffer).getBigUint64(64, true));
	const secondIndex = tamperedIndexOffset + FRAMESCAPER_IMAGE_FRAME_PACK_INDEX_BYTES;
	new DataView(indexTamper.buffer).setBigUint64(secondIndex, 34_000n, true);
	await assert.rejects(open(indexTamper, reboundSource(source, indexTamper)), /index|continuous|section/iu);

	const frameTamper = publication.bytes.slice();
	const view = new DataView(frameTamper.buffer);
	const indexOffset = Number(view.getBigUint64(64, true));
	const frameOffset = Number(view.getBigUint64(indexOffset + 16, true));
	frameTamper[frameOffset] ^= 0xff;
	const reader = await open(frameTamper, reboundSource(source, frameTamper));
	await assert.rejects(reader.readFrame(0), /compressed.*digest|zlib/iu);
});

test('reader refuses short ranges and source summaries that disagree with the authenticated body', async () => {
	const publication = createFramescaperImageFramePackV1(packFixture());
	const source = sourceFrom(publication);
	await assert.rejects(openFramescaperImageFramePackV1({
		source,
		read: (offset, length) => publication.bytes.slice(offset, offset + Math.max(0, length - 1)),
	}), /range.*short|exact/iu);
	await assert.rejects(open(publication.bytes, {
		...source, canonical: { ...source.canonical, width: source.canonical.width + 1 },
	}), /summary|width/iu);
});

function packFixture() {
	return {
		original: ENCODER.encode('exact original file bytes'),
		receipt: { schemaVersion: 1, decoder: { version: '1', id: 'browser-native' } },
		width: 2,
		height: 1,
		timingMode: 'embedded' as const,
		frames: [
			{
				presentationTicks: 0n, durationTicks: 33_334n,
				rgba: Uint8Array.of(255, 0, 0, 255, 0, 0, 0, 0),
			},
			{
				presentationTicks: 33_334n, durationTicks: 16_666n,
				rgba: Uint8Array.of(0, 255, 0, 128, 0, 0, 255, 255),
			},
		],
	};
}

function sourceFrom(publication: ReturnType<typeof createFramescaperImageFramePackV1>): FramescaperImageSourceV1 {
	return {
		schemaVersion: 1,
		kind: 'image',
		id: 'image-source-1',
		name: 'fixture',
		mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
		storageKey: 'image-source-1',
		contentSha256: publication.contentSha256,
		assetByteLength: publication.assetByteLength,
		original: {
			fileName: 'fixture.png', mimeType: 'image/png', recognizedFormat: 'png',
			byteLength: publication.originalByteLength, sha256: publication.originalSha256,
		},
		canonical: {
			width: publication.width, height: publication.height,
			hasAlpha: publication.hasAlpha, frameCount: publication.frameCount,
			durationTicks: publication.durationTicks, timingMode: publication.timingMode,
		},
		conversionReceiptSha256: publication.conversionReceiptSha256,
	};
}

function reboundSource(source: FramescaperImageSourceV1, bytes: Uint8Array): FramescaperImageSourceV1 {
	return { ...source, contentSha256: bytesToHex(sha256(bytes)), assetByteLength: bytes.byteLength };
}

function open(bytes: Uint8Array, source: FramescaperImageSourceV1) {
	return openFramescaperImageFramePackV1({
		source, read: (offset, length) => bytes.slice(offset, offset + length),
	});
}
