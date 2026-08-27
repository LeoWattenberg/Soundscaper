/* SPDX-License-Identifier: AGPL-3.0-only */

/** Ordered custody for multiple independently strict visual frame packs. */

import { ASSISTANCE_BINARY_MAXIMUM_BYTES } from './binary-formats-v1.ts';
import {
	reviewAssistanceVisualFramePack,
	type ReviewedAssistanceVisualFramePack,
} from './visual-frame-pack-v2.ts';

export const ASSISTANCE_VISUAL_FRAME_PACK_SET_SCHEMA_VERSION = 1 as const;
export const ASSISTANCE_VISUAL_FRAME_PACK_SET_MAXIMUM_PACKS = 64;
export const ASSISTANCE_VISUAL_FRAME_PACK_SET_MAXIMUM_PACK_BYTES = 64 * 1024 * 1024;

const MAGIC = new TextEncoder().encode('soundscaper-assistance-frame-pack-set-v1\n');
const HEADER_BYTES = MAGIC.byteLength + 12;
const PACK_HEADER_BYTES = 4;
const MAXIMUM_FRAMES = 100_000;

export interface ReviewedAssistanceVisualFramePackSetV1 {
	readonly schemaVersion: typeof ASSISTANCE_VISUAL_FRAME_PACK_SET_SCHEMA_VERSION;
	readonly frameCount: number;
	readonly packs: readonly ReviewedAssistanceVisualFramePack[];
}

/**
 * Wrap complete v1/v2 frame packs without merging their headers or weakening their
 * individual byte bounds. The resulting chunks can be streamed directly to custody.
 */
export function createAssistanceVisualFramePackSetV1(
	packChunks: readonly (readonly Uint8Array[])[],
): readonly Uint8Array[] {
	if (!Array.isArray(packChunks) || packChunks.length < 1
		|| packChunks.length > ASSISTANCE_VISUAL_FRAME_PACK_SET_MAXIMUM_PACKS) {
		throw new RangeError('The visual frame-pack set inventory exceeds its exact bound.');
	}
	const reviewed = validateReviewedPacks(packChunks.map((chunks) =>
		reviewAssistanceVisualFramePack(chunks)));
	const bodyLengths = packChunks.map((chunks, index) => {
		if (!Array.isArray(chunks) || chunks.length < 1
			|| chunks.some((chunk) => !(chunk instanceof Uint8Array) || chunk.byteLength < 1)) {
			throw new TypeError(`Visual frame-pack set member ${String(index)} has invalid chunks.`);
		}
		const byteLength = chunks.reduce((total, chunk) => safeAdd(total, chunk.byteLength), 0);
		if (byteLength > ASSISTANCE_VISUAL_FRAME_PACK_SET_MAXIMUM_PACK_BYTES) {
			throw new RangeError(`Visual frame-pack set member ${String(index)} exceeds its byte bound.`);
		}
		return byteLength;
	});
	const totalBytes = bodyLengths.reduce((total, byteLength) =>
		safeAdd(total, PACK_HEADER_BYTES + byteLength), HEADER_BYTES);
	if (totalBytes > ASSISTANCE_BINARY_MAXIMUM_BYTES) {
		throw new RangeError('The visual frame-pack set exceeds its aggregate byte bound.');
	}
	const header = new Uint8Array(HEADER_BYTES);
	header.set(MAGIC);
	const view = new DataView(header.buffer);
	view.setUint32(MAGIC.byteLength, ASSISTANCE_VISUAL_FRAME_PACK_SET_SCHEMA_VERSION, true);
	view.setUint32(MAGIC.byteLength + 4, packChunks.length, true);
	view.setUint32(MAGIC.byteLength + 8, reviewed.frameCount, true);
	const chunks: Uint8Array[] = [header];
	for (const [index, body] of packChunks.entries()) {
		const memberHeader = new Uint8Array(PACK_HEADER_BYTES);
		new DataView(memberHeader.buffer).setUint32(0, bodyLengths[index]!, true);
		// Member chunks already belong to the completed strict pack. Reusing them avoids a second
		// aggregate-sized body while custody streams the bounded (512 MiB maximum) outer set.
		chunks.push(memberHeader, ...body);
	}
	return Object.freeze(chunks);
}

/** Review one complete set body and retain isolated strict member-pack snapshots. */
export function reviewAssistanceVisualFramePackSetV1(
	value: ArrayBuffer | ArrayBufferView,
): ReviewedAssistanceVisualFramePackSetV1 {
	const bytes = binary(value);
	if (bytes.byteLength < HEADER_BYTES || !startsWith(bytes, MAGIC)) {
		throw new TypeError('The visual frame-pack set magic is unsupported.');
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(MAGIC.byteLength, true)
		!== ASSISTANCE_VISUAL_FRAME_PACK_SET_SCHEMA_VERSION) {
		throw new TypeError('The visual frame-pack set version is unsupported.');
	}
	const packCount = view.getUint32(MAGIC.byteLength + 4, true);
	const expectedFrameCount = view.getUint32(MAGIC.byteLength + 8, true);
	if (packCount < 1 || packCount > ASSISTANCE_VISUAL_FRAME_PACK_SET_MAXIMUM_PACKS
		|| expectedFrameCount < 1 || expectedFrameCount > MAXIMUM_FRAMES
		|| bytes.byteLength > ASSISTANCE_BINARY_MAXIMUM_BYTES) {
		throw new RangeError('The visual frame-pack set header exceeds its exact bounds.');
	}
	let offset = HEADER_BYTES;
	const packs: ReviewedAssistanceVisualFramePack[] = [];
	for (let index = 0; index < packCount; index += 1) {
		if (offset + PACK_HEADER_BYTES > bytes.byteLength) {
			throw new RangeError('The visual frame-pack set is truncated.');
		}
		const byteLength = view.getUint32(offset, true);
		offset += PACK_HEADER_BYTES;
		if (byteLength < 1 || byteLength > ASSISTANCE_VISUAL_FRAME_PACK_SET_MAXIMUM_PACK_BYTES
			|| offset + byteLength > bytes.byteLength) {
			throw new RangeError(`Visual frame-pack set member ${String(index)} is truncated or oversized.`);
		}
		packs.push(reviewAssistanceVisualFramePack(bytes.subarray(offset, offset + byteLength)));
		offset += byteLength;
	}
	if (offset !== bytes.byteLength) {
		throw new RangeError('The visual frame-pack set contains trailing data.');
	}
	const result = validateReviewedPacks(packs);
	if (result.frameCount !== expectedFrameCount) {
		throw new RangeError('The visual frame-pack set frame count disagrees with its members.');
	}
	return Object.freeze({ schemaVersion: ASSISTANCE_VISUAL_FRAME_PACK_SET_SCHEMA_VERSION,
		frameCount: result.frameCount, packs: Object.freeze(packs) });
}

/** Admit either one legacy strict pack or one ordered strict pack set. */
export function reviewAssistanceVisualFramePackInventory(
	value: ArrayBuffer | ArrayBufferView,
): readonly ReviewedAssistanceVisualFramePack[] {
	const bytes = binary(value);
	return Object.freeze(startsWith(bytes, MAGIC)
		? [...reviewAssistanceVisualFramePackSetV1(bytes).packs]
		: [reviewAssistanceVisualFramePack(bytes)]);
}

function validateReviewedPacks(
	packs: readonly ReviewedAssistanceVisualFramePack[],
): Readonly<{ frameCount: number }> {
	let sourceWidth: number | null = null;
	let sourceHeight: number | null = null;
	let rasterWidth: number | null = null;
	let rasterHeight: number | null = null;
	let timescale: number | null = null;
	let priorSource = -1;
	let priorTick = -1n;
	let frameCount = 0;
	for (const pack of packs) {
		if (pack.frameCount < 1) throw new RangeError('A visual frame-pack set member cannot be empty.');
		if (sourceWidth !== null && (pack.sourceWidth !== sourceWidth
			|| pack.sourceHeight !== sourceHeight || pack.rasterWidth !== rasterWidth
			|| pack.rasterHeight !== rasterHeight || pack.timescale !== timescale)) {
			throw new RangeError('Visual frame-pack set members disagree about geometry or timescale.');
		}
		sourceWidth ??= pack.sourceWidth;
		sourceHeight ??= pack.sourceHeight;
		rasterWidth ??= pack.rasterWidth;
		rasterHeight ??= pack.rasterHeight;
		timescale ??= pack.timescale;
		for (let frameIndex = 0; frameIndex < pack.frameCount; frameIndex += 1) {
			const frame = pack.frame(frameIndex);
			if (frame.sourceFrame <= priorSource || BigInt(frame.presentationTick) <= priorTick) {
				throw new RangeError('Visual frame-pack set members must retain strict source/tick order.');
			}
			priorSource = frame.sourceFrame;
			priorTick = BigInt(frame.presentationTick);
			frameCount += 1;
			if (frameCount > MAXIMUM_FRAMES) {
				throw new RangeError('The visual frame-pack set exceeds its exact frame bound.');
			}
		}
	}
	return Object.freeze({ frameCount });
}

function binary(value: ArrayBuffer | ArrayBufferView): Uint8Array {
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (!ArrayBuffer.isView(value)) throw new TypeError('A binary visual frame-pack set is required.');
	return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
	return bytes.byteLength >= prefix.byteLength
		&& prefix.every((value, index) => bytes[index] === value);
}

function safeAdd(left: number, right: number): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError('Visual frame-pack set geometry overflowed.');
	return result;
}
