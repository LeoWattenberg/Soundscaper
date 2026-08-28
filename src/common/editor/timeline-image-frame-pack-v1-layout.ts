/* SPDX-License-Identifier: AGPL-3.0-only */

import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

import {
	FRAMESCAPER_IMAGE_ASSET_MAGIC,
	FRAMESCAPER_IMAGE_MODEL_LIMITS_V1,
	FRAMESCAPER_IMAGE_TICKS_PER_SECOND,
	type FramescaperImageFrameTimingV1,
	type FramescaperImageSourceV1,
	type FramescaperImageTimingModeV1,
} from './timeline-image-model.ts';

export const FRAMESCAPER_IMAGE_FRAME_PACK_VERSION = 1 as const;
export const FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES = 256;
export const FRAMESCAPER_IMAGE_FRAME_PACK_INDEX_BYTES = 128;
export const FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_CHUNK_BYTES = 16 * 1024 * 1024;
export const FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_RECEIPT_BYTES = 8 * 1024 * 1024;

const MAGIC = new TextEncoder().encode(FRAMESCAPER_IMAGE_ASSET_MAGIC);
const MAXIMUM_RAW_BYTES = FRAMESCAPER_IMAGE_MODEL_LIMITS_V1.maximumPixelsPerFrame * 4;

export interface FramescaperImageFramePackSectionsV1 {
	readonly originalOffset: number;
	readonly originalByteLength: number;
	readonly receiptOffset: number;
	readonly receiptByteLength: number;
	readonly indexOffset: number;
	readonly indexByteLength: number;
	readonly frameDataOffset: number;
	readonly frameDataByteLength: number;
}

export interface FramescaperImageEncodedFrameLayoutV1 extends FramescaperImageFrameTimingV1 {
	readonly compressed: Uint8Array;
	readonly compressedSha256: string;
	readonly rawSha256: string;
	readonly rawByteLength: number;
}

export interface FramescaperImageIndexedFrameV1 extends FramescaperImageFrameTimingV1 {
	readonly offset: number;
	readonly compressedByteLength: number;
	readonly rawByteLength: number;
	readonly compressedSha256: string;
	readonly rawSha256: string;
}

export class FramescaperImageFramePackV1Error extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'FramescaperImageFramePackV1Error';
	}
}

export function createFramescaperImageFramePackSectionsV1(
	originalByteLength: number,
	receiptByteLength: number,
	frames: readonly FramescaperImageEncodedFrameLayoutV1[],
): FramescaperImageFramePackSectionsV1 {
	const originalOffset = FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES;
	const receiptOffset = checkedFramescaperImageAssetAdd(originalOffset, originalByteLength, 'receipt offset');
	const indexOffset = checkedFramescaperImageAssetAdd(receiptOffset, receiptByteLength, 'index offset');
	const indexByteLength = checkedFramescaperImageAssetMultiply(
		frames.length, FRAMESCAPER_IMAGE_FRAME_PACK_INDEX_BYTES, 'index byte length',
	);
	const frameDataOffset = checkedFramescaperImageAssetAdd(indexOffset, indexByteLength, 'frame-data offset');
	const frameDataByteLength = frames.reduce(
		(total, frame) => checkedFramescaperImageAssetAdd(
			total, frame.compressed.byteLength, 'frame-data byte length',
		),
		0,
	);
	return Object.freeze({
		originalOffset,
		originalByteLength,
		receiptOffset,
		receiptByteLength,
		indexOffset,
		indexByteLength,
		frameDataOffset,
		frameDataByteLength,
	});
}

export function encodeFramescaperImageFramePackHeaderV1(value: Readonly<{
	sections: FramescaperImageFramePackSectionsV1;
	totalByteLength: number;
	width: number;
	height: number;
	frameCount: number;
	durationTicks: bigint;
	timingMode: FramescaperImageTimingModeV1;
	hasAlpha: boolean;
	originalSha256: string;
	conversionReceiptSha256: string;
}>): Uint8Array {
	const output = new Uint8Array(FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES);
	output.set(MAGIC);
	const view = new DataView(output.buffer);
	view.setUint32(8, FRAMESCAPER_IMAGE_FRAME_PACK_VERSION, true);
	view.setUint32(12, FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES, true);
	view.setUint32(16, FRAMESCAPER_IMAGE_FRAME_PACK_INDEX_BYTES, true);
	view.setBigUint64(24, BigInt(value.totalByteLength), true);
	view.setBigUint64(32, BigInt(value.sections.originalOffset), true);
	view.setBigUint64(40, BigInt(value.sections.originalByteLength), true);
	view.setBigUint64(48, BigInt(value.sections.receiptOffset), true);
	view.setBigUint64(56, BigInt(value.sections.receiptByteLength), true);
	view.setBigUint64(64, BigInt(value.sections.indexOffset), true);
	view.setBigUint64(72, BigInt(value.sections.indexByteLength), true);
	view.setBigUint64(80, BigInt(value.sections.frameDataOffset), true);
	view.setBigUint64(88, BigInt(value.sections.frameDataByteLength), true);
	view.setUint32(96, value.width, true);
	view.setUint32(100, value.height, true);
	view.setUint32(104, value.frameCount, true);
	view.setUint32(108, FRAMESCAPER_IMAGE_TICKS_PER_SECOND, true);
	view.setBigUint64(112, value.durationTicks, true);
	output.set(hexToBytes(value.originalSha256), 120);
	output.set(hexToBytes(value.conversionReceiptSha256), 152);
	view.setUint32(184, timingModeCode(value.timingMode), true);
	view.setUint32(188, value.hasAlpha ? 1 : 0, true);
	return output;
}

export function encodeFramescaperImageFramePackIndexV1(
	frame: FramescaperImageEncodedFrameLayoutV1,
	offset: number,
): Uint8Array {
	const output = new Uint8Array(FRAMESCAPER_IMAGE_FRAME_PACK_INDEX_BYTES);
	const view = new DataView(output.buffer);
	view.setBigUint64(0, frame.presentationTicks, true);
	view.setBigUint64(8, frame.durationTicks, true);
	view.setBigUint64(16, BigInt(offset), true);
	view.setBigUint64(24, BigInt(frame.compressed.byteLength), true);
	view.setBigUint64(32, BigInt(frame.rawByteLength), true);
	output.set(hexToBytes(frame.compressedSha256), 40);
	output.set(hexToBytes(frame.rawSha256), 72);
	return output;
}

export function decodeFramescaperImageFramePackHeaderV1(
	bytes: Uint8Array,
	source: FramescaperImageSourceV1,
): FramescaperImageFramePackSectionsV1 {
	if (!MAGIC.every((value, index) => bytes[index] === value)) {
		throw new FramescaperImageFramePackV1Error('The image frame-pack magic is unsupported.');
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const originalOffset = safeUnsigned(view.getBigUint64(32, true), 'original offset');
	const originalByteLength = safeUnsigned(view.getBigUint64(40, true), 'original length');
	const receiptOffset = safeUnsigned(view.getBigUint64(48, true), 'receipt offset');
	const receiptByteLength = safeUnsigned(view.getBigUint64(56, true), 'receipt length');
	const indexOffset = safeUnsigned(view.getBigUint64(64, true), 'index offset');
	const indexByteLength = safeUnsigned(view.getBigUint64(72, true), 'index length');
	const frameDataOffset = safeUnsigned(view.getBigUint64(80, true), 'frame-data offset');
	const frameDataByteLength = safeUnsigned(view.getBigUint64(88, true), 'frame-data length');
	const mode = timingModeFromCode(view.getUint32(184, true));
	if (view.getUint32(8, true) !== FRAMESCAPER_IMAGE_FRAME_PACK_VERSION
		|| view.getUint32(12, true) !== FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES
		|| view.getUint32(16, true) !== FRAMESCAPER_IMAGE_FRAME_PACK_INDEX_BYTES
		|| view.getUint32(20, true) !== 0
		|| safeUnsigned(view.getBigUint64(24, true), 'total byte length') !== source.assetByteLength
		|| view.getUint32(96, true) !== source.canonical.width
		|| view.getUint32(100, true) !== source.canonical.height
		|| view.getUint32(104, true) !== source.canonical.frameCount
		|| view.getUint32(108, true) !== FRAMESCAPER_IMAGE_TICKS_PER_SECOND
		|| view.getBigUint64(112, true).toString() !== source.canonical.durationTicks
		|| bytesToHex(bytes.subarray(120, 152)) !== source.original.sha256
		|| bytesToHex(bytes.subarray(152, 184)) !== source.conversionReceiptSha256
		|| mode !== source.canonical.timingMode
		|| view.getUint32(188, true) !== (source.canonical.hasAlpha ? 1 : 0)
		|| bytes.subarray(192).some((value) => value !== 0)) {
		throw new FramescaperImageFramePackV1Error('The image frame-pack header disagrees with its persisted summary or reserved domain.');
	}
	if (originalOffset !== FRAMESCAPER_IMAGE_FRAME_PACK_HEADER_BYTES
		|| originalByteLength !== source.original.byteLength
		|| receiptByteLength < 2 || receiptByteLength > FRAMESCAPER_IMAGE_FRAME_PACK_MAXIMUM_RECEIPT_BYTES
		|| receiptOffset !== checkedFramescaperImageAssetAdd(originalOffset, originalByteLength, 'receipt offset')
		|| indexByteLength !== checkedFramescaperImageAssetMultiply(
			source.canonical.frameCount, FRAMESCAPER_IMAGE_FRAME_PACK_INDEX_BYTES, 'index length',
		)
		|| indexOffset !== checkedFramescaperImageAssetAdd(receiptOffset, receiptByteLength, 'index offset')
		|| frameDataOffset !== checkedFramescaperImageAssetAdd(indexOffset, indexByteLength, 'frame-data offset')
		|| checkedFramescaperImageAssetAdd(frameDataOffset, frameDataByteLength, 'asset end') !== source.assetByteLength
		|| frameDataByteLength < source.canonical.frameCount) {
		throw new FramescaperImageFramePackV1Error('The image frame-pack section arithmetic is invalid.');
	}
	return Object.freeze({
		originalOffset, originalByteLength, receiptOffset, receiptByteLength,
		indexOffset, indexByteLength, frameDataOffset, frameDataByteLength,
	});
}

export function decodeFramescaperImageFramePackIndexesV1(
	bytes: Uint8Array,
	source: FramescaperImageSourceV1,
	header: FramescaperImageFramePackSectionsV1,
): readonly FramescaperImageIndexedFrameV1[] {
	const rawByteLength = checkedFramescaperImageAssetMultiply(
		checkedFramescaperImageAssetMultiply(
			source.canonical.width, source.canonical.height, 'canonical pixels',
		),
		4,
		'canonical frame bytes',
	);
	let expectedPresentation = 0n;
	let expectedOffset = header.frameDataOffset;
	let totalRawBytes = 0;
	const result: FramescaperImageIndexedFrameV1[] = [];
	for (let index = 0; index < source.canonical.frameCount; index += 1) {
		const offset = index * FRAMESCAPER_IMAGE_FRAME_PACK_INDEX_BYTES;
		const entry = bytes.subarray(offset, offset + FRAMESCAPER_IMAGE_FRAME_PACK_INDEX_BYTES);
		const view = new DataView(entry.buffer, entry.byteOffset, entry.byteLength);
		const presentationTicks = view.getBigUint64(0, true);
		const durationTicks = view.getBigUint64(8, true);
		const frameOffset = safeUnsigned(view.getBigUint64(16, true), 'frame offset');
		const compressedByteLength = safeUnsigned(view.getBigUint64(24, true), 'compressed length');
		const storedRawByteLength = safeUnsigned(view.getBigUint64(32, true), 'raw length');
		if (presentationTicks !== expectedPresentation || durationTicks < 1n
			|| presentationTicks + durationTicks > BigInt(FRAMESCAPER_IMAGE_MODEL_LIMITS_V1.maximumDurationTicks)
			|| frameOffset !== expectedOffset || compressedByteLength < 1
			|| storedRawByteLength !== rawByteLength || storedRawByteLength > MAXIMUM_RAW_BYTES
			|| entry.subarray(104).some((value) => value !== 0)) {
			throw new FramescaperImageFramePackV1Error('The image frame-pack index is noncanonical or discontinuous.');
		}
		expectedPresentation += durationTicks;
		expectedOffset = checkedFramescaperImageAssetAdd(expectedOffset, compressedByteLength, 'frame payload offset');
		totalRawBytes = checkedFramescaperImageAssetAdd(totalRawBytes, storedRawByteLength, 'decoded RGBA byte length');
		if (totalRawBytes > FRAMESCAPER_IMAGE_MODEL_LIMITS_V1.maximumAssetBytes) {
			throw new FramescaperImageFramePackV1Error('The image frame-pack decoded RGBA total is oversized.');
		}
		result.push(Object.freeze({
			presentationTicks,
			durationTicks,
			offset: frameOffset,
			compressedByteLength,
			rawByteLength: storedRawByteLength,
			compressedSha256: bytesToHex(entry.subarray(40, 72)),
			rawSha256: bytesToHex(entry.subarray(72, 104)),
		}));
	}
	if (expectedPresentation.toString() !== source.canonical.durationTicks
		|| expectedOffset !== header.frameDataOffset + header.frameDataByteLength
		|| expectedOffset !== source.assetByteLength) {
		throw new FramescaperImageFramePackV1Error('The image frame-pack index does not reach its exact timing or asset end.');
	}
	return Object.freeze(result);
}

export function checkedFramescaperImageAssetAdd(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result) || result < 0) {
		throw new FramescaperImageFramePackV1Error(`The image ${name} exceeds exact integer arithmetic.`);
	}
	return result;
}

export function checkedFramescaperImageAssetMultiply(left: number, right: number, name: string): number {
	const result = left * right;
	if (!Number.isSafeInteger(result) || result < 0) {
		throw new FramescaperImageFramePackV1Error(`The image ${name} exceeds exact integer arithmetic.`);
	}
	return result;
}

function timingModeCode(value: FramescaperImageTimingModeV1): number {
	return value === 'embedded' ? 1 : value === 'fallback' ? 2 : 3;
}

function timingModeFromCode(value: number): FramescaperImageTimingModeV1 {
	if (value === 1) return 'embedded';
	if (value === 2) return 'fallback';
	if (value === 3) return 'mixed';
	throw new FramescaperImageFramePackV1Error('The image frame-pack timing mode is unsupported.');
}

function safeUnsigned(value: bigint, name: string): number {
	if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new FramescaperImageFramePackV1Error(`The image ${name} exceeds exact integer arithmetic.`);
	}
	return Number(value);
}
