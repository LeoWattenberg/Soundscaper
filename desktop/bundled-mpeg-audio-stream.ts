/* SPDX-License-Identifier: AGPL-3.0-only */

/** Strict, bounded raw MPEG-audio profile admitted by the reviewed mpg123 decoder. */

const MAXIMUM_INPUT_BYTES = 32 * 1024 * 1024;
const MAXIMUM_DECODED_FRAMES = 33_554_432;
const MAXIMUM_MPEG_FRAMES = Math.floor(MAXIMUM_DECODED_FRAMES / 576);
const ID3 = Uint8Array.of(0x49, 0x44, 0x33);
const TAG = Uint8Array.of(0x54, 0x41, 0x47);
const XING = Uint8Array.of(0x58, 0x69, 0x6e, 0x67);
const INFO = Uint8Array.of(0x49, 0x6e, 0x66, 0x6f);
const VBRI = Uint8Array.of(0x56, 0x42, 0x52, 0x49);
const MPEG1_LAYER2_BITRATES = Object.freeze([
	0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384,
]);
const MPEG1_LAYER3_BITRATES = Object.freeze([
	0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
]);
const MPEG2_BITRATES = Object.freeze([
	0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160,
]);
const BASE_SAMPLE_RATES = Object.freeze([44_100, 48_000, 32_000]);

export type BundledMpegAudioFormat = 'mp3' | 'mp2';

export interface BundledMpegAudioStreamGeometry {
	readonly format: BundledMpegAudioFormat;
	readonly layer: 2 | 3;
	readonly mpegVersion: 1 | 2 | 2.5;
	readonly sampleRate: number;
	readonly channelCount: 1 | 2;
	readonly frameCount: number;
	readonly mpegFrameCount: number;
	readonly samplesPerFrame: 576 | 1_152;
	/** Exact only when every MPEG frame carries the same indexed bitrate. */
	readonly bitrateKbps: number | null;
	readonly encoderDelay: number;
	readonly endPadding: number;
	readonly gapless: 'none' | 'lame';
}

export class BundledMpegAudioStreamError extends Error {
	constructor(message = 'The MPEG audio stream is malformed.') {
		super(message);
		this.name = 'BundledMpegAudioStreamError';
	}
}

export class BundledMpegAudioStreamUnsupportedError extends Error {
	constructor(message = 'The MPEG audio stream uses a valid but unreviewed profile.') {
		super(message);
		this.name = 'BundledMpegAudioStreamUnsupportedError';
	}
}

interface MpegHeader {
	readonly format: BundledMpegAudioFormat;
	readonly layer: 2 | 3;
	readonly mpegVersion: 1 | 2 | 2.5;
	readonly sampleRate: number;
	readonly channelCount: 1 | 2;
	readonly samplesPerFrame: 576 | 1_152;
	readonly frameBytes: number;
	readonly crcProtected: boolean;
	readonly bitrateKbps: number;
}

interface XingGapless {
	readonly declaredFrames: number;
	readonly declaredBytes: number | null;
	readonly encoderDelay: number;
	readonly endPadding: number;
	readonly unsupported: string | null;
}

export function parseBundledMpegAudioStream(
	value: unknown,
	expectedFormat: BundledMpegAudioFormat,
): BundledMpegAudioStreamGeometry {
	if (expectedFormat !== 'mp3' && expectedFormat !== 'mp2') {
		throw new TypeError('The expected MPEG audio format is invalid.');
	}
	if (!(value instanceof Uint8Array) || value.byteLength < 4
		|| value.byteLength > MAXIMUM_INPUT_BYTES) fail();
	const bytes = value;
	let start = 0;
	let end = bytes.byteLength;
	let unsupported: string | null = null;
	if (equalsAt(bytes, 0, ID3)) {
		start = id3v2End(bytes);
		unsupported = 'ID3v2 tags are outside the reviewed raw MPEG-audio profile.';
	}
	if (end - start >= 128 && equalsAt(bytes, end - 128, TAG)) {
		end -= 128;
		unsupported ??= 'ID3v1 tags are outside the reviewed raw MPEG-audio profile.';
	}
	if (end - start < 4) fail();
	let offset = start;
	let first: MpegHeader | null = null;
	let mpegFrameCount = 0;
	let decodedFrames = 0;
	let gapless: XingGapless | null = null;
	const bitrates = new Set<number>();
	while (offset < end) {
		if (++mpegFrameCount > MAXIMUM_MPEG_FRAMES || offset + 4 > end) fail();
		const header = parseHeader(bytes, offset);
		if (header.format !== expectedFormat) {
			if (first === null) fail();
			unsupported ??= 'Concatenated MPEG audio layers are outside the reviewed profile.';
		}
		if (first === null) first = header;
		else if (header.mpegVersion !== first.mpegVersion || header.layer !== first.layer
			|| header.sampleRate !== first.sampleRate || header.channelCount !== first.channelCount) {
			unsupported ??= 'Chained MPEG audio geometry is outside the reviewed profile.';
		}
		if (header.mpegVersion !== 1) {
			unsupported ??= 'Only MPEG-1 Layer II and Layer III streams are reviewed.';
		}
		if (header.crcProtected) {
			unsupported ??= 'CRC-protected MPEG audio frames are outside the reviewed profile.';
		}
		if (header.bitrateKbps === 0) {
			throw new BundledMpegAudioStreamUnsupportedError(
				'Free-format MPEG audio requires an unreviewed frame-size search.',
			);
		}
		bitrates.add(header.bitrateKbps);
		const frameEnd = offset + header.frameBytes;
		if (!Number.isSafeInteger(frameEnd) || header.frameBytes < 8 || frameEnd > end) fail();
		if (mpegFrameCount === 1 && header.layer === 3) {
			const inspected = inspectXing(bytes.subarray(offset, frameEnd), header);
			if (inspected !== null) {
				gapless = inspected;
				unsupported ??= inspected.unsupported;
			}
			const vbriOffset = 4 + 32;
			if (vbriOffset + VBRI.byteLength <= header.frameBytes
				&& equalsAt(bytes, offset + vbriOffset, VBRI)) {
				unsupported ??= 'VBRI metadata is outside the reviewed gapless profile.';
			}
		}
		decodedFrames += header.samplesPerFrame;
		if (!Number.isSafeInteger(decodedFrames) || decodedFrames > MAXIMUM_DECODED_FRAMES) fail();
		offset = frameEnd;
	}
	if (offset !== end || first === null || mpegFrameCount === 0) fail();
	let encoderDelay = 0;
	let endPadding = 0;
	let frameCount = decodedFrames;
	let gaplessKind: BundledMpegAudioStreamGeometry['gapless'] = 'none';
	if (gapless !== null) {
		/* Xing/LAME counts audio frames after its dedicated first metadata frame. */
		if (gapless.declaredFrames !== mpegFrameCount - 1) fail();
		if (gapless.declaredBytes !== null && gapless.declaredBytes !== end - start) fail();
		encoderDelay = gapless.encoderDelay;
		endPadding = gapless.endPadding;
		frameCount = gapless.declaredFrames * first.samplesPerFrame - encoderDelay - endPadding;
		if (!Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount > MAXIMUM_DECODED_FRAMES) fail();
		gaplessKind = 'lame';
	}
	if (unsupported !== null) throw new BundledMpegAudioStreamUnsupportedError(unsupported);
	return Object.freeze({
		format: first.format, layer: first.layer, mpegVersion: first.mpegVersion,
		sampleRate: first.sampleRate, channelCount: first.channelCount, frameCount,
		mpegFrameCount, samplesPerFrame: first.samplesPerFrame,
		bitrateKbps: bitrates.size === 1 ? first.bitrateKbps : null,
		encoderDelay, endPadding, gapless: gaplessKind,
	});
}

function parseHeader(bytes: Uint8Array, offset: number): MpegHeader {
	const word = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
	if ((word >>> 21) !== 0x7ff) fail();
	const versionBits = word >>> 19 & 3;
	const layerBits = word >>> 17 & 3;
	const bitrateIndex = word >>> 12 & 15;
	const sampleRateIndex = word >>> 10 & 3;
	const emphasis = word & 3;
	if (versionBits === 1 || layerBits === 0 || bitrateIndex === 15
		|| sampleRateIndex === 3 || emphasis === 2) fail();
	const mpegVersion = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
	const layer = 4 - layerBits;
	if (layer !== 2 && layer !== 3) {
		throw new BundledMpegAudioStreamUnsupportedError('MPEG Audio Layer I is outside the reviewed profile.');
	}
	const format = layer === 3 ? 'mp3' : 'mp2';
	const divisor = mpegVersion === 1 ? 1 : mpegVersion === 2 ? 2 : 4;
	const sampleRate = BASE_SAMPLE_RATES[sampleRateIndex]! / divisor;
	const bitrates = mpegVersion === 1
		? layer === 2 ? MPEG1_LAYER2_BITRATES : MPEG1_LAYER3_BITRATES
		: MPEG2_BITRATES;
	const bitrateKbps = bitrates[bitrateIndex]!;
	const padding = word >>> 9 & 1;
	const coefficient = mpegVersion === 1 || layer === 2 ? 144 : 72;
	const frameBytes = bitrateKbps === 0 ? 0
		: Math.floor(coefficient * bitrateKbps * 1_000 / sampleRate) + padding;
	return Object.freeze({
		format, layer, mpegVersion, sampleRate,
		channelCount: (word >>> 6 & 3) === 3 ? 1 : 2,
		samplesPerFrame: layer === 3 && mpegVersion !== 1 ? 576 : 1_152,
		frameBytes, crcProtected: (word >>> 16 & 1) === 0, bitrateKbps,
	});
}

function inspectXing(frame: Uint8Array, header: MpegHeader): XingGapless | null {
	const markerOffset = 4 + (header.mpegVersion === 1
		? header.channelCount === 1 ? 17 : 32
		: header.channelCount === 1 ? 9 : 17);
	if (markerOffset + 8 > frame.byteLength
		|| !equalsAt(frame, markerOffset, XING) && !equalsAt(frame, markerOffset, INFO)) return null;
	const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
	const flags = view.getUint32(markerOffset + 4, false);
	let cursor = markerOffset + 8;
	let unsupported = flags & ~15 ? 'Unknown Xing flags are outside the reviewed profile.' : null;
	let declaredFrames: number | null = null;
	let declaredBytes: number | null = null;
	if (flags & 1) { if (cursor + 4 > frame.byteLength) return incompleteXing(); declaredFrames = view.getUint32(cursor, false); cursor += 4; }
	if (flags & 2) { if (cursor + 4 > frame.byteLength) return incompleteXing(); declaredBytes = view.getUint32(cursor, false); cursor += 4; }
	if (flags & 4) { if (cursor + 100 > frame.byteLength) return incompleteXing(); cursor += 100; }
	if (flags & 8) { if (cursor + 4 > frame.byteLength) return incompleteXing(); cursor += 4; }
	if (declaredFrames === null || declaredFrames < 1) return incompleteXing();
	if (cursor + 24 > frame.byteLength) return incompleteXing(declaredFrames, declaredBytes);
	if (!equalsAsciiAt(frame, cursor, 'LAME')) unsupported ??= 'Only LAME gapless metadata is reviewed.';
	const encoderDelay = frame[cursor + 21]! << 4 | frame[cursor + 22]! >>> 4;
	const endPadding = (frame[cursor + 22]! & 15) << 8 | frame[cursor + 23]!;
	return Object.freeze({ declaredFrames, declaredBytes, encoderDelay, endPadding, unsupported });
}

function incompleteXing(declaredFrames = 1, declaredBytes: number | null = null): XingGapless {
	return Object.freeze({
		declaredFrames, declaredBytes, encoderDelay: 0, endPadding: 0,
		unsupported: 'Incomplete Xing/LAME metadata is outside the reviewed gapless profile.',
	});
}

function id3v2End(bytes: Uint8Array): number {
	if (bytes.byteLength < 10) fail();
	const version = bytes[3]!;
	const revision = bytes[4]!;
	const flags = bytes[5]!;
	if (version < 2 || version > 4 || revision === 0xff
		|| version === 2 && (flags & ~0xc0) !== 0
		|| version === 3 && (flags & ~0xe0) !== 0
		|| version === 4 && (flags & ~0xf0) !== 0) fail();
	let size = 0;
	for (let index = 6; index < 10; index++) {
		if (bytes[index]! & 0x80) fail();
		size = size << 7 | bytes[index]!;
	}
	const footerBytes = version === 4 && (flags & 0x10) !== 0 ? 10 : 0;
	const end = 10 + size + footerBytes;
	if (!Number.isSafeInteger(end) || end > bytes.byteLength) fail();
	return end;
}

function equalsAt(bytes: Uint8Array, offset: number, expected: Uint8Array): boolean {
	if (offset < 0 || offset + expected.byteLength > bytes.byteLength) return false;
	for (let index = 0; index < expected.byteLength; index++) {
		if (bytes[offset + index] !== expected[index]) return false;
	}
	return true;
}

function equalsAsciiAt(bytes: Uint8Array, offset: number, expected: string): boolean {
	for (let index = 0; index < expected.length; index++) {
		if (bytes[offset + index] !== expected.charCodeAt(index)) return false;
	}
	return true;
}

function fail(): never { throw new BundledMpegAudioStreamError(); }
