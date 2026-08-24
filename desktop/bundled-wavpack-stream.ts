/* SPDX-License-Identifier: AGPL-3.0-only */

/** Strict parser and block rewriter for the reviewed float32 WavPack WASM ABI. */

const WAVPACK_HEADER_BYTES = 32;
const WAVPACK_MINIMUM_VERSION = 0x402;
const WAVPACK_MAXIMUM_VERSION = 0x410;
const WAVPACK_MAXIMUM_FRAME_COUNT = 128 * 1024 * 1024 / Float32Array.BYTES_PER_ELEMENT;
const WAVPACK_MAXIMUM_CHANNEL_COUNT = 8;
const WAVPACK_MAXIMUM_BLOCK_FRAMES = 65_536;
const WAVPACK_MAXIMUM_BLOCK_COUNT = 16_384;
const WAVPACK_MAXIMUM_METADATA_ENTRIES = 4_096;

const BYTES_STORED_MASK = 0x3;
const MONO_FLAG = 0x4;
const HYBRID_FLAG = 0x8;
const FLOAT_DATA = 0x80;
const INITIAL_BLOCK = 0x800;
const FINAL_BLOCK = 0x1000;
const SAMPLE_RATE_SHIFT = 23;
const SAMPLE_RATE_MASK = 0xf;
const HAS_CHECKSUM = 0x1000_0000;
const DSD_FLAG = 0x8000_0000;

const METADATA_UNIQUE_MASK = 0x3f;
const METADATA_ODD_SIZE = 0x40;
const METADATA_LARGE = 0x80;
const METADATA_CHANNEL_INFO = 0x0d;
const METADATA_RIFF_HEADER = 0x21;
const METADATA_RIFF_TRAILER = 0x22;
const METADATA_MD5_CHECKSUM = 0x26;
const METADATA_SAMPLE_RATE = 0x27;
const METADATA_BLOCK_CHECKSUM = 0x2f;

// Closed to metadata understood by the pinned lossless float32 decoder. Hybrid
// correction, DSD, integer, alternate-container, and extension records are not
// part of this provider's reviewed decode surface. WavPack 5.9 defines no
// encryption flag or metadata; this allowlist also rejects any future extension.
const LOSSLESS_FLOAT_METADATA = new Set([
	0x00, // dummy padding
	0x01, // encoder information
	0x02, // decorrelation terms
	0x03, // decorrelation weights
	0x04, // decorrelation samples
	0x05, // entropy variables
	0x08, // float information
	0x0a, // primary WV bitstream
	0x0c, // float WVX bitstream
	0x0d, // channel information
	0x21, // RIFF header
	0x22, // RIFF trailer
	0x25, // encoder configuration
	0x26, // MD5 checksum
	0x27, // non-standard sample rate
	0x2a, // WavPack 5 configuration
	0x2b, // channel identities
	0x2c, // WavPack 5 float WVX bitstream
	0x2f, // block checksum
]);

const STANDARD_SAMPLE_RATES = Object.freeze([
	6_000, 8_000, 9_600, 11_025, 12_000, 16_000, 22_050, 24_000,
	32_000, 44_100, 48_000, 64_000, 88_200, 96_000, 192_000,
] as const);

interface WavPackMetadataEntry {
	readonly id: number;
	readonly start: number;
	readonly end: number;
	readonly dataOffset: number;
	readonly dataLength: number;
	readonly large: boolean;
}

export interface BundledWavPackBlock {
	readonly offset: number;
	readonly byteLength: number;
	readonly totalFrames: number;
	readonly blockIndex: number;
	readonly blockFrames: number;
	readonly channelCount: number;
	readonly metadataIds: readonly number[];
}

export interface BundledWavPackGroup {
	readonly offset: number;
	readonly byteLength: number;
	readonly blockIndex: number;
	readonly frameCount: number;
	readonly blocks: readonly BundledWavPackBlock[];
}

export interface BundledWavPackStreamGeometry {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
	readonly groups: readonly BundledWavPackGroup[];
}

export class BundledWavPackStreamError extends Error {
	readonly code = 'BUNDLED_WAVPACK_STREAM_INVALID' as const;
	constructor(message: string) {
		super(message);
		this.name = 'BundledWavPackStreamError';
	}
}

export function parseBundledWavPackStream(input: Uint8Array): BundledWavPackStreamGeometry {
	if (!(input instanceof Uint8Array) || input.byteLength < WAVPACK_HEADER_BYTES) {
		throw invalidStream('The WavPack stream is empty or truncated.');
	}
	const view = dataView(input);
	const groups: BundledWavPackGroup[] = [];
	let offset = 0;
	let expectedBlockIndex = 0;
	let totalFrames: number | null = null;
	let sampleRate: number | null = null;
	let channelCount: number | null = null;
	let active: {
		offset: number;
		blockIndex: number;
		frameCount: number;
		channels: number;
		blocks: BundledWavPackBlock[];
		channelDeclaration: number | null;
	} | null = null;
	let riffHeaderCount = 0;
	let riffTrailerCount = 0;
	let md5Count = 0;
	let blockCount = 0;

	while (offset < input.byteLength) {
		blockCount += 1;
		if (blockCount > WAVPACK_MAXIMUM_BLOCK_COUNT) {
			throw invalidStream('The WavPack stream contains too many bounded blocks.');
		}
		const block = parseBlock(input, view, offset);
		if (block.initial) {
			if (active !== null) throw invalidStream('The WavPack multichannel block sequence is nested.');
			if (block.blockIndex !== expectedBlockIndex) {
				throw invalidStream('The WavPack sample blocks are not contiguous.');
			}
			active = {
				offset, blockIndex: block.blockIndex, frameCount: block.blockFrames,
				channels: 0, blocks: [], channelDeclaration: null,
			};
		} else if (active === null) {
			throw invalidStream('The WavPack stream does not begin a multichannel block sequence.');
		}
		if (active === null || block.blockIndex !== active.blockIndex
			|| block.blockFrames !== active.frameCount) {
			throw invalidStream('The WavPack multichannel blocks have inconsistent geometry.');
		}
		if (totalFrames === null) totalFrames = block.totalFrames;
		else if (totalFrames !== block.totalFrames) {
			throw invalidStream('The WavPack blocks disagree about the total sample count.');
		}
		if (block.sampleRate !== null) {
			if (sampleRate === null) sampleRate = block.sampleRate;
			else if (sampleRate !== block.sampleRate) {
				throw invalidStream('The WavPack blocks disagree about the sample rate.');
			}
		}
		if (block.channelDeclaration !== null) {
			if (active.channelDeclaration !== null
				&& active.channelDeclaration !== block.channelDeclaration) {
				throw invalidStream('The WavPack blocks disagree about the channel count.');
			}
			active.channelDeclaration = block.channelDeclaration;
		}
		const blockRiffHeaders = count(block.metadataIds, METADATA_RIFF_HEADER);
		const blockRiffTrailers = count(block.metadataIds, METADATA_RIFF_TRAILER);
		const blockMd5 = count(block.metadataIds, METADATA_MD5_CHECKSUM);
		riffHeaderCount += blockRiffHeaders;
		riffTrailerCount += blockRiffTrailers;
		md5Count += blockMd5;
		if (blockRiffHeaders > 0) {
			if (riffHeaderCount !== 1 || offset !== 0 || block.blockIndex !== 0 || !block.initial) {
				throw invalidStream('The WavPack RIFF wrapper header is not uniquely file-scoped.');
			}
		}
		if (riffTrailerCount > 1 || blockRiffTrailers > 0 && offset + block.byteLength !== input.byteLength) {
			throw invalidStream('The WavPack RIFF wrapper trailer is not at the end of the stream.');
		}
		if (md5Count > 1) throw invalidStream('The WavPack stream has more than one file checksum.');
		active.channels += block.channelCount;
		active.blocks.push(Object.freeze({
			offset, byteLength: block.byteLength, totalFrames: block.totalFrames,
			blockIndex: block.blockIndex, blockFrames: block.blockFrames,
			channelCount: block.channelCount, metadataIds: block.metadataIds,
		}));
		offset += block.byteLength;
		if (block.final) {
			if (active.channels < 1 || active.channels > WAVPACK_MAXIMUM_CHANNEL_COUNT
				|| active.channelDeclaration !== null
					&& active.channelDeclaration !== active.channels) {
				throw invalidStream('The WavPack channel geometry is unsupported or inconsistent.');
			}
			if (channelCount === null) channelCount = active.channels;
			else if (channelCount !== active.channels) {
				throw invalidStream('The WavPack sample groups disagree about the channel count.');
			}
			const byteLength = offset - active.offset;
			groups.push(Object.freeze({
				offset: active.offset, byteLength, blockIndex: active.blockIndex,
				frameCount: active.frameCount, blocks: Object.freeze(active.blocks),
			}));
			expectedBlockIndex += active.frameCount;
			active = null;
		}
	}
	if (active !== null || groups.length === 0 || totalFrames === null
		|| sampleRate === null || channelCount === null || expectedBlockIndex !== totalFrames) {
		throw invalidStream('The WavPack stream has incomplete source geometry.');
	}
	if (riffTrailerCount > 0 && riffHeaderCount !== 1) {
		throw invalidStream('The WavPack RIFF wrapper trailer has no file-scoped header.');
	}
	return Object.freeze({
		sampleRate, channelCount, frameCount: totalFrames, groups: Object.freeze(groups),
	});
}

export function assembleBundledWavPackChunks(options: Readonly<{
	readonly chunks: readonly Uint8Array[];
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
	readonly maximumOutputBytes: number;
}>): Uint8Array {
	if (!Array.isArray(options.chunks) || options.chunks.length < 1
		|| !Number.isSafeInteger(options.frameCount) || options.frameCount < 1
		|| options.frameCount > WAVPACK_MAXIMUM_FRAME_COUNT
		|| !Number.isSafeInteger(options.maximumOutputBytes) || options.maximumOutputBytes < 1) {
		throw new RangeError('The WavPack chunk assembly bounds are invalid.');
	}
	const outputBlocks: Uint8Array[] = [];
	let frameOffset = 0;
	let byteLength = 0;
	for (let chunkIndex = 0; chunkIndex < options.chunks.length; chunkIndex += 1) {
		const chunk = options.chunks[chunkIndex];
		if (!(chunk instanceof Uint8Array)) throw new TypeError('A WavPack chunk must be a Uint8Array.');
		const geometry = parseBundledWavPackStream(chunk);
		if (geometry.groups.length !== 1 || geometry.sampleRate !== options.sampleRate
			|| geometry.channelCount !== options.channelCount
			|| geometry.frameCount > WAVPACK_MAXIMUM_BLOCK_FRAMES
			|| frameOffset + geometry.frameCount > options.frameCount) {
			throw invalidStream('A WavPack encoder chunk has unexpected geometry.');
		}
		if (geometry.groups[0]!.blocks.some(({ metadataIds }) => (
			metadataIds.includes(METADATA_RIFF_TRAILER)
		))) {
			throw invalidStream('A per-chunk WavPack RIFF trailer cannot be preserved for the assembled stream.');
		}
		for (const block of geometry.groups[0]!.blocks) {
			const rewritten = rewriteEncodedBlock(chunk.subarray(
				block.offset, block.offset + block.byteLength,
			), {
				totalFrames: options.frameCount, blockIndex: frameOffset,
				removeRiffHeader: chunkIndex !== 0,
				totalPcmBytes: options.frameCount * options.channelCount * Float32Array.BYTES_PER_ELEMENT,
			});
			byteLength += rewritten.byteLength;
			if (byteLength > options.maximumOutputBytes) {
				throw new RangeError('The encoded WavPack stream exceeds the requested output bound.');
			}
			outputBlocks.push(rewritten);
		}
		frameOffset += geometry.frameCount;
	}
	if (frameOffset !== options.frameCount) {
		throw invalidStream('The WavPack encoder chunks do not cover the complete PCM input.');
	}
	const output = concatenate(outputBlocks, byteLength);
	const geometry = parseBundledWavPackStream(output);
	if (geometry.sampleRate !== options.sampleRate || geometry.channelCount !== options.channelCount
		|| geometry.frameCount !== options.frameCount) {
		throw invalidStream('The assembled WavPack stream failed its geometry check.');
	}
	return output;
}

export function materializeBundledWavPackDecodeGroup(
	input: Uint8Array,
	group: BundledWavPackGroup,
): Uint8Array {
	if (!(input instanceof Uint8Array) || !group || typeof group !== 'object'
		|| group.offset < 0 || group.byteLength < WAVPACK_HEADER_BYTES
		|| group.offset + group.byteLength > input.byteLength) {
		throw new RangeError('The WavPack decode group bounds are invalid.');
	}
	const bytes = input.slice(group.offset, group.offset + group.byteLength);
	let offset = 0;
	while (offset < bytes.byteLength) {
		const view = dataView(bytes);
		const byteLength = blockByteLength(bytes, view, offset);
		const block = bytes.subarray(offset, offset + byteLength);
		patchBlockGeometry(block, group.frameCount, 0);
		refreshBlockChecksum(block);
		offset += byteLength;
	}
	return bytes;
}

function parseBlock(input: Uint8Array, view: DataView, offset: number): Readonly<{
	readonly byteLength: number;
	readonly totalFrames: number;
	readonly blockIndex: number;
	readonly blockFrames: number;
	readonly channelCount: number;
	readonly channelDeclaration: number | null;
	readonly sampleRate: number | null;
	readonly metadataIds: readonly number[];
	readonly initial: boolean;
	readonly final: boolean;
}> {
	const byteLength = blockByteLength(input, view, offset);
	const version = view.getUint16(offset + 8, true);
	const blockIndexHigh = input[offset + 10]!;
	const totalFramesHigh = input[offset + 11]!;
	const totalFrames = view.getUint32(offset + 12, true);
	const blockIndex = view.getUint32(offset + 16, true);
	const blockFrames = view.getUint32(offset + 20, true);
	const flags = view.getUint32(offset + 24, true);
	if (version < WAVPACK_MINIMUM_VERSION || version > WAVPACK_MAXIMUM_VERSION
		|| blockIndexHigh !== 0 || totalFramesHigh !== 0 || totalFrames === 0xffff_ffff
		|| totalFrames < 1 || totalFrames > WAVPACK_MAXIMUM_FRAME_COUNT
		|| blockFrames < 1 || blockFrames > WAVPACK_MAXIMUM_BLOCK_FRAMES
		|| blockIndex + blockFrames > totalFrames || (flags & BYTES_STORED_MASK) !== 3
		|| (flags & FLOAT_DATA) === 0 || (flags & HYBRID_FLAG) !== 0 || (flags & DSD_FLAG) !== 0) {
		throw invalidStream('The WavPack block header declares unsupported float PCM geometry.');
	}
	const entries = parseMetadata(input, offset, byteLength);
	if (entries.some(({ id }) => !LOSSLESS_FLOAT_METADATA.has(id))) {
		throw invalidStream('The WavPack block contains metadata outside the reviewed float32 profile.');
	}
	if (entries.some(({ id, dataLength }) => id === METADATA_MD5_CHECKSUM && dataLength !== 16)) {
		throw invalidStream('The WavPack file checksum metadata is invalid.');
	}
	verifyBlockChecksum(input, offset, flags, entries);
	const rateIndex = (flags >>> SAMPLE_RATE_SHIFT) & SAMPLE_RATE_MASK;
	const explicitRates = entries.filter(({ id }) => id === METADATA_SAMPLE_RATE)
		.map((entry) => littleEndianInteger(input, entry.dataOffset, entry.dataLength));
	if (explicitRates.length > 1 && new Set(explicitRates).size !== 1) {
		throw invalidStream('The WavPack block has conflicting sample-rate metadata.');
	}
	const sampleRate = rateIndex < STANDARD_SAMPLE_RATES.length
		? STANDARD_SAMPLE_RATES[rateIndex]!
		: explicitRates[0] ?? null;
	if (sampleRate !== null && (!Number.isSafeInteger(sampleRate) || sampleRate < 1 || sampleRate > 768_000)) {
		throw invalidStream('The WavPack sample rate is unsupported.');
	}
	const channelDeclarations = entries.filter(({ id }) => id === METADATA_CHANNEL_INFO)
		.map((entry) => entry.dataLength > 0 ? input[entry.dataOffset]! : 0);
	if (channelDeclarations.length > 1 && new Set(channelDeclarations).size !== 1) {
		throw invalidStream('The WavPack block has conflicting channel metadata.');
	}
	return Object.freeze({
		byteLength, totalFrames, blockIndex, blockFrames,
		channelCount: flags & MONO_FLAG ? 1 : 2,
		channelDeclaration: channelDeclarations[0] ?? null,
		sampleRate, metadataIds: Object.freeze(entries.map(({ id }) => id)),
		initial: (flags & INITIAL_BLOCK) !== 0, final: (flags & FINAL_BLOCK) !== 0,
	});
}

function rewriteEncodedBlock(input: Uint8Array, options: Readonly<{
	readonly totalFrames: number;
	readonly blockIndex: number;
	readonly removeRiffHeader: boolean;
	readonly totalPcmBytes: number;
}>): Uint8Array {
	const entries = parseMetadata(input, 0, input.byteLength);
	const parts: Uint8Array[] = [input.slice(0, WAVPACK_HEADER_BYTES)];
	for (const entry of entries) {
		if (options.removeRiffHeader && entry.id === METADATA_RIFF_HEADER) continue;
		// Each encoder invocation hashes only its private chunk. An assembled file
		// must not claim any of those values as a checksum of the whole stream.
		if (entry.id === METADATA_MD5_CHECKSUM) continue;
		const metadata = input.slice(entry.start, entry.end);
		if (entry.id === METADATA_RIFF_HEADER) {
			updateRiffHeader(metadata, entry.dataOffset - entry.start, entry.dataLength, options.totalPcmBytes);
		}
		parts.push(metadata);
	}
	const byteLength = parts.reduce((total, part) => total + part.byteLength, 0);
	const output = concatenate(parts, byteLength);
	dataView(output).setUint32(4, byteLength - 8, true);
	patchBlockGeometry(output, options.totalFrames, options.blockIndex);
	refreshBlockChecksum(output);
	return output;
}

function updateRiffHeader(bytes: Uint8Array, offset: number, byteLength: number, totalPcmBytes: number): void {
	if (byteLength < 12 || ascii(bytes, offset, 4) !== 'RIFF' || ascii(bytes, offset + 8, 4) !== 'WAVE') {
		throw invalidStream('The WavPack RIFF wrapper header is invalid.');
	}
	let cursor = offset + 12;
	let dataSizeOffset: number | null = null;
	while (cursor + 8 <= offset + byteLength) {
		const size = dataView(bytes).getUint32(cursor + 4, true);
		if (ascii(bytes, cursor, 4) === 'data') {
			dataSizeOffset = cursor + 4;
			break;
		}
		cursor += 8 + size + (size & 1);
	}
	if (dataSizeOffset === null || totalPcmBytes > 0xffff_ffff - (byteLength - 8)) {
		throw invalidStream('The WavPack RIFF wrapper size is unsupported.');
	}
	const view = dataView(bytes);
	view.setUint32(offset + 4, totalPcmBytes + byteLength - 8, true);
	view.setUint32(dataSizeOffset, totalPcmBytes, true);
}

function patchBlockGeometry(block: Uint8Array, totalFrames: number, blockIndex: number): void {
	if (!Number.isSafeInteger(totalFrames) || totalFrames < 1 || totalFrames >= 0xffff_ffff
		|| !Number.isSafeInteger(blockIndex) || blockIndex < 0 || blockIndex >= 0xffff_ffff) {
		throw new RangeError('The WavPack block geometry cannot be represented.');
	}
	block[10] = 0;
	block[11] = 0;
	const view = dataView(block);
	view.setUint32(12, totalFrames, true);
	view.setUint32(16, blockIndex, true);
}

function parseMetadata(input: Uint8Array, blockOffset: number, blockBytes: number): readonly WavPackMetadataEntry[] {
	const end = blockOffset + blockBytes;
	let offset = blockOffset + WAVPACK_HEADER_BYTES;
	const entries: WavPackMetadataEntry[] = [];
	while (offset < end) {
		const start = offset;
		if (offset + 2 > end) throw invalidStream('The WavPack metadata header is truncated.');
		const rawId = input[offset++]!;
		let words = input[offset++]!;
		const large = (rawId & METADATA_LARGE) !== 0;
		if (large) {
			if (offset + 2 > end) throw invalidStream('The large WavPack metadata header is truncated.');
			words += input[offset++]! << 8;
			words += input[offset++]! << 16;
		}
		const storedBytes = words * 2;
		const odd = (rawId & METADATA_ODD_SIZE) !== 0;
		if (odd && storedBytes === 0) throw invalidStream('The WavPack metadata size is invalid.');
		const dataLength = storedBytes - (odd ? 1 : 0);
		if (offset + storedBytes > end) throw invalidStream('The WavPack metadata payload is truncated.');
		entries.push(Object.freeze({
			id: rawId & METADATA_UNIQUE_MASK, start, end: offset + storedBytes,
			dataOffset: offset, dataLength, large,
		}));
		if (entries.length > WAVPACK_MAXIMUM_METADATA_ENTRIES) {
			throw invalidStream('The WavPack block contains too many metadata records.');
		}
		offset += storedBytes;
	}
	return Object.freeze(entries);
}

function verifyBlockChecksum(
	input: Uint8Array,
	blockOffset: number,
	flags: number,
	entries: readonly WavPackMetadataEntry[],
): void {
	const checksums = entries.filter(({ id }) => id === METADATA_BLOCK_CHECKSUM);
	if ((flags & HAS_CHECKSUM) === 0 || checksums.length !== 1
		|| entries.at(-1) !== checksums[0]) {
		throw invalidStream('The WavPack block checksum declaration is missing or ambiguous.');
	}
	for (const entry of checksums) {
		if (entry.large || ![2, 4].includes(entry.dataLength) || (entry.start - blockOffset) % 2 !== 0) {
			throw invalidStream('The WavPack block checksum metadata is invalid.');
		}
		const expected = blockChecksum(input, blockOffset, entry.start, entry.dataLength);
		const actual = littleEndianInteger(input, entry.dataOffset, entry.dataLength) >>> 0;
		if (actual !== expected) throw invalidStream('The WavPack block checksum failed.');
	}
}

function refreshBlockChecksum(block: Uint8Array): void {
	const entries = parseMetadata(block, 0, block.byteLength);
	for (const entry of entries) {
		if (entry.id !== METADATA_BLOCK_CHECKSUM) continue;
		if (entry.large || ![2, 4].includes(entry.dataLength) || entry.start % 2 !== 0) {
			throw invalidStream('The WavPack block checksum metadata is invalid.');
		}
		let checksum = blockChecksum(block, 0, entry.start, entry.dataLength);
		for (let index = 0; index < entry.dataLength; index += 1) {
			block[entry.dataOffset + index] = checksum & 0xff;
			checksum >>>= 8;
		}
	}
}

function blockChecksum(
	input: Uint8Array,
	blockOffset: number,
	checksumOffset: number,
	byteLength: number,
): number {
	let checksum = 0xffff_ffff;
	for (let offset = blockOffset; offset < checksumOffset; offset += 2) {
		checksum = (Math.imul(checksum, 3) + input[offset]! + (input[offset + 1]! << 8)) >>> 0;
	}
	if (byteLength === 2) checksum = (checksum ^ (checksum >>> 16)) & 0xffff;
	return checksum >>> 0;
}

function blockByteLength(input: Uint8Array, view: DataView, offset: number): number {
	if (offset < 0 || offset + WAVPACK_HEADER_BYTES > input.byteLength
		|| ascii(input, offset, 4) !== 'wvpk') {
		throw invalidStream('The WavPack block header is missing or truncated.');
	}
	const byteLength = view.getUint32(offset + 4, true) + 8;
	if (byteLength < WAVPACK_HEADER_BYTES || offset + byteLength > input.byteLength) {
		throw invalidStream('The WavPack block size exceeds its bounded input.');
	}
	return byteLength;
}

function littleEndianInteger(input: Uint8Array, offset: number, byteLength: number): number {
	if (byteLength < 1 || byteLength > 4 || offset < 0 || offset + byteLength > input.byteLength) {
		throw invalidStream('The WavPack integer metadata is invalid.');
	}
	let result = 0;
	for (let index = 0; index < byteLength; index += 1) result += input[offset + index]! * 2 ** (8 * index);
	return result;
}

function concatenate(parts: readonly Uint8Array[], byteLength: number): Uint8Array {
	const output = new Uint8Array(byteLength);
	let offset = 0;
	for (const part of parts) {
		output.set(part, offset);
		offset += part.byteLength;
	}
	return output;
}

function ascii(input: Uint8Array, offset: number, byteLength: number): string {
	let value = '';
	for (let index = 0; index < byteLength; index += 1) value += String.fromCharCode(input[offset + index] ?? 0);
	return value;
}

function count(values: readonly number[], expected: number): number {
	let matches = 0;
	for (const value of values) if (value === expected) matches += 1;
	return matches;
}

function dataView(input: Uint8Array): DataView {
	return new DataView(input.buffer, input.byteOffset, input.byteLength);
}

function invalidStream(message: string): BundledWavPackStreamError {
	return new BundledWavPackStreamError(message);
}
