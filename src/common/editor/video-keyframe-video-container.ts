/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoKeyframeEncoderFormat } from './video-keyframe-encoder-admission.ts';

const MAXIMUM_CONTAINER_ELEMENTS = 65_536;
const WEBM_EBML = 0x1a45dfa3;
const WEBM_SEGMENT = 0x18538067;
const WEBM_DOCTYPE = 0x4282;
const WEBM_TRACKS = 0x1654ae6b;
const WEBM_CLUSTER = 0x1f43b675;

/** Verify finite container structure only; this is not codec or decoder validation. */
export function assertFiniteVideoKeyframeContainer(
	bytes: Uint8Array,
	format: VideoKeyframeEncoderFormat,
): void {
	if (format === 'mp4') assertFiniteMp4(bytes);
	else assertFiniteWebm(bytes);
}

function assertFiniteMp4(bytes: Uint8Array): void {
	let offset = 0;
	let boxes = 0;
	let hasFtyp = false;
	let hasMovieStructure = false;
	let hasMediaData = false;
	while (offset < bytes.byteLength) {
		boxes += 1;
		if (boxes > MAXIMUM_CONTAINER_ELEMENTS || bytes.byteLength - offset < 8) invalidMp4();
		const compactSize = uint32(bytes, offset);
		const type = ascii(bytes, offset + 4, 4);
		let headerBytes = 8;
		let boxBytes: number;
		if (compactSize === 1) {
			if (bytes.byteLength - offset < 16) invalidMp4();
			headerBytes = 16;
			boxBytes = safeBigEndianInteger(bytes, offset + 8, 8, invalidMp4);
		} else if (compactSize === 0) {
			boxBytes = bytes.byteLength - offset;
		} else {
			boxBytes = compactSize;
		}
		if (boxBytes < headerBytes || boxBytes > bytes.byteLength - offset) invalidMp4();
		const payloadBytes = boxBytes - headerBytes;
		if (boxes === 1) {
			if (type !== 'ftyp' || payloadBytes < 8) invalidMp4();
			hasFtyp = true;
		} else if (type === 'ftyp') {
			invalidMp4();
		}
		if ((type === 'moov' || type === 'moof') && payloadBytes > 0) hasMovieStructure = true;
		if (type === 'mdat' && payloadBytes > 0) hasMediaData = true;
		offset += boxBytes;
	}
	if (!hasFtyp || !hasMovieStructure || !hasMediaData || offset !== bytes.byteLength) invalidMp4();
}

function assertFiniteWebm(bytes: Uint8Array): void {
	let elements = 0;
	const header = ebmlElement(bytes, 0, bytes.byteLength, () => {
		elements += 1;
		if (elements > MAXIMUM_CONTAINER_ELEMENTS) invalidWebm();
	});
	if (header.id !== WEBM_EBML || header.payloadBytes === 0) invalidWebm();
	let hasWebmDocType = false;
	forEachEbmlChild(bytes, header, () => { elements += 1; }, (child) => {
		if (child.id === WEBM_DOCTYPE
			&& ascii(bytes, child.payloadOffset, child.payloadBytes) === 'webm') {
			hasWebmDocType = true;
		}
	});
	if (!hasWebmDocType) invalidWebm();
	const segment = ebmlElement(bytes, header.end, bytes.byteLength, () => {
		elements += 1;
		if (elements > MAXIMUM_CONTAINER_ELEMENTS) invalidWebm();
	});
	if (segment.id !== WEBM_SEGMENT || segment.end !== bytes.byteLength) invalidWebm();
	let hasTracks = false;
	let hasCluster = false;
	forEachEbmlChild(bytes, segment, () => {
		elements += 1;
		if (elements > MAXIMUM_CONTAINER_ELEMENTS) invalidWebm();
	}, (child) => {
		if (child.id === WEBM_TRACKS && child.payloadBytes > 0) hasTracks = true;
		if (child.id === WEBM_CLUSTER && child.payloadBytes > 0) hasCluster = true;
	});
	if (!hasTracks || !hasCluster) invalidWebm();
}

interface EbmlElement {
	readonly id: number;
	readonly payloadOffset: number;
	readonly payloadBytes: number;
	readonly end: number;
}

function ebmlElement(
	bytes: Uint8Array,
	offset: number,
	limit: number,
	count: () => void,
): EbmlElement {
	count();
	const id = ebmlVint(bytes, offset, limit, false);
	const size = ebmlVint(bytes, offset + id.length, limit, true);
	if (size.unknown) invalidWebm();
	const payloadOffset = offset + id.length + size.length;
	if (size.value > limit - payloadOffset) invalidWebm();
	return Object.freeze({
		id: id.value,
		payloadOffset,
		payloadBytes: size.value,
		end: payloadOffset + size.value,
	});
}

function forEachEbmlChild(
	bytes: Uint8Array,
	parent: EbmlElement,
	count: () => void,
	visit: (child: EbmlElement) => void,
): void {
	let offset = parent.payloadOffset;
	while (offset < parent.end) {
		const child = ebmlElement(bytes, offset, parent.end, count);
		visit(child);
		offset = child.end;
	}
	if (offset !== parent.end) invalidWebm();
}

function ebmlVint(
	bytes: Uint8Array,
	offset: number,
	limit: number,
	isSize: boolean,
): Readonly<{ length: number; value: number; unknown: boolean }> {
	if (offset >= limit) invalidWebm();
	const first = bytes[offset];
	let marker = 0x80;
	let length = 1;
	while (length <= 8 && (first & marker) === 0) {
		marker >>= 1;
		length += 1;
	}
	if (length > (isSize ? 8 : 4) || offset + length > limit) invalidWebm();
	let value = BigInt(isSize ? first & (marker - 1) : first);
	for (let index = 1; index < length; index += 1) {
		value = (value << 8n) | BigInt(bytes[offset + index]);
	}
	const unknown = isSize && value === (1n << BigInt(7 * length)) - 1n;
	if (value > BigInt(Number.MAX_SAFE_INTEGER)) invalidWebm();
	return Object.freeze({ length, value: Number(value), unknown });
}

function uint32(bytes: Uint8Array, offset: number): number {
	return (bytes[offset] * 0x1000000)
		+ (bytes[offset + 1] * 0x10000)
		+ (bytes[offset + 2] * 0x100)
		+ bytes[offset + 3];
}

function safeBigEndianInteger(
	bytes: Uint8Array,
	offset: number,
	length: number,
	invalid: () => never,
): number {
	let value = 0n;
	for (let index = 0; index < length; index += 1) {
		value = (value << 8n) | BigInt(bytes[offset + index]);
	}
	if (value > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
	return Number(value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	let result = '';
	for (let index = 0; index < length; index += 1) {
		const value = bytes[offset + index];
		if (value < 0x20 || value > 0x7e) return '';
		result += String.fromCharCode(value);
	}
	return result;
}

function invalidMp4(): never {
	throw new TypeError('Video keyframe export is not a finite MP4 container with media structure.');
}

function invalidWebm(): never {
	throw new TypeError('Video keyframe export is not a finite WebM container with media structure.');
}
