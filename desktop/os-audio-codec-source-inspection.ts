/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded source-side geometry/profile inspection before an exact OS tuple is selected. */

export type OperatingSystemAudioSourceFormat = 'mp3' | 'aac-m4a';

export interface OperatingSystemAudioSourceGeometry {
	readonly sampleRate: number;
	readonly channelCount: number;
}

interface Mp3FrameHeader extends OperatingSystemAudioSourceGeometry {
	readonly frameBytes: number;
}

interface IsoBox {
	readonly type: number;
	readonly payload: number;
	readonly end: number;
}

interface Descriptor {
	readonly tag: number;
	readonly payload: number;
	readonly end: number;
}

interface TrackInspection {
	readonly valid: boolean;
	readonly audio: boolean;
	readonly geometry: OperatingSystemAudioSourceGeometry | null;
}

const MAXIMUM_INPUT_BYTES = 32 * 1024 * 1024;
const MP3_MPEG1_LAYER3_BITRATES_KBPS = Object.freeze([
	0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
]);
const MP3_MPEG1_SAMPLE_RATES = Object.freeze([44_100, 48_000, 32_000]);
const AAC_SAMPLE_RATES = Object.freeze([
	96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000,
	22_050, 16_000, 12_000, 11_025, 8_000, 7_350,
]);

const FTYP = fourCc('ftyp');
const MOOV = fourCc('moov');
const TRAK = fourCc('trak');
const MDIA = fourCc('mdia');
const HDLR = fourCc('hdlr');
const MINF = fourCc('minf');
const STBL = fourCc('stbl');
const STSD = fourCc('stsd');
const MP4A = fourCc('mp4a');
const ESDS = fourCc('esds');
const SOUN = fourCc('soun');
const M4A_BRAND = fourCc('M4A ');

export function inspectOperatingSystemAudioSource(
	format: OperatingSystemAudioSourceFormat,
	input: Uint8Array,
): OperatingSystemAudioSourceGeometry | null {
	if (!(input instanceof Uint8Array) || input.byteLength < 1
		|| input.byteLength > MAXIMUM_INPUT_BYTES) return null;
	if (format === 'mp3') return inspectMp3SourceGeometry(input);
	if (format === 'aac-m4a') return inspectAacLcM4a(input);
	throw new TypeError('The OS audio source inspection format is unsupported.');
}

function inspectMp3SourceGeometry(input: Uint8Array): OperatingSystemAudioSourceGeometry | null {
	let offset = 0;
	if (input.byteLength >= 3 && input[0] === 0x49 && input[1] === 0x44 && input[2] === 0x33) {
		if (input.byteLength < 10 || input[6]! >= 0x80 || input[7]! >= 0x80
			|| input[8]! >= 0x80 || input[9]! >= 0x80) return null;
		const tagBytes = input[6]! << 21 | input[7]! << 14 | input[8]! << 7 | input[9]!;
		const footerBytes = (input[5]! & 0x10) === 0 ? 0 : 10;
		offset = 10 + tagBytes + footerBytes;
		if (!Number.isSafeInteger(offset) || offset > input.byteLength) return null;
	}
	let geometry: OperatingSystemAudioSourceGeometry | null = null;
	let frameCount = 0;
	while (offset + 4 <= input.byteLength) {
		const frame = mp3FrameHeader(input, offset);
		if (frame === null) break;
		if (geometry !== null && (frame.sampleRate !== geometry.sampleRate
			|| frame.channelCount !== geometry.channelCount)) return null;
		geometry ??= Object.freeze({
			sampleRate: frame.sampleRate, channelCount: frame.channelCount,
		});
		frameCount += 1;
		offset += frame.frameBytes;
	}
	if (geometry === null || frameCount < 2) return null;
	const id3v1 = input.byteLength - offset === 128
		&& input[offset] === 0x54 && input[offset + 1] === 0x41 && input[offset + 2] === 0x47;
	return offset === input.byteLength || id3v1 ? geometry : null;
}

function mp3FrameHeader(input: Uint8Array, offset: number): Mp3FrameHeader | null {
	if (!Number.isSafeInteger(offset) || offset < 0 || offset + 4 > input.byteLength) return null;
	const header = view(input).getUint32(offset, false);
	const version = header >>> 19 & 0x03;
	const layer = header >>> 17 & 0x03;
	const bitrateIndex = header >>> 12 & 0x0f;
	const sampleRateIndex = header >>> 10 & 0x03;
	if (header >>> 21 !== 0x7ff || version !== 3 || layer !== 1
		|| bitrateIndex === 0 || bitrateIndex === 0x0f || sampleRateIndex === 3) return null;
	const bitrateKbps = MP3_MPEG1_LAYER3_BITRATES_KBPS[bitrateIndex];
	const sampleRate = MP3_MPEG1_SAMPLE_RATES[sampleRateIndex];
	if (bitrateKbps === undefined || bitrateKbps === 0 || sampleRate === undefined) return null;
	const padding = header >>> 9 & 0x01;
	const frameBytes = Math.floor(144_000 * bitrateKbps / sampleRate) + padding;
	if (frameBytes < 4 || offset + frameBytes > input.byteLength) return null;
	return Object.freeze({
		sampleRate,
		channelCount: (header >>> 6 & 0x03) === 3 ? 1 : 2,
		frameBytes,
	});
}

function inspectAacLcM4a(input: Uint8Array): OperatingSystemAudioSourceGeometry | null {
	if (input.byteLength < 16) return null;
	let foundFileType = false;
	let foundMovie = false;
	let audioTracks = 0;
	let geometry: OperatingSystemAudioSourceGeometry | null = null;
	const valid = visitBoxes(input, 0, input.byteLength, (box) => {
		if (box.type === FTYP) {
			if (foundFileType || !exactM4aFileType(input, box)) return false;
			foundFileType = true;
		} else if (box.type === MOOV) {
			if (foundMovie) return false;
			foundMovie = true;
			if (!visitBoxes(input, box.payload, box.end, (child) => {
				if (child.type !== TRAK) return true;
				const track = inspectTrack(input, child);
				if (!track.valid) return false;
				if (track.audio) {
					audioTracks += 1;
					geometry = track.geometry;
				}
				return true;
			})) return false;
		}
		return true;
	});
	return valid && foundFileType && foundMovie && audioTracks === 1 ? geometry : null;
}

function inspectTrack(input: Uint8Array, track: IsoBox): TrackInspection {
	let foundMedia = false;
	let result: TrackInspection = Object.freeze({ valid: false, audio: false, geometry: null });
	const valid = visitBoxes(input, track.payload, track.end, (box) => {
		if (box.type !== MDIA) return true;
		if (foundMedia) return false;
		foundMedia = true;
		result = inspectMedia(input, box);
		return result.valid;
	});
	return valid && foundMedia ? result : Object.freeze({ valid: false, audio: false, geometry: null });
}

function inspectMedia(input: Uint8Array, media: IsoBox): TrackInspection {
	let foundHandler = false;
	let foundInformation = false;
	let audio = false;
	let information: IsoBox | null = null;
	const valid = visitBoxes(input, media.payload, media.end, (box) => {
		if (box.type === HDLR) {
			if (foundHandler || box.end - box.payload < 12 || unsigned32(input, box.payload) !== 0) return false;
			foundHandler = true;
			audio = unsigned32(input, box.payload + 8) === SOUN;
		} else if (box.type === MINF) {
			if (foundInformation) return false;
			foundInformation = true;
			information = box;
		}
		return true;
	});
	if (!valid || !foundHandler || !foundInformation || information === null) {
		return Object.freeze({ valid: false, audio: false, geometry: null });
	}
	return Object.freeze({
		valid: true, audio,
		geometry: audio ? inspectMediaInformation(input, information) : null,
	});
}

function inspectMediaInformation(
	input: Uint8Array,
	information: IsoBox,
): OperatingSystemAudioSourceGeometry | null {
	let foundTable = false;
	let geometry: OperatingSystemAudioSourceGeometry | null = null;
	const valid = visitBoxes(input, information.payload, information.end, (box) => {
		if (box.type !== STBL) return true;
		if (foundTable) return false;
		foundTable = true;
		geometry = inspectSampleTable(input, box);
		return true;
	});
	return valid && foundTable ? geometry : null;
}

function inspectSampleTable(
	input: Uint8Array,
	table: IsoBox,
): OperatingSystemAudioSourceGeometry | null {
	let foundDescription = false;
	let geometry: OperatingSystemAudioSourceGeometry | null = null;
	const valid = visitBoxes(input, table.payload, table.end, (box) => {
		if (box.type !== STSD) return true;
		if (foundDescription) return false;
		foundDescription = true;
		geometry = inspectSampleDescription(input, box);
		return true;
	});
	return valid && foundDescription ? geometry : null;
}

function inspectSampleDescription(
	input: Uint8Array,
	description: IsoBox,
): OperatingSystemAudioSourceGeometry | null {
	if (description.end - description.payload < 8
		|| unsigned32(input, description.payload) !== 0
		|| unsigned32(input, description.payload + 4) !== 1) return null;
	const entry = description.payload + 8;
	if (description.end - entry < 36) return null;
	const entryBytes = unsigned32(input, entry);
	if (entryBytes < 36 || entryBytes !== description.end - entry
		|| unsigned32(input, entry + 4) !== MP4A
		|| unsigned16(input, entry + 14) !== 1
		|| unsigned16(input, entry + 16) !== 0) return null;
	const channelCount = unsigned16(input, entry + 24);
	const rateFixed = unsigned32(input, entry + 32);
	if (channelCount < 1 || channelCount > 6 || rateFixed % 65_536 !== 0) return null;
	const sampleRate = rateFixed / 65_536;
	if (!Number.isSafeInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 48_000) return null;
	let foundEsds = false;
	const valid = visitBoxes(input, entry + 36, entry + entryBytes, (box) => {
		if (box.type !== ESDS) return true;
		if (foundEsds || !exactEsds(input, box, sampleRate, channelCount)) return false;
		foundEsds = true;
		return true;
	});
	return valid && foundEsds ? Object.freeze({ sampleRate, channelCount }) : null;
}

function exactEsds(
	input: Uint8Array,
	box: IsoBox,
	sampleRate: number,
	channelCount: number,
): boolean {
	if (box.end - box.payload < 4 || unsigned32(input, box.payload) !== 0) return false;
	const es = inspectDescriptor(input, box.payload + 4, box.end);
	if (es === null || es.tag !== 0x03 || es.end !== box.end || es.end - es.payload < 3) return false;
	let offset = es.payload + 2;
	const flags = input[offset++]!;
	if ((flags & 0x80) !== 0) {
		if (es.end - offset < 2) return false;
		offset += 2;
	}
	if ((flags & 0x40) !== 0) {
		if (offset >= es.end) return false;
		const urlBytes = input[offset++]!;
		if (urlBytes > es.end - offset) return false;
		offset += urlBytes;
	}
	if ((flags & 0x20) !== 0) {
		if (es.end - offset < 2) return false;
		offset += 2;
	}
	const decoder = inspectDescriptor(input, offset, es.end);
	if (decoder === null || decoder.tag !== 0x04 || decoder.end - decoder.payload < 13
		|| input[decoder.payload] !== 0x40 || input[decoder.payload + 1] !== 0x15) return false;
	const config = inspectDescriptor(input, decoder.payload + 13, decoder.end);
	if (config === null || config.tag !== 0x05 || config.end !== decoder.end
		|| !exactAudioSpecificConfig(
			input.subarray(config.payload, config.end), sampleRate, channelCount,
		)) return false;
	const streamLayer = inspectDescriptor(input, decoder.end, es.end);
	return streamLayer !== null && streamLayer.tag === 0x06 && streamLayer.end === es.end
		&& streamLayer.end - streamLayer.payload === 1 && input[streamLayer.payload] === 0x02;
}

function exactAudioSpecificConfig(
	config: Uint8Array,
	expectedSampleRate: number,
	expectedChannelCount: number,
): boolean {
	const bits = new BitReader(config);
	const audioObjectType = bits.read(5);
	const frequencyIndex = bits.read(4);
	if (audioObjectType !== 2 || frequencyIndex === null) return false;
	const sampleRate = frequencyIndex === 15 ? bits.read(24) : AAC_SAMPLE_RATES[frequencyIndex] ?? null;
	const channelConfiguration = bits.read(4);
	const frameLength = bits.read(1);
	const dependsOnCoreCoder = bits.read(1);
	const extensionFlag = bits.read(1);
	if (sampleRate !== expectedSampleRate || channelConfiguration !== expectedChannelCount
		|| frameLength !== 0 || dependsOnCoreCoder !== 0 || extensionFlag !== 0) return false;
	if (bits.remainingAreZero()) return true;
	return bits.read(11) === 0x2b7 && bits.read(5) === 5 && bits.read(1) === 0
		&& bits.remainingAreZero();
}

class BitReader {
	readonly #bytes: Uint8Array;
	#position = 0;

	constructor(bytes: Uint8Array) { this.#bytes = bytes; }

	read(count: number): number | null {
		if (!Number.isSafeInteger(count) || count < 0 || count > 32
			|| count > this.#bytes.byteLength * 8 - this.#position) return null;
		let result = 0;
		for (let index = 0; index < count; index += 1) {
			const bit = this.#position;
			this.#position += 1;
			result = result * 2 + (this.#bytes[Math.floor(bit / 8)]! >>> (7 - bit % 8) & 1);
		}
		return result;
	}

	remainingAreZero(): boolean {
		for (let bit = this.#position; bit < this.#bytes.byteLength * 8; bit += 1) {
			if ((this.#bytes[Math.floor(bit / 8)]! >>> (7 - bit % 8) & 1) !== 0) return false;
		}
		return true;
	}
}

function exactM4aFileType(input: Uint8Array, box: IsoBox): boolean {
	if (box.end - box.payload < 8 || (box.end - box.payload - 8) % 4 !== 0) return false;
	if (unsigned32(input, box.payload) === M4A_BRAND) return true;
	for (let offset = box.payload + 8; offset < box.end; offset += 4) {
		if (unsigned32(input, offset) === M4A_BRAND) return true;
	}
	return false;
}

function visitBoxes(
	input: Uint8Array,
	start: number,
	end: number,
	visitor: (box: IsoBox) => boolean,
): boolean {
	if (!safeOffset(start, end, input.byteLength)) return false;
	let offset = start;
	while (offset < end) {
		const inspected = inspectBox(input, offset, end);
		if (inspected === null || !visitor(inspected.box)) return false;
		offset = inspected.next;
	}
	return offset === end;
}

function inspectBox(
	input: Uint8Array,
	offset: number,
	end: number,
): Readonly<{ readonly box: IsoBox; readonly next: number }> | null {
	if (!safeOffset(offset, end, input.byteLength) || end - offset < 8) return null;
	let bytes = unsigned32(input, offset);
	let headerBytes = 8;
	if (bytes === 1) {
		if (end - offset < 16) return null;
		const extended = view(input).getBigUint64(offset + 8, false);
		if (extended > BigInt(Number.MAX_SAFE_INTEGER)) return null;
		bytes = Number(extended);
		headerBytes = 16;
	} else if (bytes === 0) bytes = end - offset;
	if (!Number.isSafeInteger(bytes) || bytes < headerBytes || bytes > end - offset) return null;
	const next = offset + bytes;
	return Object.freeze({
		box: Object.freeze({ type: unsigned32(input, offset + 4), payload: offset + headerBytes, end: next }),
		next,
	});
}

function inspectDescriptor(input: Uint8Array, offsetValue: number, end: number): Descriptor | null {
	let offset = offsetValue;
	if (!safeOffset(offset, end, input.byteLength) || offset >= end) return null;
	const tag = input[offset++]!;
	let bytes = 0;
	let complete = false;
	for (let index = 0; index < 4; index += 1) {
		if (offset >= end || bytes > Math.floor(Number.MAX_SAFE_INTEGER / 128)) return null;
		const value = input[offset++]!;
		bytes = bytes * 128 + (value & 0x7f);
		if ((value & 0x80) === 0) { complete = true; break; }
	}
	if (!complete || bytes > end - offset) return null;
	return Object.freeze({ tag, payload: offset, end: offset + bytes });
}

function unsigned16(input: Uint8Array, offset: number): number {
	return view(input).getUint16(offset, false);
}

function unsigned32(input: Uint8Array, offset: number): number {
	return view(input).getUint32(offset, false);
}

function view(input: Uint8Array): DataView {
	return new DataView(input.buffer, input.byteOffset, input.byteLength);
}

function safeOffset(start: number, end: number, maximum: number): boolean {
	return Number.isSafeInteger(start) && Number.isSafeInteger(end)
		&& start >= 0 && start <= end && end <= maximum;
}

function fourCc(value: string): number {
	return value.charCodeAt(0) * 0x100_0000 + value.charCodeAt(1) * 0x1_0000
		+ value.charCodeAt(2) * 0x100 + value.charCodeAt(3);
}
