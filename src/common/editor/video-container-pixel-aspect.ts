/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	bigEndianUnsigned,
	createVideoTimingDemuxReader,
	throwIfAborted,
	VIDEO_TIMING_DEMUX_MAXIMUM_READ_BYTES,
} from './video-timing-demux-reader.ts';

interface Box {
	readonly type: string;
	readonly body: number;
	readonly end: number;
}

/** Read the declared MP4/MOV sample aspect before integer display sizes round it. */
export async function readContainerVideoPixelAspect(
	blob: Blob,
	trackId: number,
	options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<Readonly<{ num: number; den: number }> | null> {
	const reader = createVideoTimingDemuxReader(blob, options);
	let offset = 0;
	while (offset + 8 <= reader.byteLength) {
		throwIfAborted(options.signal);
		const header = await reader.read(offset, Math.min(16, reader.byteLength - offset));
		const box = boxAt(header, 0, reader.byteLength - offset);
		if (!box) return null;
		if (box.type === 'moov') {
			const length = box.end - box.body;
			if (length > VIDEO_TIMING_DEMUX_MAXIMUM_READ_BYTES) return null;
			const bytes = await reader.read(offset + box.body, length);
			throwIfAborted(options.signal);
			return readTrackAspect(bytes, trackId);
		}
		offset += box.end;
	}
	return null;
}

function readTrackAspect(bytes: Uint8Array, trackId: number): Readonly<{ num: number; den: number }> | null {
	for (const track of children(bytes, 0, bytes.length)) {
		if (track.type !== 'trak') continue;
		const header = find(bytes, track, ['tkhd']);
		if (!header || header.body >= header.end) continue;
		const version = bytes[header.body];
		if (version !== 0 && version !== 1) continue;
		const idOffset = header.body + (version === 1 ? 20 : 12);
		if (idOffset + 4 > header.end || unsigned(bytes, idOffset) !== trackId) continue;
		const handler = find(bytes, track, ['mdia', 'hdlr']);
		if (!handler || handler.body + 12 > handler.end || typeAt(bytes, handler.body + 8) !== 'vide') return null;
		const table = find(bytes, track, ['mdia', 'minf', 'stbl', 'stsd']);
		if (!table || table.body + 8 > table.end || unsigned(bytes, table.body + 4) !== 1) return null;
		const sample = boxAt(bytes, table.body + 8, table.end);
		if (!sample || sample.body + 78 > sample.end) return null;
		for (const extension of children(bytes, sample.body + 78, sample.end)) {
			if (extension.type !== 'pasp' || extension.body + 8 > extension.end) continue;
			const num = unsigned(bytes, extension.body);
			const den = unsigned(bytes, extension.body + 4);
			return num > 0 && den > 0 ? { num, den } : null;
		}
		return null;
	}
	return null;
}

function find(bytes: Uint8Array, parent: Box, path: readonly string[]): Box | null {
	let current = parent;
	for (const type of path) {
		const next = Array.from(children(bytes, current.body, current.end)).find(box => box.type === type);
		if (!next) return null;
		current = next;
	}
	return current;
}

function* children(bytes: Uint8Array, start: number, end: number): Generator<Box> {
	let offset = start;
	while (offset + 8 <= end) {
		const box = boxAt(bytes, offset, end);
		if (!box) return;
		yield box;
		offset = box.end;
	}
}

function boxAt(bytes: Uint8Array, offset: number, end: number): Box | null {
	if (offset + 8 > bytes.length) return null;
	let size = unsigned(bytes, offset);
	let body = offset + 8;
	if (size === 1) {
		if (offset + 16 > bytes.length) return null;
		size = Number(bigEndianUnsigned(bytes, offset + 8, offset + 16));
		body += 8;
	} else if (size === 0) size = end - offset;
	if (!Number.isSafeInteger(size) || size < body - offset || offset + size > end) return null;
	return { type: typeAt(bytes, offset + 4), body, end: offset + size };
}

function unsigned(bytes: Uint8Array, offset: number): number {
	return Number(bigEndianUnsigned(bytes, offset, offset + 4));
}

function typeAt(bytes: Uint8Array, offset: number): string {
	return String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
}
