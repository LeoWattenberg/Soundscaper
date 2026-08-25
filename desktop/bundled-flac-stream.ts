/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded authority for native FLAC STREAMINFO before reviewed decoding. */

const FLAC_MARKER = Object.freeze([0x66, 0x4c, 0x61, 0x43] as const);
const STREAMINFO_BYTES = 34;
const MAXIMUM_METADATA_BLOCKS = 64;
const MAXIMUM_METADATA_BYTES = 1024 * 1024;
const MAXIMUM_FRAME_COUNT = 33_554_432;

export interface BundledFlacStreamGeometry {
	readonly blockCount: number;
	readonly metadataBytes: number;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly bitsPerSample: number;
}

export class BundledFlacStreamError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BundledFlacStreamError';
	}
}

export function parseBundledFlacStream(value: unknown): BundledFlacStreamGeometry {
	if (!(value instanceof Uint8Array) || value.byteLength < 43) {
		throw fault('The FLAC stream is not a non-empty bounded native stream.');
	}
	if (FLAC_MARKER.some((byte, index) => value[index] !== byte)) {
		throw fault('The FLAC native stream marker is missing.');
	}
	let offset: number = FLAC_MARKER.length;
	let blockCount = 0;
	let streamInfo: BundledFlacStreamGeometry | null = null;
	let last = false;
	while (!last) {
		if (blockCount >= MAXIMUM_METADATA_BLOCKS || offset + 4 > value.byteLength) {
			throw fault('The FLAC metadata block list is invalid or outside its bound.');
		}
		const header = value[offset]!;
		last = (header & 0x80) !== 0;
		const type = header & 0x7f;
		if (type === 0x7f) throw fault('The FLAC metadata block type is invalid.');
		const length = value[offset + 1]! * 65_536 + value[offset + 2]! * 256 + value[offset + 3]!;
		const dataOffset = offset + 4;
		const nextOffset = dataOffset + length;
		if (!Number.isSafeInteger(nextOffset) || nextOffset > value.byteLength
			|| nextOffset > FLAC_MARKER.length + MAXIMUM_METADATA_BYTES) {
			throw fault('The FLAC metadata exceeds its byte bound.');
		}
		if (blockCount === 0) {
			if (type !== 0 || length !== STREAMINFO_BYTES) {
				throw fault('The FLAC stream must begin with one exact STREAMINFO block.');
			}
			streamInfo = parseStreamInfo(value, dataOffset);
		} else if (type === 0) {
			throw fault('The FLAC stream repeats its STREAMINFO block.');
		}
		blockCount += 1;
		offset = nextOffset;
	}
	if (streamInfo === null || offset >= value.byteLength) {
		throw fault('The FLAC stream contains no bounded audio frames.');
	}
	return Object.freeze({
		...streamInfo,
		blockCount,
		metadataBytes: offset,
	});
}

function parseStreamInfo(bytes: Uint8Array, offset: number): BundledFlacStreamGeometry {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const minimumBlockSize = view.getUint16(offset, false);
	const maximumBlockSize = view.getUint16(offset + 2, false);
	if (minimumBlockSize < 16 || maximumBlockSize < minimumBlockSize) {
		throw fault('The FLAC STREAMINFO block size range is invalid.');
	}
	const minimumFrameSize = uint24(bytes, offset + 4);
	const maximumFrameSize = uint24(bytes, offset + 7);
	if (maximumFrameSize !== 0 && (minimumFrameSize === 0 || maximumFrameSize < minimumFrameSize)) {
		throw fault('The FLAC STREAMINFO frame size range is invalid.');
	}
	const packed = view.getBigUint64(offset + 10, false);
	const sampleRate = Number((packed >> 44n) & 0xfffffn);
	const channelCount = Number((packed >> 41n) & 0x7n) + 1;
	const bitsPerSample = Number((packed >> 36n) & 0x1fn) + 1;
	const frameCount = Number(packed & 0xfffffffffn);
	if (!Number.isSafeInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 192_000
		|| channelCount < 1 || channelCount > 8
		|| bitsPerSample < 4 || bitsPerSample > 32
		|| !Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount > MAXIMUM_FRAME_COUNT) {
		throw fault('The FLAC STREAMINFO audio geometry is invalid or outside its bound.');
	}
	return Object.freeze({
		blockCount: 0,
		metadataBytes: 0,
		frameCount,
		channelCount,
		sampleRate,
		bitsPerSample,
	});
}

function uint24(bytes: Uint8Array, offset: number): number {
	return bytes[offset]! * 65_536 + bytes[offset + 1]! * 256 + bytes[offset + 2]!;
}

function fault(message: string): BundledFlacStreamError {
	return new BundledFlacStreamError(message);
}
