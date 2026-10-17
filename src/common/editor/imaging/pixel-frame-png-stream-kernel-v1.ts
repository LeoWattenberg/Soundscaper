/* SPDX-License-Identifier: AGPL-3.0-only */

import { Zlib } from 'fflate';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1 } from './pixel-frame-contract-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from './pixel-frame-repair-lifetime-v1.ts';
import { prepareImageOutputColorProfileV1, writeImageOutputColorPixelV1 } from './image-output-color-profile-v1.ts';
import { Png16StreamOwnerV1, appendPng16FailureV1 as append, throwPng16FailuresV1 } from './pixel-frame-png16-stream-owner-v1.ts';

export const PIXEL_FRAME_PNG_STREAM_MAXIMUM_OUTPUT_BYTES_V1 = 256 * 1024 * 1024;
export const PIXEL_FRAME_PNG16_PROFILES_V1 = Object.freeze([
	Object.freeze({ sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' }),
	Object.freeze({ sampleFormat: 'float32', primaries: 'bt709', transfer: 'linear' }),
	Object.freeze({ sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'srgb' }),
	Object.freeze({ sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }),
]);
const P3_PROFILES = Object.freeze(PIXEL_FRAME_PNG16_PROFILES_V1.filter(profile => profile.sampleFormat !== 'unorm16'));
const NativeBytes = Uint8Array, NativeWords = Uint16Array, NativeFloats = Float32Array;
const TYPED = Object.getPrototypeOf(NativeBytes.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!, SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const SET = NativeBytes.prototype.set, FILL = NativeBytes.prototype.fill;
const CHUNK_BYTES = 65_536, WORKSPACE_BYTES = 1024 * 1024;
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
	for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ (value & 1 ? 0xedb8_8320 : 0);
	return value >>> 0;
});
type Policy = 'srgb16' | 'p3-8' | 'p3-16';

/** Fixed codec policies share the qualified fflate0.8.3 level6/mem4 stream,
 * intrinsic source custody and physical retirement owner. The 1MiB reserve
 * retains the bounded codec/row workspace plus one32-byte color-code scratch.
 * P3 conversion runs directly into that scratch while feeding PNG scanlines;
 * no full encoded or Float32 intermediate plane is allocated. */
export async function encodePixelFramePngStreamV1(policy: Policy, value: unknown, optionsValue: unknown = {}): Promise<Uint8Array<ArrayBuffer>> {
	const signalData = typeof optionsValue === 'object' && optionsValue !== null ? Object.getOwnPropertyDescriptor(optionsValue, 'signal') : undefined;
	if (signalData && !Object.hasOwn(signalData, 'value')) throw new TypeError('PNG16 signal requires an own data property.');
	const signal = captureRepairSignalV1(signalData?.value), check = () => { checkRepairSignalV1(signal); }; check();
	if (policy !== 'srgb16' && policy !== 'p3-8' && policy !== 'p3-16') throw new RangeError('Unsupported fixed PNG stream profile.');
	const bitDepth = policy === 'p3-8' ? 8 : 16, sampleBytes = bitDepth / 8, containerBytes = policy === 'srgb16' ? 58 : 61;
	const admitted = (() => { try {
		const options = record(optionsValue, 'PNG16 encoding options', ['limits', 'signal', 'maximumOutputBytes'], []);
		if ((Object.hasOwn(options, 'signal') ? field(options, 'signal', 'PNG16 encoding options') : undefined) !== signal) throw new TypeError('PNG16 signal changed during admission.');
		const maximum = Object.hasOwn(options, 'maximumOutputBytes') ? field(options, 'maximumOutputBytes', 'PNG16 encoding options') : PIXEL_FRAME_PNG_STREAM_MAXIMUM_OUTPUT_BYTES_V1;
		if (typeof maximum !== 'number' || !Number.isSafeInteger(maximum) || maximum < WORKSPACE_BYTES + containerBytes + 12
			|| maximum > PIXEL_FRAME_PNG_STREAM_MAXIMUM_OUTPUT_BYTES_V1) throw new RangeError('PNG16 output storage budget is outside the admitted range.');
		if (!value || typeof value !== 'object') throw new TypeError('PNG16 source requires a pixel frame.');
		const limits = Object.hasOwn(options, 'limits') ? field(options, 'limits', 'PNG16 encoding options') : {};
		const plan = admitPixelFrameV1(field(value as Readonly<Record<string, unknown>>, 'descriptor', 'PNG16 source frame'),
			{ profiles: policy === 'srgb16' ? PIXEL_FRAME_PNG16_PROFILES_V1 : P3_PROFILES, limits });
		const raw = record(value, 'PNG16 source frame', ['descriptor', 'pixels']);
		const source = readPixelFrameV1({ descriptor: plan.descriptor, pixels: field(raw, 'pixels', 'PNG16 source frame') }, limits);
		const backing = Reflect.apply(BUFFER, source.pixels, []) as ArrayBuffer, offset = Number(Reflect.apply(OFFSET, source.pixels, []));
		const size = Number(Reflect.apply(SIZE, backing, []));
		const pixels = source.descriptor.sampleFormat === 'float32' ? new NativeFloats(backing, offset, plan.sampleCount)
			: source.descriptor.sampleFormat === 'unorm16' ? new NativeWords(backing, offset, plan.sampleCount) : new NativeBytes(backing, offset, plan.sampleCount);
		check(); return { source, plan, maximum, backing, size, pixels };
	} catch (error) { check(); throw error; } })();
	const checkSource = () => {
		check(); if (Reflect.apply(SIZE, admitted.backing, []) !== admitted.size || Reflect.apply(LENGTH, admitted.pixels, []) !== admitted.plan.byteLength) {
			throw new TypeError('PNG16 borrowed source backing was detached or changed.');
		}
	};
	const conversion = policy === 'srgb16' ? undefined : prepareImageOutputColorProfileV1({ profile: 'display-p3', bitDepth,
		source: admitted.source.descriptor.sampleFormat === 'float32' ? 'linear-srgb' : 'encoded-srgb8' });
	const owner = new Png16StreamOwnerV1(admitted.backing), chunks: Uint8Array<ArrayBuffer>[] = [], cleanup: unknown[] = [];
	let compressedBytes = 0, output: Uint8Array<ArrayBuffer> | undefined, codec: Zlib | undefined;
	let outcome: { readonly value: Uint8Array<ArrayBuffer> } | { readonly error: unknown };
	try {
		const scratch = owner.bytes(CHUNK_BYTES, 'row');
		const codes = conversion ? new Float64Array(owner.bytes(32, 'color samples').buffer) : undefined;
		codec = new Zlib({ level: 6, mem: 4 }, bytes => {
			owner.captureCodec(codec!);
			const backing = Reflect.apply(BUFFER, bytes, []) as ArrayBuffer, offset = Number(Reflect.apply(OFFSET, bytes, [])), length = Number(Reflect.apply(LENGTH, bytes, []));
			if (length === 0) return;
			owner.capture(backing, 'emitted codec'); let failed = false, primary: unknown;
			try {
				const next = compressedBytes + length;
				if (WORKSPACE_BYTES + containerBytes + (chunks.length + 1) * 12 + next * 2 > admitted.maximum) throw new RangeError('PNG16 compressed output exceeds its storage budget.');
				const copy = owner.bytes(length, 'compressed chunk'); Reflect.apply(SET, copy, [new NativeBytes(backing, offset, length)]);
				chunks.push(copy); compressedBytes = next;
			} catch (error) { failed = true; primary = error; }
			try { owner.retire(backing); } catch (error) { append(cleanup, error); if (!failed) { failed = true; primary = error; } }
			if (failed) throw primary;
		});
		owner.captureCodec(codec);
		const push = codec.push;
		const stride = admitted.plan.descriptor.width * 4 * sampleBytes + 1, total = stride * admitted.plan.descriptor.height;
		let low = 0;
		for (let cursor = 0; cursor < total;) {
			checkSource(); let used = 0;
			while (used < CHUNK_BYTES && cursor < total) {
				const position = cursor % stride;
				if (position === 0) scratch[used++] = 0;
				else if (bitDepth === 16 && position % 2 === 0) scratch[used++] = low;
				else {
					const sample = Math.floor(cursor / stride) * admitted.plan.descriptor.width * 4 + Math.floor((position - 1) / sampleBytes);
					let code: number;
					if (conversion && codes) {
						const channel = sample % 4;
						if (channel === 0) writeImageOutputColorPixelV1(conversion, admitted.pixels[sample]!, admitted.pixels[sample + 1]!,
							admitted.pixels[sample + 2]!, admitted.pixels[sample + 3]!, codes);
						code = codes[channel]!;
					} else code = quantizeLegacy(admitted.pixels[sample]!, sample % 4 === 3, admitted.plan.descriptor.sampleFormat);
					scratch[used++] = bitDepth === 16 ? code >>> 8 : code; low = code & 255;
				}
				cursor++;
			}
			owner.captureCodec(codec); Reflect.apply(push, codec, [scratch.subarray(0, used), cursor === total]); owner.captureCodec(codec);
			Reflect.apply(FILL, scratch, [0]); checkSource();
			if (cursor < total) { await yieldTask(); checkSource(); }
		}
		output = owner.bytes(containerBytes + chunks.length * 12 + compressedBytes, 'output');
		Reflect.apply(SET, output, [[137, 80, 78, 71, 13, 10, 26, 10]]);
		const header = owner.bytes(13, 'header'), geometry = new DataView(header.buffer);
		geometry.setUint32(0, admitted.plan.descriptor.width); geometry.setUint32(4, admitted.plan.descriptor.height); header[8] = bitDepth; header[9] = 6;
		let cursor = writeChunk(output, 8, 'IHDR', header); owner.retire(header.buffer);
		if (policy === 'srgb16') cursor = writeChunk(output, cursor, 'sRGB', NativeBytes.of(0));
		else {
			const declaration = owner.bytes(4, 'color declaration'); Reflect.apply(SET, declaration, [[12, 13, 0, 1]]);
			cursor = writeChunk(output, cursor, 'cICP', declaration); owner.retire(declaration.buffer);
		}
		for (let index = 0; index < chunks.length; index++) {
			checkSource(); cursor = writeChunk(output, cursor, 'IDAT', chunks[index]!); owner.retire(chunks[index]!.buffer);
			if (index + 1 < chunks.length) { await yieldTask(); checkSource(); }
		}
		cursor = writeChunk(output, cursor, 'IEND', new NativeBytes(0));
		if (cursor !== output.length) throw new Error('PNG16 output length disagrees with its admitted chunks.');
		checkSource(); outcome = { value: output };
	} catch (error) {
		let primary = error; try { check(); } catch (reason) { primary = reason; }
		outcome = { error: primary };
	}
	const failures: unknown[] = 'error' in outcome ? [outcome.error] : [];
	if (codec) try { codec.ondata = () => {}; } catch (error) { append(failures, error); }
	for (const error of cleanup) append(failures, error);
	for (const error of owner.retireAll('value' in outcome ? outcome.value.buffer : undefined)) append(failures, error);
	if (failures.length && 'value' in outcome) try { owner.retire(outcome.value.buffer); } catch (error) { append(failures, error); }
	throwPng16FailuresV1(failures);
	if ('value' in outcome) { owner.release(outcome.value.buffer); return outcome.value; }
	throw new Error('PNG16 encoding has no operation outcome.');
}

function quantizeLegacy(value: number, alpha: boolean, format: 'float32' | 'unorm16' | 'unorm8'): number {
	if (format === 'unorm16') return value;
	if (format === 'unorm8') return value * 257;
	if (!Number.isFinite(value) || alpha && (value < 0 || value > 1)) throw new RangeError('PNG16 source samples changed outside their finite RGB/unit alpha profile.');
	const bounded = Math.max(0, Math.min(1, value));
	return Math.round(65535 * (alpha ? bounded : bounded <= .0031308 ? bounded * 12.92 : 1.055 * bounded ** (1 / 2.4) - .055));
}
function writeChunk(output: Uint8Array<ArrayBuffer>, offset: number, type: string, data: Uint8Array): number {
	const view = new DataView(output.buffer); view.setUint32(offset, data.length);
	for (let index = 0; index < 4; index++) output[offset + 4 + index] = type.charCodeAt(index);
	Reflect.apply(SET, output, [data, offset + 8]); let crc = 0xffff_ffff;
	for (let index = offset + 4; index < offset + 8 + data.length; index++) crc = crc >>> 8 ^ CRC_TABLE[(crc ^ output[index]!) & 255]!;
	view.setUint32(offset + 8 + data.length, (crc ^ 0xffff_ffff) >>> 0); return offset + 12 + data.length;
}
function yieldTask(): Promise<void> { return new Promise(resolve => { setTimeout(resolve, 0); }); }
