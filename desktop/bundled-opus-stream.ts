/* SPDX-License-Identifier: AGPL-3.0-only */

/** Strict bounded Ogg Opus profile admitted by the reviewed bundled decoder. */

const CAPTURE = Uint8Array.of(0x4f, 0x67, 0x67, 0x53);
const OPUS_HEAD = Uint8Array.of(0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64);
const OPUS_TAGS = Uint8Array.of(0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73);
const MAXIMUM_INPUT_BYTES = 32 * 1024 * 1024;
const MAXIMUM_PAGE_COUNT = 65_536;
const MAXIMUM_HEADER_PACKET_BYTES = 64 * 1024;
const MAXIMUM_AUDIO_PACKET_BYTES = 1_275;
const MAXIMUM_FRAME_COUNT = 33_554_432;
const MAXIMUM_TAG_COMMENTS = 128;
const MAXIMUM_TAG_COMMENT_BYTES = 4_096;
const MAXIMUM_PRE_SKIP = 5_760;
const OGG_CRC_TABLE = createOggCrcTable();
const NEGATIVE_GRANULE = 0xffff_ffff_ffff_ffffn;

export interface BundledOpusStreamGeometry {
	readonly sampleRate: 48_000;
	readonly channelCount: 1 | 2;
	readonly frameCount: number;
	readonly preSkip: number;
	readonly audioPacketCount: number;
}

export class BundledOpusStreamError extends Error {
	constructor(message = 'The Ogg Opus stream is malformed.') {
		super(message);
		this.name = 'BundledOpusStreamError';
	}
}

export class BundledOpusStreamUnsupportedError extends Error {
	constructor(message = 'The Ogg Opus stream uses a valid but unreviewed profile.') {
		super(message);
		this.name = 'BundledOpusStreamUnsupportedError';
	}
}

export function parseBundledOpusStream(value: unknown): BundledOpusStreamGeometry {
	if (!(value instanceof Uint8Array) || value.byteLength < 64
		|| value.byteLength > MAXIMUM_INPUT_BYTES) fail();
	const bytes = value;
	let offset = 0;
	let pageCount = 0;
	let serial: number | null = null;
	let sequence = 0;
	let partial: Uint8Array = new Uint8Array(0);
	let packetIndex = 0;
	let channelCount = 0;
	let preSkip = 0;
	let audioPacketCount = 0;
	let totalAudioSamples = 0;
	let lastPacketSamples = 0;
	let previousGranule = 0n;
	let initialGranuleOffset = 0n;
	let finalGranule: bigint | null = null;
	let sawEos = false;
	let unsupported: string | null = null;

	while (offset < bytes.byteLength) {
		if (sawEos) {
			if (equalsAt(bytes, offset, CAPTURE)) {
				throw new BundledOpusStreamUnsupportedError(
					'Chained Ogg Opus streams are outside the reviewed profile.',
				);
			}
			fail();
		}
		if (++pageCount > MAXIMUM_PAGE_COUNT || offset + 27 > bytes.byteLength
			|| !equalsAt(bytes, offset, CAPTURE) || readByte(bytes, offset + 4) !== 0) fail();
		const flags = readByte(bytes, offset + 5);
		if ((flags & ~7) !== 0) fail();
		const continued = Boolean(flags & 1);
		const bos = Boolean(flags & 2);
		const eos = Boolean(flags & 4);
		const pageSerial = readU32(bytes, offset + 14);
		if (pageCount === 1 && (!bos || continued || eos)) fail();
		if (pageCount > 1 && bos) {
			if (pageSerial === serial) fail();
			throw new BundledOpusStreamUnsupportedError(
				'Multiplexed Ogg streams are outside the reviewed profile.',
			);
		}
		if (continued !== (partial.byteLength > 0)) fail();
		const pageSequence = readU32(bytes, offset + 18);
		if (serial === null) serial = pageSerial;
		if (pageSerial !== serial || pageSequence !== sequence++) fail();
		const segmentCount = readByte(bytes, offset + 26);
		if (segmentCount === 0 || offset + 27 + segmentCount > bytes.byteLength) fail();
		let bodyBytes = 0;
		for (let index = 0; index < segmentCount; index++) bodyBytes += readByte(bytes, offset + 27 + index);
		const pageEnd = offset + 27 + segmentCount + bodyBytes;
		if (pageEnd > bytes.byteLength || !eos && pageEnd === bytes.byteLength) fail();
		if (readU32(bytes, offset + 22) !== oggPageCrc(bytes.subarray(offset, pageEnd))) fail();
		const granule = readU64(bytes, offset + 6);
		let bodyOffset = offset + 27 + segmentCount;
		const audioPacketsBeforePage = audioPacketCount;
		const audioSamplesBeforePage = totalAudioSamples;
		for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
			const segmentBytes = readByte(bytes, offset + 27 + segmentIndex);
			partial = appendBounded(
				partial, bytes.subarray(bodyOffset, bodyOffset + segmentBytes),
				packetIndex < 2 ? MAXIMUM_HEADER_PACKET_BYTES : MAXIMUM_AUDIO_PACKET_BYTES,
			);
			bodyOffset += segmentBytes;
			if (segmentBytes < 255) {
				if (packetIndex === 0) {
					const head = parseOpusHead(partial);
					channelCount = head.channelCount;
					preSkip = head.preSkip;
					unsupported ??= head.unsupported;
				} else if (packetIndex === 1) unsupported ??= parseOpusTags(partial);
				else {
					const samples = opusPacketSamples(partial);
					if (samples !== 960) unsupported ??= 'Only 20 ms Opus packets are reviewed.';
					totalAudioSamples += samples;
					if (!Number.isSafeInteger(totalAudioSamples)
						|| totalAudioSamples > MAXIMUM_FRAME_COUNT + MAXIMUM_PRE_SKIP + 5_760) fail();
					lastPacketSamples = samples;
					audioPacketCount++;
				}
				packetIndex++;
				partial = new Uint8Array(0);
			}
		}
		if (pageCount === 1 && packetIndex !== 1) fail();
		const resolvedGranuleOffset = validatePageGranule({
			granule, eos, audioPacketsBeforePage, audioPacketCount,
			audioSamplesBeforePage, totalAudioSamples, previousGranule, initialGranuleOffset,
		});
		if (resolvedGranuleOffset > initialGranuleOffset) {
			initialGranuleOffset = resolvedGranuleOffset;
			unsupported ??= 'A non-zero initial Ogg Opus granule offset is outside the reviewed profile.';
		}
		if (audioPacketCount > audioPacketsBeforePage && granule !== NEGATIVE_GRANULE) {
			previousGranule = granule;
		}
		if (eos) { sawEos = true; finalGranule = granule; }
		offset = pageEnd;
	}
	if (!sawEos || partial.byteLength !== 0 || packetIndex < 3 || audioPacketCount === 0
		|| finalGranule === null || finalGranule === NEGATIVE_GRANULE || channelCount === 0) fail();
	const decodedEnd = BigInt(totalAudioSamples);
	const localFinalGranule = finalGranule - initialGranuleOffset;
	if (localFinalGranule > decodedEnd || localFinalGranule <= BigInt(preSkip)
		|| decodedEnd - localFinalGranule >= BigInt(lastPacketSamples)) fail();
	const frameCountBig = localFinalGranule - BigInt(preSkip);
	if (frameCountBig <= 0n || frameCountBig > BigInt(MAXIMUM_FRAME_COUNT)) fail();
	if (unsupported !== null) throw new BundledOpusStreamUnsupportedError(unsupported);
	const reviewedChannelCount = requireReviewedChannelCount(channelCount);
	return Object.freeze({
		sampleRate: 48_000,
		channelCount: reviewedChannelCount,
		frameCount: Number(frameCountBig),
		preSkip,
		audioPacketCount,
	});
}

function parseOpusHead(packet: Uint8Array): Readonly<{
	readonly channelCount: number;
	readonly preSkip: number;
	readonly unsupported: string | null;
}> {
	if (packet.byteLength < 19 || !equalsAt(packet, 0, OPUS_HEAD) || readByte(packet, 8) > 15) fail();
	const version = readByte(packet, 8);
	const channels = readByte(packet, 9);
	const skip = readU16(packet, 10);
	const gain = readI16(packet, 16);
	const mappingFamily = readByte(packet, 18);
	if (channels === 0 || channels > 8 || skip > MAXIMUM_PRE_SKIP) fail();
	let unsupported = version === 1 ? null : 'Only OpusHead version 1 is reviewed.';
	if (mappingFamily === 0) {
		if (packet.byteLength < 19 || version === 1 && packet.byteLength !== 19 || channels > 2) fail();
		if (gain !== 0) unsupported ??= 'Opus output gain is outside the reviewed profile.';
		return Object.freeze({
			channelCount: channels, preSkip: skip, unsupported,
		});
	}
	if (packet.byteLength < 21 + channels || version === 1 && packet.byteLength !== 21 + channels) fail();
	const streams = readByte(packet, 19);
	const coupled = readByte(packet, 20);
	if (streams === 0 || coupled > streams || streams + coupled !== channels) fail();
	for (let channel = 0; channel < channels; channel++) {
		const mapping = readByte(packet, 21 + channel);
		if (mapping !== 255 && mapping >= streams + coupled) fail();
	}
	return Object.freeze({
		channelCount: channels, preSkip: skip,
		unsupported: unsupported ?? 'Only Opus mapping family 0 mono/stereo is reviewed.',
	});
}

function parseOpusTags(packet: Uint8Array): string | null {
	if (packet.byteLength < 16 || !equalsAt(packet, 0, OPUS_TAGS)) fail();
	const vendorBytes = readU32(packet, 8);
	let offset = 12 + vendorBytes;
	if (vendorBytes > MAXIMUM_HEADER_PACKET_BYTES || offset + 4 > packet.byteLength) fail();
	const comments = readU32(packet, offset);
	offset += 4;
	if (comments > MAXIMUM_TAG_COMMENTS) fail();
	for (let index = 0; index < comments; index++) {
		if (offset + 4 > packet.byteLength) fail();
		const length = readU32(packet, offset);
		offset += 4;
		if (length > MAXIMUM_TAG_COMMENT_BYTES || offset + length > packet.byteLength) fail();
		offset += length;
	}
	return offset === packet.byteLength
		? null
		: 'Trailing OpusTags data is outside the reviewed profile.';
}

function opusPacketSamples(packet: Uint8Array): number {
	if (packet.byteLength === 0 || packet.byteLength > MAXIMUM_AUDIO_PACKET_BYTES) fail();
	const toc = readByte(packet, 0);
	const configuration = toc >>> 3;
	let samplesPerFrame: number;
	if (configuration >= 16) samplesPerFrame = 120 << (configuration & 3);
	else if (configuration >= 12) samplesPerFrame = configuration & 1 ? 480 : 960;
	else if ((configuration & 3) === 3) samplesPerFrame = 2_880;
	else samplesPerFrame = 480 << (configuration & 3);
	const code = toc & 3;
	const frames = code === 0 ? 1 : code < 3 ? 2 : packet.byteLength >= 2 ? readByte(packet, 1) & 63 : 0;
	const total = samplesPerFrame * frames;
	if (frames === 0 || total > 5_760) fail();
	return total;
}

function validatePageGranule(options: Readonly<{
	readonly granule: bigint;
	readonly eos: boolean;
	readonly audioPacketsBeforePage: number;
	readonly audioPacketCount: number;
	readonly audioSamplesBeforePage: number;
	readonly totalAudioSamples: number;
	readonly previousGranule: bigint;
	readonly initialGranuleOffset: bigint;
}>): bigint {
	const completed = options.audioPacketCount > options.audioPacketsBeforePage;
	if (!completed) {
		if (options.audioPacketCount === 0 ? options.granule !== 0n : options.granule !== NEGATIVE_GRANULE) fail();
		return options.initialGranuleOffset;
	}
	if (options.granule === NEGATIVE_GRANULE) fail();
	const localSamples = BigInt(options.totalAudioSamples - options.audioSamplesBeforePage);
	if (options.audioPacketsBeforePage === 0) {
		const decodedSamples = BigInt(options.totalAudioSamples);
		if (!options.eos && options.granule < decodedSamples) fail();
		return options.granule > decodedSamples ? options.granule - decodedSamples : 0n;
	}
	const expectedGranule = options.previousGranule + localSamples;
	if (options.granule < options.previousGranule || options.granule > expectedGranule) fail();
	if (!options.eos && options.granule !== expectedGranule) fail();
	return options.initialGranuleOffset;
}

function appendBounded(left: Uint8Array, right: Uint8Array, maximum: number): Uint8Array {
	if (left.byteLength + right.byteLength > maximum) fail();
	const result = new Uint8Array(left.byteLength + right.byteLength);
	result.set(left);
	result.set(right, left.byteLength);
	return result;
}

function oggPageCrc(page: Uint8Array): number {
	let crc = 0;
	for (const [index, sourceByte] of page.entries()) {
		const byte = index >= 22 && index < 26 ? 0 : sourceByte;
		const tableValue = OGG_CRC_TABLE[((crc >>> 24) ^ byte) & 255];
		if (tableValue === undefined) fail();
		crc = ((crc << 8) ^ tableValue) >>> 0;
	}
	return crc;
}

function createOggCrcTable(): Uint32Array {
	const table = new Uint32Array(256);
	for (let index = 0; index < table.length; index++) {
		let value = index << 24;
		for (let bit = 0; bit < 8; bit++) {
			value = value & 0x8000_0000 ? (value << 1) ^ 0x04c1_1db7 : value << 1;
		}
		table[index] = value >>> 0;
	}
	return table;
}

function equalsAt(bytes: Uint8Array, offset: number, expected: Uint8Array): boolean {
	if (offset + expected.byteLength > bytes.byteLength) return false;
	return expected.every((byte, index) => bytes[offset + index] === byte);
}

function readByte(bytes: Uint8Array, offset: number): number {
	const value = bytes[offset];
	if (value === undefined) fail();
	return value;
}

function requireReviewedChannelCount(value: number): 1 | 2 {
	if (value !== 1 && value !== 2) fail();
	return value;
}

function readU16(bytes: Uint8Array, offset: number): number {
	return readByte(bytes, offset) | readByte(bytes, offset + 1) << 8;
}

function readI16(bytes: Uint8Array, offset: number): number {
	const value = readU16(bytes, offset);
	return value & 0x8000 ? value - 0x1_0000 : value;
}

function readU32(bytes: Uint8Array, offset: number): number {
	return (readByte(bytes, offset) | readByte(bytes, offset + 1) << 8
		| readByte(bytes, offset + 2) << 16 | readByte(bytes, offset + 3) << 24) >>> 0;
}

function readU64(bytes: Uint8Array, offset: number): bigint {
	return BigInt(readU32(bytes, offset)) | BigInt(readU32(bytes, offset + 4)) << 32n;
}

function fail(): never { throw new BundledOpusStreamError(); }
