/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ReviewedImageFormat } from './image-format-signature.ts';

/** A static bitmap cannot verify the encoded PNG, GIF or WebP animation route. */
export function encodedImageIsAnimated(bytes: Uint8Array, format: ReviewedImageFormat): boolean {
	if (format === 'png') return animatedPng(bytes);
	if (format === 'webp') return animatedWebP(bytes);
	if (format === 'gif') return animatedGif(bytes);
	return false;
}

function animatedPng(bytes: Uint8Array): boolean {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let offset = 8; offset + 12 <= bytes.byteLength;) {
		const length = view.getUint32(offset);
		if (offset + 12 + length > bytes.byteLength) return false;
		if (ascii(bytes, offset + 4, 'acTL') && length >= 8) return view.getUint32(offset + 8) > 1;
		offset += 12 + length;
	}
	return false;
}

function animatedWebP(bytes: Uint8Array): boolean {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let offset = 12; offset + 8 <= bytes.byteLength;) {
		const length = view.getUint32(offset + 4, true);
		if (offset + 8 + length > bytes.byteLength) return false;
		if (ascii(bytes, offset, 'ANIM') || (ascii(bytes, offset, 'VP8X')
			&& length >= 1 && (bytes[offset + 8]! & 2) !== 0)) return true;
		offset += 8 + length + (length & 1);
	}
	return false;
}

function animatedGif(bytes: Uint8Array): boolean {
	if (bytes.byteLength < 13) return false;
	let offset = 13 + tableBytes(bytes[10]!);
	let frames = 0;
	while (offset < bytes.byteLength) {
		const block = bytes[offset]!;
		if (block === 0x3b) return false;
		if (block === 0x21) {
			offset = skipSubBlocks(bytes, offset + 2);
		} else if (block === 0x2c) {
			if (offset + 10 > bytes.byteLength) return false;
			frames += 1;
			if (frames > 1) return true;
			offset = skipSubBlocks(bytes, offset + 11 + tableBytes(bytes[offset + 9]!));
		} else return false;
	}
	return false;
}

function tableBytes(packed: number): number {
	return (packed & 0x80) !== 0 ? 3 * 2 ** ((packed & 7) + 1) : 0;
}

function skipSubBlocks(bytes: Uint8Array, start: number): number {
	let offset = start;
	while (offset < bytes.byteLength) {
		const length = bytes[offset]!;
		offset += 1 + length;
		if (length === 0) return offset;
	}
	return bytes.byteLength;
}

function ascii(bytes: Uint8Array, offset: number, value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		if (bytes[offset + index] !== value.charCodeAt(index)) return false;
	}
	return true;
}
