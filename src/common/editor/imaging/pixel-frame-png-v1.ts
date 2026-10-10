/* SPDX-License-Identifier: AGPL-3.0-only */

import { Zlib } from 'fflate';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';

export interface PixelFramePngOptionsV1 {
	readonly signal?: AbortSignal;
	readonly limits?: PixelFrameLimitsV1;
	readonly maximumOutputBytes?: number;
}

export const PIXEL_FRAME_PNG_MAXIMUM_OUTPUT_BYTES_V1 = 256 * 1024 * 1024;
const CHUNK_BYTES = 65_536;
// Reserve a fixed workspace for the row span and the pinned streaming codec's
// bounded rolling/temporary output buffers. Retained chunks AND final bytes
// count against the remaining storage, rather than only the final file size.
const WORKSPACE_BYTES = 1024 * 1024;
const CONTAINER_BYTES = 58; // Signature, IHDR, sRGB and IEND.
const CHECK = AbortSignal.prototype.throwIfAborted;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
	for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb8_8320 : 0);
	return value >>> 0;
});

/** Deterministic 8-bit encoded sRGB PNG, preserving straight alpha and hidden
 * RGB. The depth-aware frame contract is unchanged; unsupported profiles are
 * refused, never converted. Source pixels remain borrowed and must stay fixed
 * until settlement; returned bytes are independently owned by the caller.
 * maximumOutputBytes bounds peak encoder output storage, including retained
 * compressed chunks, the final PNG and a fixed codec/row workspace reserve. */
export async function encodePixelFramePngV1(value: unknown, optionsValue: unknown = {}): Promise<Uint8Array<ArrayBuffer>> {
	const options = record(optionsValue, 'PNG encoding options', ['limits', 'signal', 'maximumOutputBytes'], []);
	const signal = Object.hasOwn(options, 'signal') ? field(options, 'signal', 'PNG encoding options') : undefined;
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
	check();
	const maximum = Object.hasOwn(options, 'maximumOutputBytes') ? field(options, 'maximumOutputBytes', 'PNG encoding options') : PIXEL_FRAME_PNG_MAXIMUM_OUTPUT_BYTES_V1;
	if (typeof maximum !== 'number' || !Number.isSafeInteger(maximum) || maximum < WORKSPACE_BYTES + CONTAINER_BYTES + 12
		|| maximum > PIXEL_FRAME_PNG_MAXIMUM_OUTPUT_BYTES_V1) throw new RangeError('PNG output storage budget is outside the admitted range.');
	const input = record(value, 'PNG source frame', ['descriptor', 'pixels']);
	const limits = Object.hasOwn(options, 'limits') ? field(options, 'limits', 'PNG encoding options') : {};
	const plan = admitPixelFrameV1(field(input, 'descriptor', 'PNG source frame'), { limits });
	const source = readPixelFrameV1({ descriptor: plan.descriptor, pixels: field(input, 'pixels', 'PNG source frame') }, limits);
	if (source.descriptor.sampleFormat !== 'unorm8') throw new RangeError('PNG encoding requires UNORM8 rendered samples.');
	const pixels = new Uint8Array(source.pixels.buffer, source.pixels.byteOffset, plan.byteLength);
	const checkSource = () => {
		check();
		if (Number(Reflect.apply(BUFFER_SIZE, pixels.buffer, [])) === 0) {
			throw new RangeError('PNG source buffer was detached before completion.');
		}
	};
	const chunks: Uint8Array<ArrayBuffer>[] = [], scratch = new Uint8Array(CHUNK_BYTES);
	let compressedBytes = 0, output: Uint8Array<ArrayBuffer> | null = null, completed = false;
	// Streaming feed/output are fixed-size spans. Copy only the emitted view so
	// a tiny compressed result cannot retain a much larger codec backing buffer.
	const codec = new Zlib({ level: 6, mem: 4 }, bytes => {
		try {
			if (bytes.length === 0) return;
			const next = compressedBytes + bytes.length;
			if (WORKSPACE_BYTES + CONTAINER_BYTES + (chunks.length + 1) * 12 + next * 2 > maximum) {
				throw new RangeError('PNG compressed output exceeds its storage budget.');
			}
			chunks.push(new Uint8Array(bytes)); compressedBytes = next;
		} finally { wipe(bytes.buffer); }
	});
	try {
		const stride = plan.descriptor.width * 4 + 1, total = stride * plan.descriptor.height;
		for (let cursor = 0; cursor < total;) {
			checkSource(); let used = 0;
			while (used < scratch.length && cursor < total) {
				const position = cursor % stride;
				if (position === 0) { scratch[used++] = 0; cursor++; continue; }
				const length = Math.min(stride - position, scratch.length - used);
				const start = Math.floor(cursor / stride) * (stride - 1) + position - 1;
				scratch.set(pixels.subarray(start, start + length), used); used += length; cursor += length;
			}
			codec.push(scratch.subarray(0, used), cursor === total); scratch.fill(0);
			if (cursor < total) { await yieldTask(); checkSource(); }
		}
		checkSource();
		output = new Uint8Array(CONTAINER_BYTES + chunks.length * 12 + compressedBytes);
		output.set([137, 80, 78, 71, 13, 10, 26, 10]);
		const header = new Uint8Array(13), geometry = new DataView(header.buffer);
		geometry.setUint32(0, plan.descriptor.width); geometry.setUint32(4, plan.descriptor.height); header[8] = 8; header[9] = 6;
		let cursor = writeChunk(output, 8, 'IHDR', header); header.fill(0);
		cursor = writeChunk(output, cursor, 'sRGB', Uint8Array.of(0));
		for (let index = 0; index < chunks.length; index++) {
			checkSource(); cursor = writeChunk(output, cursor, 'IDAT', chunks[index]!);
			chunks[index]!.fill(0);
			if (index + 1 < chunks.length) { await yieldTask(); checkSource(); }
		}
		cursor = writeChunk(output, cursor, 'IEND', new Uint8Array(0));
		if (cursor !== output.length) throw new Error('PNG output length disagrees with its admitted chunks.');
		checkSource(); completed = true; return output;
	} finally {
		scratch.fill(0); for (const bytes of chunks) bytes.fill(0);
		if (!completed && output !== null) output.fill(0);
		chunks.length = 0; codec.ondata = () => {};
	}
}

function writeChunk(output: Uint8Array, offset: number, type: string, data: Uint8Array): number {
	const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
	view.setUint32(offset, data.length);
	for (let index = 0; index < 4; index++) output[offset + 4 + index] = type.charCodeAt(index);
	output.set(data, offset + 8);
	let crc = 0xffff_ffff;
	for (let index = offset + 4; index < offset + 8 + data.length; index++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ output[index]!) & 255]!;
	view.setUint32(offset + 8 + data.length, (crc ^ 0xffff_ffff) >>> 0);
	return offset + 12 + data.length;
}

function yieldTask(): Promise<void> { return new Promise(resolve => { setTimeout(resolve, 0); }); }
function wipe(buffer: ArrayBuffer): void {
	if (Number(Reflect.apply(BUFFER_SIZE, buffer, [])) > 0) new Uint8Array(buffer).fill(0);
}
