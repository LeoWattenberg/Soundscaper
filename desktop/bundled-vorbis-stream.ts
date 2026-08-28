/* SPDX-License-Identifier: AGPL-3.0-only */

/** Strict bounded Ogg/Vorbis validation for the reviewed bundled decoder profile. */

const CAPTURE = Uint8Array.of(0x4f, 0x67, 0x67, 0x53);
const VORBIS = Uint8Array.of(0x76, 0x6f, 0x72, 0x62, 0x69, 0x73);
const MAXIMUM_INPUT_BYTES = 32 * 1024 * 1024;
const MAXIMUM_PAGE_COUNT = 65_536;
const MAXIMUM_COMMENT_PACKET_BYTES = 1024 * 1024;
const MAXIMUM_SETUP_PACKET_BYTES = 2 * 1024 * 1024;
const MAXIMUM_AUDIO_PACKET_BYTES = 64 * 1024;
const MAXIMUM_FRAME_COUNT = 33_554_432;
const MAXIMUM_TAG_COMMENTS = 128;
const MAXIMUM_TAG_STRING_BYTES = 4_096;
const MAXIMUM_VENDOR_BYTES = 64 * 1024;
const OGG_CRC_TABLE = createOggCrcTable();
const NEGATIVE_GRANULE = 0xffff_ffff_ffff_ffffn;
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export interface BundledVorbisStreamGeometry {
	readonly sampleRate: number;
	readonly channelCount: 1 | 2;
	readonly frameCount: number;
	readonly audioPacketCount: number;
}

export class BundledVorbisStreamError extends Error {
	constructor(message = 'The Ogg Vorbis stream is malformed.') {
		super(message);
		this.name = 'BundledVorbisStreamError';
	}
}

export class BundledVorbisStreamUnsupportedError extends Error {
	constructor(message = 'The Ogg Vorbis stream uses a valid but unreviewed profile.') {
		super(message);
		this.name = 'BundledVorbisStreamUnsupportedError';
	}
}

interface PacketAccumulator {
	readonly segments: Uint8Array[];
	byteLength: number;
}

export function parseBundledVorbisStream(value: unknown): BundledVorbisStreamGeometry {
	if (!(value instanceof Uint8Array) || value.byteLength < 96
		|| value.byteLength > MAXIMUM_INPUT_BYTES) fail();
	const bytes = value;
	let offset = 0;
	let pageCount = 0;
	let serial: number | null = null;
	let sequence = 0;
	let partial = emptyPacket();
	let packetIndex = 0;
	let sampleRate = 0;
	let channelCount = 0;
	let audioPacketCount = 0;
	let previousGranule = 0n;
	let finalGranule: bigint | null = null;
	let sawEos = false;
	let unsupported: string | null = null;

	while (offset < bytes.byteLength) {
		if (sawEos) {
			if (equalsAt(bytes, offset, CAPTURE)) {
				throw new BundledVorbisStreamUnsupportedError('Chained Ogg Vorbis streams are outside the reviewed profile.');
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
			throw new BundledVorbisStreamUnsupportedError('Multiplexed Ogg streams are outside the reviewed profile.');
		}
		if (continued !== (partial.byteLength > 0)) fail();
		const pageSequence = readU32(bytes, offset + 18);
		if (serial === null) serial = pageSerial;
		if (pageSerial !== serial) fail();
		if (pageSequence !== sequence++) fail();
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
		for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
			const segmentBytes = readByte(bytes, offset + 27 + segmentIndex);
			appendBounded(
				partial, bytes.subarray(bodyOffset, bodyOffset + segmentBytes),
				packetLimit(packetIndex), packetIndex,
			);
			bodyOffset += segmentBytes;
			if (segmentBytes < 255) {
				const packet = materializePacket(partial);
				if (packetIndex === 0) {
					const identification = parseIdentification(packet);
					sampleRate = identification.sampleRate;
					channelCount = identification.channelCount;
					unsupported ??= identification.unsupported;
				} else if (packetIndex === 1) unsupported ??= parseComments(packet);
				else if (packetIndex === 2) parseSetup(packet);
				else {
					if (packet.byteLength === 0 || (readByte(packet, 0) & 1) !== 0) fail();
					audioPacketCount++;
				}
				packetIndex++;
				partial = emptyPacket();
			}
		}
		if (pageCount === 1 && packetIndex !== 1) fail();
		validateGranule(granule, audioPacketsBeforePage, audioPacketCount, previousGranule);
		if (audioPacketCount > audioPacketsBeforePage && granule !== NEGATIVE_GRANULE) {
			previousGranule = granule;
			if (granule > BigInt(MAXIMUM_FRAME_COUNT)) {
				unsupported ??= 'The Ogg Vorbis duration exceeds the reviewed frame bound.';
			}
		}
		if (eos) { sawEos = true; finalGranule = granule; }
		offset = pageEnd;
	}
	if (!sawEos || partial.byteLength !== 0 || packetIndex < 4 || audioPacketCount === 0
		|| finalGranule === null || finalGranule === NEGATIVE_GRANULE
		|| finalGranule <= 0n || sampleRate === 0 || channelCount === 0) fail();
	if (finalGranule > BigInt(MAXIMUM_FRAME_COUNT)) {
		unsupported ??= 'The Ogg Vorbis duration exceeds the reviewed frame bound.';
	}
	if (unsupported !== null) throw new BundledVorbisStreamUnsupportedError(unsupported);
	const reviewedChannelCount = requireReviewedChannelCount(channelCount);
	return Object.freeze({
		sampleRate, channelCount: reviewedChannelCount,
		frameCount: Number(finalGranule), audioPacketCount,
	});
}

function parseIdentification(packet: Uint8Array): Readonly<{
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly unsupported: string | null;
}> {
	if (packet.byteLength !== 30 || readByte(packet, 0) !== 1 || !equalsAt(packet, 1, VORBIS)
		|| readU32(packet, 7) !== 0 || readByte(packet, 29) !== 1) fail();
	const channels = readByte(packet, 11);
	const rate = readU32(packet, 12);
	const blockSizes = readByte(packet, 28);
	const smallBlockExponent = blockSizes & 15;
	const largeBlockExponent = blockSizes >>> 4;
	if (channels === 0 || rate === 0 || smallBlockExponent < 6 || largeBlockExponent < smallBlockExponent
		|| largeBlockExponent > 13) fail();
	const unsupported = channels > 2
		? 'Only mono and stereo Vorbis streams are reviewed.'
		: rate < 8_000 || rate > 192_000
			? 'The Vorbis sample rate is outside the reviewed 8–192 kHz profile.'
			: null;
	return Object.freeze({ sampleRate: rate, channelCount: channels, unsupported });
}

function parseComments(packet: Uint8Array): string | null {
	if (packet.byteLength < 16 || readByte(packet, 0) !== 3 || !equalsAt(packet, 1, VORBIS)) fail();
	const vendorBytes = readU32(packet, 7);
	let offset = 11 + vendorBytes;
	if (offset + 4 > packet.byteLength) fail();
	validateUtf8(packet.subarray(11, offset));
	let unsupported = vendorBytes > MAXIMUM_VENDOR_BYTES
		? 'The Vorbis vendor string exceeds the reviewed bound.' : null;
	const comments = readU32(packet, offset);
	offset += 4;
	if (comments > MAXIMUM_TAG_COMMENTS) unsupported ??= 'The Vorbis comment count exceeds the reviewed bound.';
	for (let index = 0; index < comments; index++) {
		if (offset + 4 > packet.byteLength) fail();
		const length = readU32(packet, offset);
		offset += 4;
		if (offset + length > packet.byteLength) fail();
		validateUtf8(packet.subarray(offset, offset + length));
		if (length > MAXIMUM_TAG_STRING_BYTES) unsupported ??= 'A Vorbis comment exceeds the reviewed bound.';
		offset += length;
	}
	if (offset + 1 !== packet.byteLength || readByte(packet, offset) !== 1) fail();
	return unsupported;
}

function parseSetup(packet: Uint8Array): void {
	if (packet.byteLength < 8 || readByte(packet, 0) !== 5 || !equalsAt(packet, 1, VORBIS)) fail();
}

function validateGranule(
	granule: bigint,
	audioPacketsBeforePage: number,
	audioPacketCount: number,
	previousGranule: bigint,
): void {
	const completedAudio = audioPacketCount > audioPacketsBeforePage;
	if (!completedAudio) {
		if (audioPacketCount === 0 ? granule !== 0n : granule !== NEGATIVE_GRANULE) fail();
		return;
	}
	if (granule === NEGATIVE_GRANULE || granule < previousGranule) fail();
}

function packetLimit(packetIndex: number): number {
	if (packetIndex === 0) return 30;
	if (packetIndex === 1) return MAXIMUM_COMMENT_PACKET_BYTES;
	if (packetIndex === 2) return MAXIMUM_SETUP_PACKET_BYTES;
	return MAXIMUM_AUDIO_PACKET_BYTES;
}

function appendBounded(
	packet: PacketAccumulator,
	segment: Uint8Array,
	maximum: number,
	packetIndex: number,
): void {
	const byteLength = packet.byteLength + segment.byteLength;
	if (!Number.isSafeInteger(byteLength) || byteLength > maximum) {
		if (packetIndex === 0) fail();
		throw new BundledVorbisStreamUnsupportedError('An Ogg Vorbis packet exceeds the reviewed bound.');
	}
	if (segment.byteLength > 0) packet.segments.push(segment);
	packet.byteLength = byteLength;
}

function emptyPacket(): PacketAccumulator {
	return { segments: [], byteLength: 0 };
}

function materializePacket(packet: PacketAccumulator): Uint8Array {
	const output = new Uint8Array(packet.byteLength);
	let offset = 0;
	for (const segment of packet.segments) {
		output.set(segment, offset);
		offset += segment.byteLength;
	}
	if (offset !== packet.byteLength) fail();
	return output;
}

function validateUtf8(value: Uint8Array): void {
	try { UTF8.decode(value); }
	catch { fail(); }
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

function readU32(bytes: Uint8Array, offset: number): number {
	return (readByte(bytes, offset) | readByte(bytes, offset + 1) << 8
		| readByte(bytes, offset + 2) << 16 | readByte(bytes, offset + 3) << 24) >>> 0;
}

function readU64(bytes: Uint8Array, offset: number): bigint {
	return BigInt(readU32(bytes, offset)) | BigInt(readU32(bytes, offset + 4)) << 32n;
}

function fail(): never { throw new BundledVorbisStreamError(); }
