/* SPDX-License-Identifier: AGPL-3.0-only */

import { classifyImageFormatSignature } from '../../common/editor/image-format-signature.ts';
import { admitImageDecodeWorkload } from '../../common/editor/image-import-admission.ts';
import { MetadataBudget, metadataCrc32, readMetadataInput } from '../../common/editor/imaging/image-metadata-binary.ts';
import { admitExifSrgbDeclarationsV1 } from '../../common/editor/imaging/exif-color-admission-v1.ts';

export type PhotoNativeFormatV1 = 'jpeg' | 'png' | 'gif' | 'webp' | 'bmp';
export interface PhotoSourceAdmissionV1 { readonly format: PhotoNativeFormatV1; readonly width: number; readonly height: number }

/** Prove bounded static SDR structure before a fallback can silently choose frame zero. */
export function admitPhotoSourceV1(value: unknown): Readonly<PhotoSourceAdmissionV1> {
	const bytes = readMetadataInput(value);
	const classification = classifyImageFormatSignature(bytes);
	if (classification.status !== 'recognized') refuse('Unsupported photo signature.');
	const format = classification.format;
	let size: readonly [number, number];
	if (format === 'png') size = png(bytes);
	else if (format === 'jpeg') size = jpeg(bytes);
	else if (format === 'gif') size = gif(bytes);
	else if (format === 'webp') size = webp(bytes);
	else if (format === 'bmp') size = bmp(bytes);
	else refuse(`No verified static photo consumer for ${format}.`);
	const [width, height] = size;
	admitImageDecodeWorkload({ sourceByteLength: bytes.length, width, height, precision: 'sdr', frameCount: 1,
		durationMicroseconds: 1, iccBytes: 0, metadataBytes: 0 });
	return Object.freeze({ format, width, height });
}

function png(bytes: Uint8Array): readonly [number, number] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const budget = new MetadataBudget();
	let offset = 8, width = 0, height = 0, data = false, endedData = false;
	const seen = new Set<string>();
	while (offset < bytes.length) {
		budget.addRecord(); range(bytes, offset, 12);
		const length = view.getUint32(offset), type = ascii(bytes, offset + 4, 4);
		range(bytes, offset + 8, length + 4);
		if (!/^[A-Za-z]{4}$/u.test(type)) refuse('Invalid PNG chunk type.');
		if (type !== 'IDAT') budget.addBytes(length);
		if (type !== 'IDAT' && metadataCrc32(bytes.subarray(offset + 4, offset + 8 + length)) !== view.getUint32(offset + 8 + length)) refuse('Invalid PNG header CRC.');
		const body = offset + 8;
		if (offset === 8 && type !== 'IHDR') refuse('PNG requires IHDR first.');
		if (type === 'IHDR') {
			if (seen.has(type) || length !== 13) refuse('Invalid PNG IHDR.');
			width = view.getUint32(body); height = view.getUint32(body + 4);
			const depth = bytes[body + 8]!, colour = bytes[body + 9]!;
			const depths: Readonly<Record<number, readonly number[]>> = { 0: [1, 2, 4, 8], 2: [8], 3: [1, 2, 4, 8], 4: [8], 6: [8] };
			if (!depths[colour]?.includes(depth) || bytes[body + 10] !== 0 || bytes[body + 11] !== 0 || bytes[body + 12]! > 1) refuse('PNG precision or coding is not admitted.');
		} else if (['acTL', 'fcTL', 'fdAT'].includes(type)) refuse('Animated PNG is not a static photo.');
		else if (['iCCP', 'mDCV', 'cLLI'].includes(type)) refuse('PNG profile/HDR declaration is not admitted.');
		else if (type === 'cICP' && (length !== 4 || ascii(bytes, body, 4) !== String.fromCharCode(1, 13, 0, 1))) refuse('PNG colour declaration is not sRGB SDR.');
		else if (type === 'gAMA' && (length !== 4 || view.getUint32(body) !== 45_455)) refuse('PNG gamma declaration is not admitted.');
		else if (type === 'cHRM') {
			const srgb = [31_270, 32_900, 64_000, 33_000, 30_000, 60_000, 15_000, 6_000];
			if (length !== 32 || srgb.some((value, index) => view.getUint32(body + index * 4) !== value)) refuse('PNG primaries are not admitted.');
		} else if (type === 'sRGB' && (length !== 1 || bytes[body]! > 3)) refuse('Invalid PNG sRGB declaration.');
		else if (type === 'eXIf') admitExifSrgbDeclarationsV1(bytes.subarray(body, body + length));
		else if (type === 'IDAT') { if (endedData) refuse('PNG IDAT must be consecutive.'); data = true; }
		else if (type === 'IEND') {
			if (length !== 0 || !data || offset + 12 !== bytes.length) refuse('Invalid PNG ending.');
			return [width, height];
		} else if (type[0] === type[0]!.toUpperCase() && type !== 'PLTE') refuse('Unknown critical PNG chunk.');
		if (data && type !== 'IDAT') endedData = true;
		if (seen.has(type) && ['IHDR', 'PLTE', 'sRGB', 'gAMA', 'cHRM', 'cICP', 'eXIf'].includes(type)) refuse('Duplicate PNG declaration.');
		seen.add(type); offset += length + 12;
	}
	return refuse('Truncated PNG.');
}

function jpeg(bytes: Uint8Array): readonly [number, number] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), budget = new MetadataBudget();
	let offset = 2, width = 0, height = 0, scan = false;
	while (offset < bytes.length) {
		if (scan && bytes[offset] !== 0xff) { offset++; continue; }
		if (bytes[offset++] !== 0xff) refuse('Invalid JPEG marker.');
		while (bytes[offset] === 0xff) offset++;
		range(bytes, offset, 1); const marker = bytes[offset++]!;
		if (scan && (marker === 0 || marker >= 0xd0 && marker <= 0xd7)) continue;
		budget.addRecord();
		if (marker === 0xd9) {
			if (!scan || width === 0 || offset !== bytes.length) refuse('JPEG requires one complete image.');
			return [width, height];
		}
		if (marker === 0xd8 || marker === 0 || marker === 1) refuse('Unsupported JPEG topology.');
		range(bytes, offset, 2); const length = view.getUint16(offset); if (length < 2) refuse('Invalid JPEG segment.');
		range(bytes, offset, length); const body = offset + 2;
		if (marker >= 0xe0 || marker === 0xfe) budget.addBytes(length - 2);
		if (marker === 0xe1 && length >= 8 && ascii(bytes, body, 6) === 'Exif\0\0') admitExifSrgbDeclarationsV1(bytes.subarray(body + 6, offset + length));
		if (marker === 0xe2 && (ascii(bytes, body, Math.min(12, length - 2)).startsWith('ICC_PROFILE') || ascii(bytes, body, Math.min(4, length - 2)) === 'MPF\0')) refuse('JPEG profile or multipicture declaration is not admitted.');
		if (marker === 0xeb) refuse('JPEG extension/profile is not admitted.');
		if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
			if (![0xc0, 0xc1, 0xc2].includes(marker) || width !== 0 || length < 8 || bytes[body] !== 8 || ![1, 3].includes(bytes[body + 5]!)) refuse('JPEG precision or components are not admitted.');
			height = view.getUint16(body + 1); width = view.getUint16(body + 3);
			if (length !== 8 + bytes[body + 5]! * 3) refuse('Invalid JPEG frame header.');
		}
		if (marker === 0xda) scan = true;
		offset += length;
	}
	return refuse('Truncated JPEG.');
}

function gif(bytes: Uint8Array): readonly [number, number] {
	range(bytes, 0, 13); const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), budget = new MetadataBudget();
	const width = view.getUint16(6, true), height = view.getUint16(8, true);
	let offset = 13, frames = 0;
	if (bytes[10]! & 0x80) offset += 3 * (1 << ((bytes[10]! & 7) + 1));
	range(bytes, 0, offset);
	while (offset < bytes.length) {
		budget.addRecord(); const tag = bytes[offset++]!;
		if (tag === 0x3b) { if (frames !== 1 || offset !== bytes.length) refuse('GIF requires one complete image.'); return [width, height]; }
		if (tag === 0x2c) {
			if (++frames > 1) refuse('Animated GIF is not a static photo.');
			range(bytes, offset, 9);
			if (view.getUint16(offset, true) + view.getUint16(offset + 4, true) > width || view.getUint16(offset + 2, true) + view.getUint16(offset + 6, true) > height) refuse('GIF image exceeds canvas.');
			const flags = bytes[offset + 8]!; offset += 9;
			if (flags & 0x80) offset += 3 * (1 << ((flags & 7) + 1));
			range(bytes, offset, 1); if (bytes[offset]! < 2 || bytes[offset]! > 8) refuse('Invalid GIF coding.'); offset++;
			offset = subblocks(bytes, offset, budget, false);
		} else if (tag === 0x21) {
			range(bytes, offset, 1); const label = bytes[offset++]!;
			if (label === 1) refuse('GIF plain-text graphics are not a static photo.');
			if (label === 0xff && ascii(bytes, offset + 1, Math.min(11, bytes.length - offset - 1)) === 'ICCRGBG1012') refuse('GIF profile is not admitted.');
			offset = subblocks(bytes, offset, budget, true);
		} else refuse('Invalid GIF block.');
	}
	return refuse('Truncated GIF.');
}

function subblocks(bytes: Uint8Array, start: number, budget: MetadataBudget, metadata: boolean): number {
	let offset = start;
	while (offset < bytes.length) {
		budget.addRecord(); const length = bytes[offset++]!; if (length === 0) return offset;
		range(bytes, offset, length); if (metadata) budget.addBytes(length); offset += length;
	}
	return refuse('Truncated GIF sub-blocks.');
}

function webp(bytes: Uint8Array): readonly [number, number] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), budget = new MetadataBudget();
	let offset = 12, width = 0, height = 0, images = 0;
	while (offset < bytes.length) {
		budget.addRecord(); range(bytes, offset, 8);
		const tag = ascii(bytes, offset, 4), length = view.getUint32(offset + 4, true), body = offset + 8;
		range(bytes, body, length + (length % 2));
		if (['ANIM', 'ANMF', 'ICCP', 'EXIF'].includes(tag)) refuse('WebP animation/profile/Exif route is not admitted.');
		if (tag === 'VP8X') {
			if (offset !== 12 || length !== 10 || bytes[body]! & 0x22) refuse('WebP declared topology/profile is not admitted.');
			width = uint24(bytes, body + 4) + 1; height = uint24(bytes, body + 7) + 1;
		} else if (tag === 'VP8 ' || tag === 'VP8L') {
			if (++images !== 1) refuse('WebP requires one image.');
			let w: number, h: number;
			if (tag === 'VP8 ') {
				if (length < 10 || bytes[body]! & 1 || ascii(bytes, body + 3, 3) !== '\x9d\x01\x2a') refuse('Invalid WebP key frame.');
				w = view.getUint16(body + 6, true) & 0x3fff; h = view.getUint16(body + 8, true) & 0x3fff;
			} else {
				if (length < 5 || bytes[body] !== 0x2f) refuse('Invalid WebP lossless header.');
				const packed = view.getUint32(body + 1, true); if (packed >>> 29) refuse('Unknown WebP lossless version.');
				w = (packed & 0x3fff) + 1; h = ((packed >>> 14) & 0x3fff) + 1;
			}
			if (width && (width !== w || height !== h)) refuse('WebP canvas and image disagree.');
			width = w; height = h;
		} else budget.addBytes(length);
		offset = body + length + length % 2;
	}
	if (images !== 1) refuse('WebP requires an image.'); return [width, height];
}

function bmp(bytes: Uint8Array): readonly [number, number] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), header = view.getUint32(14, true);
	if (header === 12) return [view.getUint16(18, true), view.getUint16(20, true)];
	if (![40, 52, 56, 108, 124].includes(header)) refuse('BMP header is not admitted.');
	if (view.getUint32(30, true) !== 0) refuse('Compressed/embedded BMP is not admitted.');
	if (header >= 108 && view.getUint32(70, true) !== 0x73524742) refuse('BMP colour profile is not sRGB.');
	return [view.getInt32(18, true), Math.abs(view.getInt32(22, true))];
}
function uint24(bytes: Uint8Array, offset: number): number { return bytes[offset]! | bytes[offset + 1]! << 8 | bytes[offset + 2]! << 16; }
function ascii(bytes: Uint8Array, offset: number, length: number): string { range(bytes, offset, length); return String.fromCharCode(...bytes.subarray(offset, offset + length)); }
function range(bytes: Uint8Array, offset: number, length: number): void { if (offset < 0 || length < 0 || offset > bytes.length - length) refuse('Truncated photo container.'); }
function refuse(message: string): never { throw new RangeError(message); }
