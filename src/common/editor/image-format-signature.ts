/* SPDX-License-Identifier: AGPL-3.0-only */

/** Byte-only raster family classification. This grants no decoder authority. */

export const REVIEWED_IMAGE_FORMATS = Object.freeze([
	'jpeg', 'png', 'gif', 'webp', 'bmp', 'dib', 'ico',
	'avif', 'heif', 'tiff', 'bigtiff', 'jpeg2000', 'jpeg-xl',
	'qoi', 'tga', 'pcx', 'psd', 'psb',
	'dng', 'cr2', 'cr3', 'nef', 'nrw', 'arw', 'sr2', 'raf', 'orf', 'rw2',
	'openexr',
] as const);

export type ReviewedImageFormat = (typeof REVIEWED_IMAGE_FORMATS)[number];

export const EXCLUDED_IMAGE_FORMATS = Object.freeze([
	'svg', 'pdf', 'postscript', 'xcf', 'dicom', 'dds', 'ktx',
	'pnm', 'pfm', 'radiance-hdr', 'zip-container',
] as const);

export type ExcludedImageFormat = (typeof EXCLUDED_IMAGE_FORMATS)[number];

export type ImageFormatSignatureClassification =
	| Readonly<{ status: 'recognized'; format: ReviewedImageFormat }>
	| Readonly<{ status: 'excluded'; format: ExcludedImageFormat }>
	| Readonly<{ status: 'unrecognized' }>;

const UNKNOWN = Object.freeze({ status: 'unrecognized' } as const);
const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JP2 = Uint8Array.of(0, 0, 0, 12, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a);
const JXL_CONTAINER = Uint8Array.of(0, 0, 0, 12, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a);
const KTX1 = Uint8Array.of(0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a);
const KTX2 = Uint8Array.of(0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a);
const QOI_END = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 1);
const TGA_FOOTER_SIGNATURE = 'TRUEVISION-XFILE.\0';
const UTF8 = new TextDecoder('utf-8', { fatal: false });

/**
 * Classify only structural bytes with a reviewed signature.
 *
 * Names and MIME hints are deliberately absent. TIFF remains the TIFF family
 * until its bounded IFD inspection can distinguish TIFF from DNG/NEF/ARW and
 * related RAW variants. A recognized family must still pass metadata, colour,
 * topology, resource, and decoder qualification before import.
 */
export function classifyImageFormatSignature(bytes: Uint8Array): ImageFormatSignatureClassification {
	if (!(bytes instanceof Uint8Array)) {
		throw new TypeError('Image signature classification requires Uint8Array bytes.');
	}

	const excluded = excludedSignature(bytes);
	if (excluded) return excludedResult(excluded);

	if (hasPrefix(bytes, JXL_CONTAINER) || hasPrefix(bytes, Uint8Array.of(0xff, 0x0a))) {
		return recognized('jpeg-xl');
	}
	if (hasPrefix(bytes, JP2) || hasPrefix(bytes, Uint8Array.of(0xff, 0x4f, 0xff, 0x51))) {
		return recognized('jpeg2000');
	}
	if (hasPrefix(bytes, PNG)) return recognized('png');
	if (hasAscii(bytes, 0, 'GIF87a') || hasAscii(bytes, 0, 'GIF89a')) return recognized('gif');
	if (validWebp(bytes)) return recognized('webp');
	if (validJpeg(bytes)) return recognized('jpeg');
	if (validCr2(bytes)) return recognized('cr2');
	if (hasAscii(bytes, 0, 'FUJIFILMCCD-RAW ')) return recognized('raf');
	if (hasAscii(bytes, 0, 'IIRO') || hasAscii(bytes, 0, 'IIRS')) return recognized('orf');
	if (hasAscii(bytes, 0, 'IIU\0')) return recognized('rw2');

	const brands = isoBmffBrands(bytes);
	if (brands) {
		if (brands.includes('crx ')) return recognized('cr3');
		if (brands.some((brand) => brand === 'avif' || brand === 'avis')) return recognized('avif');
		if (brands.some(isHeifBrand)) return recognized('heif');
		return UNKNOWN;
	}

	const tiff = tiffFamily(bytes);
	if (tiff) return recognized(tiff);
	if (validBitmapFile(bytes)) return recognized('bmp');
	if (validIcon(bytes)) return recognized('ico');
	if (validQoi(bytes)) return recognized('qoi');
	if (validPhotoshop(bytes, 1)) return recognized('psd');
	if (validPhotoshop(bytes, 2)) return recognized('psb');
	if (validOpenExr(bytes)) return recognized('openexr');
	if (validPcx(bytes)) return recognized('pcx');
	if (validTga(bytes)) return recognized('tga');
	if (validDib(bytes, 0)) return recognized('dib');
	return UNKNOWN;
}

function recognized(format: ReviewedImageFormat): ImageFormatSignatureClassification {
	return Object.freeze({ status: 'recognized', format });
}

function excludedResult(format: ExcludedImageFormat): ImageFormatSignatureClassification {
	return Object.freeze({ status: 'excluded', format });
}

function excludedSignature(bytes: Uint8Array): ExcludedImageFormat | null {
	if (hasAscii(bytes, 0, '%PDF-')) return 'pdf';
	if (hasAscii(bytes, 0, '%!PS-Adobe-')) return 'postscript';
	if (hasAscii(bytes, 0, 'gimp xcf ')) return 'xcf';
	if (bytes.byteLength >= 132 && hasAscii(bytes, 128, 'DICM')) return 'dicom';
	if (hasAscii(bytes, 0, 'DDS ')) return 'dds';
	if (hasPrefix(bytes, KTX1) || hasPrefix(bytes, KTX2)) return 'ktx';
	if (hasAscii(bytes, 0, '#?RADIANCE') || hasAscii(bytes, 0, '#?RGBE')) return 'radiance-hdr';
	if (hasAscii(bytes, 0, 'PF\n') || hasAscii(bytes, 0, 'Pf\n')
		|| hasAscii(bytes, 0, 'PF\r') || hasAscii(bytes, 0, 'Pf\r')) return 'pfm';
	if (bytes.byteLength >= 3 && bytes[0] === 0x50 && bytes[1]! >= 0x31 && bytes[1]! <= 0x37
		&& isAsciiWhitespace(bytes[2]!)) return 'pnm';
	if (hasPrefix(bytes, Uint8Array.of(0x50, 0x4b, 0x03, 0x04))
		|| hasPrefix(bytes, Uint8Array.of(0x50, 0x4b, 0x05, 0x06))
		|| hasPrefix(bytes, Uint8Array.of(0x50, 0x4b, 0x07, 0x08))) return 'zip-container';
	if (looksLikeSvg(bytes)) return 'svg';
	return null;
}

function validJpeg(bytes: Uint8Array): boolean {
	return bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
		&& bytes[3] !== 0x00 && bytes[3] !== 0xff;
}

function validWebp(bytes: Uint8Array): boolean {
	if (bytes.byteLength < 20 || !hasAscii(bytes, 0, 'RIFF') || !hasAscii(bytes, 8, 'WEBP')) return false;
	const declared = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
	if (declared + 8 !== bytes.byteLength || declared < 12) return false;
	return hasAscii(bytes, 12, 'VP8 ') || hasAscii(bytes, 12, 'VP8L') || hasAscii(bytes, 12, 'VP8X');
}

function validBitmapFile(bytes: Uint8Array): boolean {
	if (bytes.byteLength < 26 || !hasAscii(bytes, 0, 'BM') || !validDib(bytes, 14)) return false;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const declared = view.getUint32(2, true);
	const pixelOffset = view.getUint32(10, true);
	const dibBytes = view.getUint32(14, true);
	return declared === bytes.byteLength && pixelOffset >= 14 + dibBytes && pixelOffset <= bytes.byteLength;
}

function validDib(bytes: Uint8Array, offset: number): boolean {
	if (bytes.byteLength - offset < 12) return false;
	const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
	const headerBytes = view.getUint32(0, true);
	if (![12, 40, 52, 56, 64, 108, 124].includes(headerBytes)
		|| headerBytes > bytes.byteLength - offset) return false;
	if (headerBytes === 12) {
		return view.getUint16(4, true) > 0 && view.getUint16(6, true) > 0
			&& view.getUint16(8, true) === 1 && validBitmapDepth(view.getUint16(10, true));
	}
	const width = view.getInt32(4, true);
	const height = view.getInt32(8, true);
	const compression = view.getUint32(16, true);
	return width > 0 && height !== 0 && view.getUint16(12, true) === 1
		&& validBitmapDepth(view.getUint16(14, true)) && compression <= 13;
}

function validBitmapDepth(value: number): boolean {
	return [1, 2, 4, 8, 16, 24, 32].includes(value);
}

function validIcon(bytes: Uint8Array): boolean {
	if (bytes.byteLength < 22) return false;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const count = view.getUint16(4, true);
	if (view.getUint16(0, true) !== 0 || view.getUint16(2, true) !== 1
		|| count < 1 || count > 4_096 || 6 + count * 16 > bytes.byteLength) return false;
	for (let index = 0; index < count; index += 1) {
		const offset = 6 + index * 16;
		const length = view.getUint32(offset + 8, true);
		const payload = view.getUint32(offset + 12, true);
		if (bytes[offset + 3] !== 0 || length < 1 || payload < 6 + count * 16
			|| payload + length > bytes.byteLength) return false;
	}
	return true;
}

function isoBmffBrands(bytes: Uint8Array): readonly string[] | null {
	if (bytes.byteLength < 16 || !hasAscii(bytes, 4, 'ftyp')) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const size = view.getUint32(0);
	if (size < 16 || size > bytes.byteLength || (size - 16) % 4 !== 0) return null;
	const brands = [ascii(bytes, 8, 4)];
	for (let offset = 16; offset < size; offset += 4) brands.push(ascii(bytes, offset, 4));
	return Object.freeze(brands);
}

function isHeifBrand(brand: string): boolean {
	return ['mif1', 'msf1', 'miaf', 'heic', 'heix', 'hevc', 'hevx', 'heis', 'heim'].includes(brand);
}

function tiffFamily(bytes: Uint8Array): 'tiff' | 'bigtiff' | null {
	if (bytes.byteLength < 8) return null;
	const little = hasAscii(bytes, 0, 'II');
	const big = hasAscii(bytes, 0, 'MM');
	if (!little && !big) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const order = little;
	const version = view.getUint16(2, order);
	if (version === 42 && view.getUint32(4, order) >= 8) return 'tiff';
	if (version === 43 && bytes.byteLength >= 12 && view.getUint16(4, order) === 8
		&& view.getUint16(6, order) === 0) return 'bigtiff';
	return null;
}

function validCr2(bytes: Uint8Array): boolean {
	return bytes.byteLength >= 12 && hasAscii(bytes, 0, 'II') && bytes[2] === 42 && bytes[3] === 0
		&& hasAscii(bytes, 8, 'CR') && bytes[10] === 2 && bytes[11] === 0;
}

function validQoi(bytes: Uint8Array): boolean {
	if (bytes.byteLength < 22 || !hasAscii(bytes, 0, 'qoif') || !hasSuffix(bytes, QOI_END)) return false;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return view.getUint32(4) > 0 && view.getUint32(8) > 0
		&& (bytes[12] === 3 || bytes[12] === 4) && (bytes[13] === 0 || bytes[13] === 1);
}

function validTga(bytes: Uint8Array): boolean {
	if (bytes.byteLength < 44 || !hasAscii(bytes, bytes.byteLength - 18, TGA_FOOTER_SIGNATURE)) return false;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return (bytes[1] === 0 || bytes[1] === 1)
		&& [1, 2, 3, 9, 10, 11].includes(bytes[2]!)
		&& view.getUint16(12, true) > 0 && view.getUint16(14, true) > 0
		&& [8, 15, 16, 24, 32].includes(bytes[16]!);
}

function validPcx(bytes: Uint8Array): boolean {
	if (bytes.byteLength < 128 || bytes[0] !== 0x0a || ![0, 2, 3, 4, 5].includes(bytes[1]!)
		|| ![0, 1].includes(bytes[2]!) || ![1, 2, 4, 8].includes(bytes[3]!) || bytes[64] !== 0
		|| bytes[65]! < 1 || bytes[65]! > 4) return false;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return view.getUint16(8, true) >= view.getUint16(4, true)
		&& view.getUint16(10, true) >= view.getUint16(6, true)
		&& view.getUint16(66, true) > 0;
}

function validPhotoshop(bytes: Uint8Array, version: 1 | 2): boolean {
	if (bytes.byteLength < 26 || !hasAscii(bytes, 0, '8BPS')) return false;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return view.getUint16(4) === version && bytes.subarray(6, 12).every((value) => value === 0)
		&& view.getUint16(12) >= 1 && view.getUint16(12) <= 56
		&& view.getUint32(14) > 0 && view.getUint32(18) > 0
		&& [1, 8, 16, 32].includes(view.getUint16(22)) && view.getUint16(24) <= 9;
}

function validOpenExr(bytes: Uint8Array): boolean {
	return bytes.byteLength >= 8 && bytes[0] === 0x76 && bytes[1] === 0x2f
		&& bytes[2] === 0x31 && bytes[3] === 0x01 && (bytes[4] === 1 || bytes[4] === 2);
}

function looksLikeSvg(bytes: Uint8Array): boolean {
	const prefix = UTF8.decode(bytes.subarray(0, Math.min(bytes.byteLength, 1_024)))
		.replace(/^\uFEFF/u, '').trimStart().toLowerCase();
	return prefix.startsWith('<svg') || (prefix.startsWith('<?xml') && prefix.includes('<svg'));
}

function hasPrefix(bytes: Uint8Array, prefix: Uint8Array): boolean {
	return prefix.byteLength <= bytes.byteLength && prefix.every((value, index) => bytes[index] === value);
}

function hasSuffix(bytes: Uint8Array, suffix: Uint8Array): boolean {
	const offset = bytes.byteLength - suffix.byteLength;
	return offset >= 0 && suffix.every((value, index) => bytes[offset + index] === value);
}

function hasAscii(bytes: Uint8Array, offset: number, value: string): boolean {
	if (offset < 0 || offset + value.length > bytes.byteLength) return false;
	for (let index = 0; index < value.length; index += 1) {
		if (bytes[offset + index] !== value.charCodeAt(index)) return false;
	}
	return true;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	let value = '';
	for (let index = 0; index < length; index += 1) value += String.fromCharCode(bytes[offset + index]!);
	return value;
}

function isAsciiWhitespace(value: number): boolean {
	return value === 0x09 || value === 0x0a || value === 0x0c || value === 0x0d || value === 0x20;
}
