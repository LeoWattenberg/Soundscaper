/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeEmbeddedExportChapters, type EmbeddedExportChapter } from './export-embedded-chapters.ts';

const MAXIMUM_METADATA_BYTES = 16 * 1024 ** 2;
const UINT32_MAX = 0xffff_ffff;
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);

interface Box {
	readonly start: number;
	readonly end: number;
	readonly headerSize: number;
	readonly type: string;
}
interface Replacement { readonly start: number; readonly end: number; readonly bytes: Uint8Array<ArrayBuffer> }

/**
 * Add Nero chapters to native AAC mux output without reading its audio payload.
 *
 * The native muxer's fragments use moof-relative data offsets. Growing moov
 * leaves those relative offsets intact; flat-file sample offsets and the
 * fragment random-access index must move with the media boxes that follow it.
 */
export async function embedM4aChapters(
	blob: Blob,
	chapters: readonly EmbeddedExportChapter[],
	sampleRate: number,
	signal?: AbortSignal,
): Promise<Blob> {
	signal?.throwIfAborted();
	const normalized = normalizeEmbeddedExportChapters(chapters, sampleRate);
	if (normalized.length === 0) return blob;
	const chapterBox = neroChapterBox(normalized, sampleRate);
	const topLevel: Box[] = [];
	for (let offset = 0; offset < blob.size;) {
		const prefix = new Uint8Array(await blob.slice(offset, offset + 16).arrayBuffer());
		signal?.throwIfAborted();
		const box = readBox(prefix, 0, blob.size - offset, true);
		topLevel.push({ ...box, start: offset, end: offset + box.end });
		offset += box.end;
	}
	if (topLevel[0]?.type !== 'ftyp') invalid();
	const movies = topLevel.filter((box) => box.type === 'moov');
	if (movies.length !== 1) throw new RangeError('M4A chapter export requires exactly one moov movie box.');
	const movie = movies[0]!;
	const moov = await metadataBytes(blob, movie, signal);
	const movieHeader = readBox(moov, 0, moov.length);
	const userData = children(moov, movieHeader.headerSize, moov.length).filter((box) => box.type === 'udta');
	if (userData.length > 1) invalid();
	const udta = userData[0];
	if (udta && children(moov, udta.start + udta.headerSize, udta.end).some((box) => box.type === 'chpl')) {
		throw new RangeError('This M4A file already contains embedded chapters.');
	}
	const addition = udta ? chapterBox : atom('udta', chapterBox);
	const delta = addition.length;
	patchSampleOffsets(moov, movieHeader, movie.end, delta);
	const insertion = udta?.end ?? moov.length;
	const expanded = new Uint8Array(moov.length + delta);
	expanded.set(moov.subarray(0, insertion));
	expanded.set(addition, insertion);
	expanded.set(moov.subarray(insertion), insertion + delta);
	writeSize(expanded, movieHeader, expanded.length);
	if (udta) writeSize(expanded, udta, udta.end - udta.start + delta);
	const replacements: Replacement[] = [{ start: movie.start, end: movie.end, bytes: expanded }];
	for (const box of topLevel) {
		if (box.type !== 'mfra') continue;
		const bytes = await metadataBytes(blob, box, signal);
		patchFragmentOffsets(bytes, movie.end, delta);
		replacements.push({ start: box.start, end: box.end, bytes });
	}
	replacements.sort((left, right) => left.start - right.start);
	const parts: BlobPart[] = [];
	let offset = 0;
	for (const replacement of replacements) {
		parts.push(blob.slice(offset, replacement.start), replacement.bytes);
		offset = replacement.end;
	}
	parts.push(blob.slice(offset));
	signal?.throwIfAborted();
	return new Blob(parts, { type: blob.type || 'audio/mp4' });
}

function neroChapterBox(chapters: readonly EmbeddedExportChapter[], sampleRate: number): Uint8Array<ArrayBuffer> {
	// Nero's count and UTF-8 title length fields are each one byte. Reject names
	// that do not fit instead of silently dropping chapters or truncating UTF-8.
	if (chapters.length > 255) throw new RangeError('M4A Nero chapters support at most 255 chapters.');
	const titles = chapters.map(({ title }) => new TextEncoder().encode(title));
	if (titles.some((title) => title.length > 255)) throw new RangeError('M4A chapter titles support at most 255 UTF-8 bytes.');
	const body = new Uint8Array(9 + titles.reduce((size, title) => size + 9 + title.length, 0));
	const view = new DataView(body.buffer);
	view.setUint32(0, 0x0100_0000); // version 1, flags 0
	body[8] = chapters.length; // four reserved bytes precede the count
	let offset = 9;
	for (let index = 0; index < chapters.length; index += 1) {
		const ticks = (BigInt(chapters[index]!.startFrame) * 10_000_000n + BigInt(sampleRate) / 2n) / BigInt(sampleRate);
		if (ticks > 0x7fff_ffff_ffff_ffffn) throw new RangeError('M4A chapter timestamps exceed the signed 64-bit Nero timebase.');
		view.setBigUint64(offset, ticks);
		const title = titles[index]!;
		body[offset + 8] = title.length;
		body.set(title, offset + 9);
		offset += 9 + title.length;
	}
	return atom('chpl', body);
}

function atom(type: string, body: Uint8Array): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(body.length + 8);
	new DataView(bytes.buffer).setUint32(0, bytes.length);
	bytes.set(new TextEncoder().encode(type), 4);
	bytes.set(body, 8);
	return bytes;
}

async function metadataBytes(blob: Blob, box: Box, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
	if (box.end - box.start > MAXIMUM_METADATA_BYTES) throw new RangeError('M4A movie metadata exceeds its bounded chapter rewrite size.');
	const bytes = new Uint8Array(await blob.slice(box.start, box.end).arrayBuffer());
	signal?.throwIfAborted();
	return bytes;
}

function readBox(bytes: Uint8Array, start: number, end: number, headerOnly = false): Box {
	if (start + 8 > end || start + 8 > bytes.length) invalid();
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
	let size = view.getUint32(start);
	let headerSize = 8;
	if (size === 1) {
		if (start + 16 > end || start + 16 > bytes.length) invalid();
		size = Number(view.getBigUint64(start + 8));
		headerSize = 16;
	} else if (size === 0) size = end - start;
	if (!Number.isSafeInteger(size) || size < headerSize || start + size > end || (!headerOnly && start + size > bytes.length)) invalid();
	return { start, end: start + size, headerSize, type: String.fromCharCode(...bytes.subarray(start + 4, start + 8)) };
}

function children(bytes: Uint8Array, start: number, end: number): Box[] {
	const boxes: Box[] = [];
	for (let offset = start; offset < end;) {
		const box = readBox(bytes, offset, end);
		boxes.push(box);
		offset = box.end;
	}
	return boxes;
}

function writeSize(bytes: Uint8Array, box: Box, size: number): void {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
	if (box.headerSize === 16) view.setBigUint64(box.start + 8, BigInt(size));
	else {
		if (size > UINT32_MAX) invalid();
		view.setUint32(box.start, size);
	}
}

function patchSampleOffsets(bytes: Uint8Array, parent: Box, mediaStart: number, delta: number): void {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
	for (const box of children(bytes, parent.start + parent.headerSize, parent.end)) {
		if (CONTAINERS.has(box.type)) patchSampleOffsets(bytes, box, mediaStart, delta);
		else if (box.type === 'stco' || box.type === 'co64') {
			const content = box.start + box.headerSize;
			if (content + 8 > box.end || view.getUint32(content) !== 0) invalid();
			const count = view.getUint32(content + 4);
			const width = box.type === 'co64' ? 8 : 4;
			if (count * width !== box.end - content - 8) invalid();
			for (let index = 0; index < count; index += 1) patchOffset(view, content + 8 + index * width, width, mediaStart, delta);
		}
	}
}

function patchFragmentOffsets(bytes: Uint8Array, mediaStart: number, delta: number): void {
	const root = readBox(bytes, 0, bytes.length);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
	for (const box of children(bytes, root.headerSize, root.end)) {
		if (box.type !== 'tfra') continue;
		const content = box.start + box.headerSize;
		if (content + 16 > box.end || bytes[content]! > 1) invalid();
		const width = bytes[content] === 1 ? 8 : 4;
		const sizes = view.getUint32(content + 8);
		const stride = 2 * width + ((sizes >> 4) & 3) + ((sizes >> 2) & 3) + (sizes & 3) + 3;
		const count = view.getUint32(content + 12);
		if (count * stride !== box.end - content - 16) invalid();
		for (let index = 0; index < count; index += 1) patchOffset(view, content + 16 + index * stride + width, width, mediaStart, delta);
	}
}

function patchOffset(view: DataView, offset: number, width: number, mediaStart: number, delta: number): void {
	const original = width === 8 ? view.getBigUint64(offset) : BigInt(view.getUint32(offset));
	if (original < BigInt(mediaStart)) return;
	const shifted = original + BigInt(delta);
	if (width === 8) {
		if (shifted > 0xffff_ffff_ffff_ffffn) invalid();
		view.setBigUint64(offset, shifted);
	} else {
		if (shifted > BigInt(UINT32_MAX)) throw new RangeError('M4A chapter metadata exceeds the 32-bit sample offset limit.');
		view.setUint32(offset, Number(shifted));
	}
}

function invalid(): never { throw new RangeError('The native M4A output has invalid MP4 box geometry.'); }
