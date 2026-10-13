/* SPDX-License-Identifier: AGPL-3.0-only */
import { restoreOwnedAvcConfiguration } from './video-avc-native-configuration.ts';
import type { VideoWebCodecsEncodedChunk } from './video-webcodecs-producer.ts';

const MAX_DESCRIPTION = 65_536;
const MAX_NAL = 4_096;
const MAX_PACKET = 64 * 1024 * 1024;
const MAIN_LEVELS = [10, 11, 12, 13, 20, 21, 22, 30, 31, 32, 40, 41, 42, 50, 51, 52, 60, 61, 62];
function mainLevelRank(level: number, constraints: number): number {
	requireAvc(MAIN_LEVELS.includes(level) && (constraints & 3) === 0);
	// AnnexA/RFC6184: Main Level1b lies between1 and1.1, signaled by level11+constraint_set3.
	return level === 11 && (constraints & 16) !== 0 ? 10.5 : level;
}
function requireAvc(condition: unknown): asserts condition {
	if (!condition) throw new Error('Owned AVC color description is missing, conflicting or unsupported.');
}
function same(a: Uint8Array, b: Uint8Array): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

class Bits {
	position = 0;
	readonly bits: string;
	constructor(nal: Uint8Array) {
		requireAvc(nal.length >= 5 && nal.length <= MAX_NAL && (nal[0]! & 0x9f) === 7 && (nal[0]! & 0x60) !== 0);
		const bytes: number[] = []; let zeros = 0;
		for (let i = 1; i < nal.length; i += 1) {
			const byte = nal[i]!;
			if (zeros === 2) {
				if (byte === 3) { requireAvc(i + 1 < nal.length && nal[i + 1]! <= 3); zeros = 0; continue; }
				requireAvc(byte > 3);
			}
			bytes.push(byte); zeros = byte === 0 ? zeros + 1 : 0;
		}
		this.bits = bytes.map(value => value.toString(2).padStart(8, '0')).join('');
	}
	read(count: number): number {
		requireAvc(count >= 0 && count <= 32 && this.position + count <= this.bits.length);
		const value = Number.parseInt(this.bits.slice(this.position, this.position + count) || '0', 2);
		this.position += count; return value;
	}
	ue(max: number): number {
		let zeros = 0; while (this.read(1) === 0) { zeros += 1; requireAvc(zeros <= 31); }
		const value = 2 ** zeros - 1 + this.read(zeros); requireAvc(value <= max); return value;
	}
	se(): void { this.ue(65_534); }
	finish(): number {
		const end = this.position; requireAvc(this.read(1) === 1 && this.bits.length - this.position < 8);
		while (this.position < this.bits.length) requireAvc(this.read(1) === 0);
		return end;
	}
}

function hrd(bits: Bits): void {
	const count = bits.ue(31) + 1; bits.read(4); bits.read(4);
	for (let i = 0; i < count; i += 1) { bits.ue(0xffff_fffe); bits.ue(0xffff_fffe); bits.read(1); }
	bits.read(5); bits.read(5); bits.read(5); bits.read(5);
}

function serializeSps(header: number, syntax: string): Uint8Array {
	const result = syntax + '1';
	const aligned = result.padEnd(Math.ceil(result.length / 8) * 8, '0');
	const bytes = [header]; let zeros = 0;
	for (let i = 0; i < aligned.length; i += 8) {
		const byte = Number.parseInt(aligned.slice(i, i + 8), 2);
		if (zeros === 2 && byte <= 3) { bytes.push(3); zeros = 0; }
		bytes.push(byte); zeros = byte === 0 ? zeros + 1 : 0;
	}
	requireAvc(bytes.length <= MAX_NAL);
	return Uint8Array.from(bytes);
}

/** H.264 Annex E/7.3.2.11: own Main-profile metadata only, never imported media. */
function completeSps(nal: Uint8Array, geometry?: Readonly<{ width: number; height: number }>): Uint8Array {
	const bits = new Bits(nal);
	requireAvc(bits.read(8) === 77); // The maintained encoder admission requests Main (4d00), never High/scaling.
	requireAvc((bits.read(8) & 3) === 0);
	const level = bits.read(8); requireAvc(MAIN_LEVELS.includes(level));
	bits.ue(31); bits.ue(12);
	const poc = bits.ue(2);
	if (poc === 0) bits.ue(12);
	if (poc === 1) {
		bits.read(1); bits.se(); bits.se(); const count = bits.ue(255);
		for (let i = 0; i < count; i += 1) bits.se();
	}
	bits.ue(16); bits.read(1);
	const mbWidth = bits.ue(65_535) + 1, mapHeight = bits.ue(65_535) + 1;
	const frameOnly = bits.read(1); if (!frameOnly) bits.read(1);
	bits.read(1);
	const crop = bits.read(1) ? [bits.ue(65_535), bits.ue(65_535), bits.ue(65_535), bits.ue(65_535)] : [0, 0, 0, 0];
	// Main uses 4:2:0: Annex7.4.2.1.1 crop units are 2 by 2*(2-frame_mbs_only).
	const width = mbWidth * 16 - 2 * (crop[0]! + crop[1]!);
	const height = (2 - frameOnly) * (mapHeight * 16 - 2 * (crop[2]! + crop[3]!));
	requireAvc(width > 0 && height > 0 && (!geometry || (width === geometry.width && height === geometry.height)));
	const vuiStart = bits.position;
	if (!bits.read(1)) {
		bits.finish();
		// No other VUI information is invented: every unrelated optional flag remains absent.
		return serializeSps(nal[0]!, bits.bits.slice(0, vuiStart) + '100110101' + '00000001'.repeat(3) + '000000');
	}
	if (bits.read(1)) {
		const aspect = bits.read(8); requireAvc(aspect <= 16 || aspect === 255);
		if (aspect === 255) { requireAvc(bits.read(16) > 0); requireAvc(bits.read(16) > 0); }
	}
	if (bits.read(1)) bits.read(1);
	let start = bits.position; let replacement: string | null = null;
	if (!bits.read(1)) replacement = '110101' + '00000001'.repeat(3);
	else {
		requireAvc(bits.read(3) <= 5 && bits.read(1) === 0);
		start = bits.position;
		if (!bits.read(1)) replacement = '1' + '00000001'.repeat(3);
		else requireAvc(bits.read(8) === 1 && bits.read(8) === 1 && bits.read(8) === 1);
	}
	const end = bits.position;
	if (bits.read(1)) { bits.ue(5); bits.ue(5); }
	if (bits.read(1)) { requireAvc(bits.read(32) > 0); requireAvc(bits.read(32) > 0); bits.read(1); }
	const nalHrd = bits.read(1); if (nalHrd) hrd(bits);
	const vclHrd = bits.read(1); if (vclHrd) hrd(bits);
	if (nalHrd || vclHrd) bits.read(1);
	bits.read(1);
	if (bits.read(1)) {
		bits.read(1); bits.ue(16); bits.ue(16); bits.ue(16); bits.ue(16);
		const reorder = bits.ue(16); requireAvc(bits.ue(16) >= reorder);
	}
	const syntaxEnd = bits.finish();
	if (replacement === null) return nal;
	return serializeSps(nal[0]!, bits.bits.slice(0, start) + replacement + bits.bits.slice(end, syntaxEnd));
}

function descriptionBytes(description: AllowSharedBufferSource): Uint8Array {
	return ArrayBuffer.isView(description)
		? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
		: new Uint8Array(description);
}

/** Preserve every avcC byte except a missing SPS color field and its required length/escape bytes. */
export function completeVideoAvcColorDescription(input: Uint8Array, geometry?: Readonly<{ width: number; height: number }>): Uint8Array {
	requireAvc(input.length >= 11 && input.length <= MAX_DESCRIPTION && input[0] === 1 && input[1] === 77
		&& (input[4]! & 252) === 252 && (input[4]! & 3) !== 2 && (input[5]! & 224) === 224);
	const output = [...input.subarray(0, 6)]; let offset = 6; let changed = false;
	const copySet = (count: number, type: number): void => {
		requireAvc(count > 0);
		for (let i = 0; i < count; i += 1) {
			requireAvc(offset + 2 <= input.length);
			const size = input[offset]! * 256 + input[offset + 1]!; offset += 2;
			requireAvc(size > 0 && size <= MAX_NAL && offset + size <= input.length);
			const original = input.subarray(offset, offset + size); offset += size;
			requireAvc((original[0]! & 0x9f) === type && (original[0]! & 0x60) !== 0);
			if (type === 7) requireAvc(same(original.subarray(1, 4), input.subarray(1, 4)));
			const updated = type === 7 ? completeSps(original, geometry) : original;
			changed ||= updated !== original;
			output.push(updated.length >> 8, updated.length & 255, ...updated);
		}
	};
	copySet(input[5]! & 31, 7);
	requireAvc(offset < input.length); const ppsCount = input[offset++]!; output.push(ppsCount); copySet(ppsCount, 8);
	requireAvc(offset === input.length && output.length <= MAX_DESCRIPTION);
	return changed ? Uint8Array.from(output) : input;
}

/** Only for the producer's explicit 709 limited I420 input; an emitted config is also required. */
export function createVideoAvcColorNormalizer(width: number, height: number) {
	let nalLength = 0;
	let sets: Uint8Array[] = [];
	return (chunk: VideoWebCodecsEncodedChunk, metadata?: EncodedVideoChunkMetadata) => {
		requireAvc(Number.isSafeInteger(chunk.byteLength) && chunk.byteLength > 0 && chunk.byteLength <= MAX_PACKET);
		const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes);
		let result = metadata;
		if (metadata?.decoderConfig) {
			const config = metadata.decoderConfig, color = config.colorSpace;
			requireAvc(/^avc1\.4d[0-9a-f]{4}$/iu.test(config.codec) && config.codedWidth === width && config.codedHeight === height
				&& color?.primaries === 'bt709' && color.transfer === 'bt709' && color.matrix === 'bt709' && color.fullRange === false
				&& config.description);
			const emitted = descriptionBytes(config.description);
			const original = restoreOwnedAvcConfiguration(emitted, bytes, chunk.type); const updated = completeVideoAvcColorDescription(original, { width, height });
			// Native config can retain a broader requested Main level; actual avcC/SPS remains the content authority.
			const constraints = Number.parseInt(config.codec.slice(7, 9), 16);
			requireAvc((constraints & 3) === 0 && (original[2]! & constraints) === constraints
				&& mainLevelRank(original[3]!, original[2]!) <= mainLevelRank(Number.parseInt(config.codec.slice(9, 11), 16), constraints));
			nalLength = (original[4]! & 3) + 1;
			sets = [];
			let at = 6; let count = updated[5]! & 31;
			for (let group = 0; group < 2; group += 1) {
				for (let i = 0; i < count; i += 1) {
					const length = updated[at]! * 256 + updated[at + 1]!; at += 2;
					sets.push(updated.slice(at, at + length)); at += length;
				}
				if (group === 0) count = updated[at++]!;
			}
			if (updated !== emitted) result = { ...metadata, decoderConfig: { ...config, description: updated } };
		}
		requireAvc(nalLength > 0);
		let offset = 0; let count = 0;
		const replacements: { start: number; end: number; nal: Uint8Array }[] = [];
		while (offset < bytes.length) {
			const start = offset;
			requireAvc(++count <= 8192 && offset + nalLength <= bytes.length);
			let length = 0; for (let i = 0; i < nalLength; i += 1) length = length * 256 + bytes[offset++]!;
			requireAvc(length > 0 && offset + length <= bytes.length);
			const nal = bytes.subarray(offset, offset + length); offset += length;
			const type = nal[0]! & 31; requireAvc((nal[0]! & 128) === 0 && type >= 1 && type <= 12);
			if (type === 7 || type === 8) {
				const updated = type === 7 ? completeSps(nal, { width, height }) : nal;
				requireAvc(sets.some(set => same(set, updated)));
				if (updated !== nal) replacements.push({ start, end: offset, nal: updated });
			}
		}
		if (!replacements.length) return { chunk, metadata: result };
		const length = replacements.reduce((total, item) => total + nalLength + item.nal.length - (item.end - item.start), bytes.length);
		requireAvc(length <= MAX_PACKET);
		const output = new Uint8Array(length); let source = 0; let target = 0;
		for (const item of replacements) {
			output.set(bytes.subarray(source, item.start), target); target += item.start - source;
			requireAvc(item.nal.length < 2 ** (nalLength * 8));
			let value = item.nal.length;
			for (let i = nalLength - 1; i >= 0; i -= 1) { output[target + i] = value & 255; value = Math.floor(value / 256); }
			target += nalLength; output.set(item.nal, target); target += item.nal.length; source = item.end;
		}
		output.set(bytes.subarray(source), target);
		return { metadata: result, chunk: {
			byteLength: output.byteLength, type: chunk.type, timestamp: chunk.timestamp,
			...(chunk.duration === undefined ? {} : { duration: chunk.duration }),
			copyTo(destination: Uint8Array) { destination.set(output); },
		} satisfies VideoWebCodecsEncodedChunk };
	};
}
