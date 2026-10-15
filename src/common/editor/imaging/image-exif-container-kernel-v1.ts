/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { encodeImageExifTiffV1, type ImageExifWriteOptionsV1 } from './exif-metadata-writer-v1.ts';
import { encodeImageExifTiffProfileCurrentV1 } from './exif-metadata-writer-profile-current-v1.ts';
import { matchesBytes, MetadataBudget, metadataCrc32 } from './image-metadata-binary.ts';
import { IMAGE_METADATA_LIMITS_V1, type ImageExifMetadataV1 } from './image-metadata-model-v1.ts';

export interface ImageExifContainerInputV1 {
	readonly format: 'png' | 'jpeg';
	readonly bytes: Uint8Array;
	readonly exif: Readonly<ImageExifMetadataV1> | null;
	readonly width: number;
	readonly height: number;
	readonly scope?: ImageExifWriteOptionsV1['scope'];
}
export interface ImageExifContainerOptionsV1 { readonly signal?: AbortSignal; readonly maximumOutputBytes?: number; }
export const IMAGE_EXIF_CONTAINER_MAXIMUM_BYTES_V1 = 256 * 1024 * 1024;
const SPAN = 65_536;
const CHECK = AbortSignal.prototype.throwIfAborted;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10], EXIF = [69, 120, 105, 102, 0, 0];
const JFIF = [74, 70, 73, 70, 0], ICC = [73, 67, 67, 95, 80, 82, 79, 70, 73, 76, 69, 0];

/** Compose only fresh codec output, never an original image or opaque metadata.
 * PNG CRC/header/order and JPEG marker/geometry admission are not image decoding;
 * JPEG entropy and native JFIF/ICC bytes remain unchanged. Borrowed input must
 * stay fixed through settlement. Input is separately bounded at 256 MiB;
 * maximumOutputBytes bounds owned output plus retained TIFF scratch (including
 * container overhead), not caller/codec storage. The awaited consumer scopes
 * the independent output, which is wiped even on cancellation or failure.
 * Explicit strip copies bytes exactly; the UI's default strip should bypass
 * composition to preserve its existing codec allocation/lifetime behavior. */
export async function withImageExifContainerForProfileV1<T>(profile: 'legacy1' | 'current1', value: unknown,
	consume: (bytes: Uint8Array<ArrayBuffer>) => T | PromiseLike<T>, optionsValue: unknown = {}): Promise<T> {
	if (profile !== 'legacy1' && profile !== 'current1') throw new RangeError('Unsupported image container composition profile.');
	return withContainer(profile, value, consume, optionsValue);
}

/** Explicit output-profile policy. The permanent entry above admits no new
 * fields, color chunks, JPEG profile or bit-depth contract. */
export function withImageExifContainerProfilePolicyCurrentV1<T>(value: unknown,
	consume: (bytes: Uint8Array<ArrayBuffer>) => T | PromiseLike<T>, optionsValue: unknown = {}): Promise<T> {
	return withContainer('output1', value, consume, optionsValue);
}

async function withContainer<T>(policy: 'legacy1' | 'current1' | 'output1', value: unknown,
	consume: (bytes: Uint8Array<ArrayBuffer>) => T | PromiseLike<T>, optionsValue: unknown): Promise<T> {
	if (typeof consume !== 'function') throw new TypeError('Image container composition requires its scoped consumer.');
	const options = record(optionsValue, 'Image container options', ['signal', 'maximumOutputBytes'], []);
	const signal = Object.hasOwn(options, 'signal') ? field(options, 'signal', 'Image container options') : undefined;
	if (signal !== undefined) {
		Reflect.apply(CHECK, signal, []);
		if (typeof signal !== 'object' || signal === null || Object.getPrototypeOf(signal) !== AbortSignal.prototype
			|| ['aborted', 'reason', 'throwIfAborted'].some(key => Object.hasOwn(signal, key))) throw new TypeError('Image container composition requires native cancellation.');
	}
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
	check();
	const maximum = positive(Object.hasOwn(options, 'maximumOutputBytes') ? field(options, 'maximumOutputBytes', 'Image container options')
		: IMAGE_EXIF_CONTAINER_MAXIMUM_BYTES_V1, IMAGE_EXIF_CONTAINER_MAXIMUM_BYTES_V1);
	const profiled = policy === 'output1';
	const input = record(value, 'Image container input', ['format', 'bytes', 'exif', 'width', 'height', 'scope', ...(profiled ? ['profile', 'bitDepth'] : [])],
		['format', 'bytes', 'exif', 'width', 'height', ...(profiled ? ['profile', 'bitDepth'] : [])]);
	const format = field(input, 'format', 'Image container input');
	if (format !== 'png' && format !== 'jpeg') throw new RangeError('Unsupported Exif image container.');
	const color = profiled ? field(input, 'profile', 'Image container input') : 'srgb';
	if (color !== 'srgb' && color !== 'display-p3') throw new RangeError('Unsupported image output color profile.');
	const depth = profiled ? field(input, 'bitDepth', 'Image container input') : undefined;
	if (profiled && depth !== 8 && depth !== 16) throw new RangeError('Unsupported image output bit depth.');
	if (format === 'jpeg' && (color !== 'srgb' || profiled && depth !== 8)) throw new RangeError('Profiled JPEG output is available only for sRGB8.');
	const width = positive(field(input, 'width', 'Image container input'), format === 'jpeg' ? 65_535 : 0x7fffffff);
	const height = positive(field(input, 'height', 'Image container input'), format === 'jpeg' ? 65_535 : 0x7fffffff);
	const scope = Object.hasOwn(input, 'scope') ? field(input, 'scope', 'Image container input') : 'strip';
	const bytes = readBytes(field(input, 'bytes', 'Image container input'), profiled);
	const current = () => { check(); if (Reflect.apply(SIZE, bytes.buffer, []) === 0) throw new TypeError('Image container input was detached before completion.'); };
	const overhead = format === 'jpeg' ? 10 : 12;
	if (bytes.length > maximum) throw new RangeError('Image container output exceeds its byte budget.');
	const metadataMaximum = scope === 'strip' ? IMAGE_METADATA_LIMITS_V1.maximumMetadataBytes
		: positive(Math.floor((maximum - bytes.length - overhead) / 2), IMAGE_EXIF_CONTAINER_MAXIMUM_BYTES_V1);
	// The writer captures normalized closed facts/options before any asynchronous scan.
	const writeOptions = { scope, width, height, maximumOutputBytes: Math.min(metadataMaximum, format === 'jpeg' ? 65_527 : IMAGE_METADATA_LIMITS_V1.maximumMetadataBytes) };
	const tiff = profiled ? encodeImageExifTiffProfileCurrentV1(field(input, 'exif', 'Image container input'), { ...writeOptions, profile: color })
		: encodeImageExifTiffV1(field(input, 'exif', 'Image container input'), writeOptions);
	let output: Uint8Array<ArrayBuffer> | null = null;
	let backing: ArrayBuffer | undefined, allocated = 0, outcome: { value: T } | { error: unknown };
	try {
		const insertion = format === 'png' ? await pngInsertion(bytes, width, height, current, policy, color, depth) : await jpegInsertion(bytes, width, height, current);
		current();
		const added = tiff ? tiff.length + overhead : 0;
		if (bytes.length + added + (tiff?.length ?? 0) > maximum) throw new RangeError('Image container output and metadata scratch exceed their byte budget.');
		output = new Uint8Array(bytes.length + added);
		backing = output.buffer; allocated = output.length;
		await copy(bytes.subarray(0, insertion), output, 0, current);
		if (tiff) {
			const view = new DataView(output.buffer);
			if (format === 'jpeg') {
				output.set([255, 225], insertion); view.setUint16(insertion + 2, tiff.length + 8);
				output.set(EXIF, insertion + 4); await copy(tiff, output, insertion + 10, current);
			} else {
				view.setUint32(insertion, tiff.length); output.set([101, 88, 73, 102], insertion + 4); await copy(tiff, output, insertion + 8, current);
				view.setUint32(insertion + 8 + tiff.length, await crcSpan(output.subarray(insertion + 4, insertion + 8 + tiff.length), current));
			}
			tiff.fill(0);
		}
		await copy(bytes.subarray(insertion), output, insertion + added, current);
		current(); const result = await consume(output); current();
		if (profiled ? Reflect.apply(SIZE, backing, []) !== allocated : Reflect.apply(SIZE, output.buffer, []) !== output.length || output.length === 0) {
			throw new TypeError('Image container consumer detached its scoped output.');
		}
		outcome = { value: result };
	} catch (error) { outcome = { error }; }
	const failures: unknown[] = 'error' in outcome ? [outcome.error] : [];
	try { tiff?.fill(0); } catch (error) { failures.push(error); }
	try {
		if (profiled && backing) {
			if (Reflect.apply(SIZE, backing, []) !== allocated) throw new TypeError('Image container scoped output detached before physical retirement.');
			new Uint8Array(backing).fill(0);
		} else if (output && Reflect.apply(SIZE, output.buffer, []) !== 0) output.fill(0);
	} catch (error) { failures.push(error); }
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'Image container operation and physical retirement failed.', { cause: failures[0] });
	if ('value' in outcome) return outcome.value;
	throw new Error('Image container scope has no outcome.');
}

function readBytes(value: unknown, profiled: boolean): Uint8Array<ArrayBuffer> {
	if (!ArrayBuffer.isView(value) || Object.getPrototypeOf(value) !== Uint8Array.prototype
		|| ['buffer', 'length', 'byteLength', 'byteOffset'].some(key => Object.hasOwn(value, key))) throw new TypeError('Image container input requires intrinsic bytes.');
	const bytes = value as Uint8Array, buffer = bytes.buffer;
	if (Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype || Reflect.apply(RESIZABLE, buffer, [])) throw new TypeError('Image container input requires a fixed ArrayBuffer.');
	if (profiled && Reflect.apply(SIZE, buffer, []) > IMAGE_EXIF_CONTAINER_MAXIMUM_BYTES_V1) throw new RangeError('Image container input physical backing exceeds its byte ceiling.');
	let view: Uint8Array<ArrayBuffer>;
	try { view = new Uint8Array(buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength); }
	catch { throw new TypeError('Image container input is detached.'); }
	positive(view.length, IMAGE_EXIF_CONTAINER_MAXIMUM_BYTES_V1); return view;
}
async function pngInsertion(bytes: Uint8Array, width: number, height: number, current: () => void,
	policy: 'legacy1' | 'current1' | 'output1', color: 'srgb' | 'display-p3', depth: unknown): Promise<number> {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), budget = new MetadataBudget();
	if (!matchesBytes(bytes, 0, SIGNATURE)) refuse();
	let offset = 8, insertion = 0, header = false, tagged = false, image = false, nextYield = SPAN;
	while (offset < bytes.length) {
		if (offset >= nextYield) { await yieldTask(); current(); nextYield = offset + SPAN; }
		current(); budget.addRecord(); if (bytes.length - offset < 12) refuse();
		const length = view.getUint32(offset), end = offset + length + 12;
		if (length > 0x7fffffff || end > bytes.length) refuse();
		const expectedCrc = view.getUint32(end - 4), actualCrc = await crcSpan(bytes.subarray(offset + 4, end - 4), current);
		current(); if (expectedCrc !== actualCrc) refuse();
		const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
		if (type === 'IHDR') {
			if (header || offset !== 8 || length !== 13 || view.getUint32(offset + 8) !== width || view.getUint32(offset + 12) !== height
				|| !(policy === 'output1' ? bytes[offset + 16] === depth : bytes[offset + 16] === 8 || policy === 'current1' && bytes[offset + 16] === 16)
				|| !matchesBytes(bytes, offset + 17, [6, 0, 0, 0])) refuse();
			header = true;
		} else if (type === 'sRGB') {
			if (color !== 'srgb' || !header || tagged || image || length !== 1 || bytes[offset + 8]! > 3) refuse(); tagged = true;
		} else if (type === 'cICP') {
			if (policy !== 'output1' || color !== 'display-p3' || !header || tagged || image || length !== 4
				|| !matchesBytes(bytes, offset + 8, [12, 13, 0, 1])) refuse(); tagged = true;
		} else if (type === 'IDAT') {
			if (!header || !tagged || length === 0) refuse(); if (!image) insertion = offset; image = true;
		} else if (type === 'IEND') {
			if (!image || length !== 0 || end !== bytes.length) refuse(); return insertion;
		} else refuse(); // Existing metadata and unknown chunks cannot acquire export custody.
		offset = end;
	}
	refuse();
}
async function jpegInsertion(bytes: Uint8Array, width: number, height: number, current: () => void): Promise<number> {
	if (!matchesBytes(bytes, 0, [255, 216])) refuse();
	const budget = new MetadataBudget(), seenIcc = new Set<number>();
	let offset = 2, insertion = 2, frame = false, scan = false, entropy = false, jfif = false, iccCount = 0, nextYield = SPAN;
	while (offset < bytes.length) {
		current(); if (offset >= nextYield) { await yieldTask(); current(); nextYield = offset + SPAN; }
		if (entropy && bytes[offset] !== 255) {
			const end = Math.min(nextYield, bytes.length);
			while (offset < end && bytes[offset] !== 255) offset++;
			continue;
		}
		if (bytes[offset++] !== 255) refuse();
		while (bytes[offset] === 255) {
			offset++; if (offset >= bytes.length) refuse();
			if (offset >= nextYield) { await yieldTask(); current(); nextYield = offset + SPAN; }
		}
		const marker = bytes[offset++];
		if (entropy && (marker === 0 || (marker !== undefined && marker >= 0xd0 && marker <= 0xd7))) continue;
		entropy = false; budget.addRecord();
		if (marker === 0xd9) { if (!frame || !scan || offset !== bytes.length || seenIcc.size !== iccCount) refuse(); return insertion; }
		if (marker === undefined || marker === 0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) refuse();
		if (marker === 1) continue;
		if (bytes.length - offset < 2) refuse();
		const length = (bytes[offset]! << 8) | bytes[offset + 1]!, end = offset + length;
		if (length < 2 || end > bytes.length) refuse();
		if (marker >= 0xe0 && marker <= 0xef || marker === 0xfe) {
			if (scan) refuse();
			if (marker === 0xe0) {
				if (jfif || offset !== 4 || length !== 16 || !matchesBytes(bytes, offset + 2, JFIF) || bytes[end - 2] !== 0 || bytes[end - 1] !== 0) refuse();
				jfif = true; insertion = end;
			} else if (marker === 0xe2) {
				const sequence = bytes[offset + 14]!, count = bytes[offset + 15]!;
				if (length < 16 || !matchesBytes(bytes, offset + 2, ICC) || !sequence || !count || sequence > count || seenIcc.has(sequence)
					|| iccCount && iccCount !== count) refuse(); seenIcc.add(sequence); iccCount = count;
			} else refuse();
		} else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
			const components = bytes[offset + 7]!;
			if (frame || ![0xc0, 0xc1, 0xc2].includes(marker) || length < 11 || bytes[offset + 2] !== 8 || ![1, 3].includes(components)
				|| length !== 8 + components * 3 || ((bytes[offset + 3]! << 8) | bytes[offset + 4]!) !== height
				|| ((bytes[offset + 5]! << 8) | bytes[offset + 6]!) !== width) refuse(); frame = true;
		} else if (marker === 0xda) {
			const components = bytes[offset + 2]!;
			if (!frame || ![1, 2, 3].includes(components) || length !== 6 + components * 2 || end >= bytes.length - 2) refuse(); scan = true; entropy = true;
		} else if (![0xc4, 0xcc, 0xdb, 0xdd].includes(marker)) refuse();
		offset = end;
	}
	refuse();
}
async function crcSpan(bytes: Uint8Array, current: () => void): Promise<number> {
	let crc = 0;
	for (let offset = 0; offset < bytes.length; offset += SPAN) {
		current(); crc = metadataCrc32(bytes.subarray(offset, Math.min(offset + SPAN, bytes.length)), crc);
		if (offset + SPAN < bytes.length) { await yieldTask(); current(); }
	}
	return crc;
}
async function copy(source: Uint8Array, output: Uint8Array, at: number, current: () => void): Promise<void> {
	for (let offset = 0; offset < source.length; offset += SPAN) {
		current(); output.set(source.subarray(offset, Math.min(offset + SPAN, source.length)), at + offset);
		if (offset + SPAN < source.length) { await yieldTask(); current(); }
	}
}
function yieldTask(): Promise<void> { return new Promise(resolve => { setTimeout(resolve, 0); }); }
function positive(value: unknown, maximum: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RangeError('Image container option exceeds its integer byte/geometry limits.'); return value;
}
function refuse(): never { throw new RangeError('Fresh image container markers, profile, geometry or checksum are invalid.'); }
