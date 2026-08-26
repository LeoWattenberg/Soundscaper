/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Exact video frame timing read from an ISO base media file (MP4, M4V, MOV).
 *
 * The sample tables carry the timing directly: `mdhd` names the media timescale
 * every value below is counted in, `stts` gives each sample's decode duration,
 * and `ctts` gives the composition offset that reorders coded frames into the
 * order they are presented in. Nothing here decodes a frame — the integers the
 * container already states are the answer.
 */

import {
	bigEndianUnsigned,
	throwIfAborted,
	type VideoTimingDemuxReader,
} from './video-timing-demux-reader.ts';
import { VIDEO_TIMING_ASSET_MAXIMUM_FRAMES } from './video-timing-asset-reference.ts';

export interface VideoTimingDemuxTrack {
	readonly timescale: number;
	readonly presentationTicks: readonly bigint[];
	readonly finalFrameDurationTicks: bigint;
}

interface Box {
	readonly type: string;
	readonly body: number;
	readonly end: number;
}

const MAXIMUM_MOVIE_BOX_BYTES = 64 * 1024 * 1024;
const HANDLER_VIDEO = 'vide';

/**
 * Read the video track's exact presentation timing, or null when this is not an
 * ISO base media file the sample tables describe completely — a fragmented file
 * whose timing lives in movie fragments, or one with no video track at all.
 */
export async function demuxIsobmffVideoTiming(
	reader: VideoTimingDemuxReader,
	options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<VideoTimingDemuxTrack | null> {
	const movie = await findMovieBox(reader, options.signal);
	if (movie === null) return null;
	const bytes = await reader.read(movie.body, movie.end - movie.body);
	throwIfAborted(options.signal);
	for (const trak of children(bytes, 0, bytes.byteLength, 'trak')) {
		const track = readTrack(bytes, trak);
		if (track !== null) return track;
	}
	return null;
}

async function findMovieBox(
	reader: VideoTimingDemuxReader,
	signal: AbortSignal | undefined,
): Promise<Box | null> {
	let offset = 0;
	while (offset + 8 <= reader.byteLength) {
		throwIfAborted(signal);
		const header = await reader.read(offset, Math.min(16, reader.byteLength - offset));
		if (header.byteLength < 8) return null;
		const type = boxType(header, 4);
		let size = Number(bigEndianUnsigned(header, 0, 4));
		let body = offset + 8;
		if (size === 1) {
			if (header.byteLength < 16) return null;
			size = Number(bigEndianUnsigned(header, 8, 16));
			body = offset + 16;
		} else if (size === 0) size = reader.byteLength - offset;
		if (!Number.isSafeInteger(size) || size < body - offset || offset + size > reader.byteLength) return null;
		// A movie box larger than this is not an index a timing probe should hold.
		if (type === 'moov') {
			return offset + size - body > MAXIMUM_MOVIE_BOX_BYTES
				? null : { type, body, end: offset + size };
		}
		offset += size;
	}
	return null;
}

function readTrack(bytes: Uint8Array, trak: Box): VideoTimingDemuxTrack | null {
	const handler = find(bytes, trak, ['mdia', 'hdlr']);
	if (handler === null || handler.end - handler.body < 12
		|| boxType(bytes, handler.body + 8) !== HANDLER_VIDEO) return null;
	const header = find(bytes, trak, ['mdia', 'mdhd']);
	if (header === null) return null;
	const version = bytes[header.body];
	const timescaleOffset = header.body + (version === 1 ? 20 : 12);
	if (version !== 0 && version !== 1) return null;
	if (timescaleOffset + 4 > header.end) return null;
	const timescale = Number(bigEndianUnsigned(bytes, timescaleOffset, timescaleOffset + 4));
	if (!Number.isSafeInteger(timescale) || timescale <= 0) return null;

	const decodeDurations = readTimeToSample(bytes, find(bytes, trak, ['mdia', 'minf', 'stbl', 'stts']));
	if (decodeDurations === null || decodeDurations.length === 0) return null;
	const compositionOffsets = readCompositionOffsets(
		bytes, find(bytes, trak, ['mdia', 'minf', 'stbl', 'ctts']), decodeDurations.length,
	);
	if (compositionOffsets === null) return null;

	const composition: bigint[] = [];
	let decodeTime = 0n;
	for (const [index, duration] of decodeDurations.entries()) {
		composition.push(decodeTime + (compositionOffsets[index] ?? 0n));
		decodeTime += duration;
	}
	const order = composition.map((_value, index) => index)
		.sort((left, right) => compare(composition[left]!, composition[right]!));
	const origin = composition[order[0]!]!;
	const presentationTicks = order.map((index) => composition[index]! - origin);
	for (let index = 1; index < presentationTicks.length; index += 1) {
		if (presentationTicks[index]! <= presentationTicks[index - 1]!) return null;
	}
	// The frame presented last owns the final duration, whatever its decode order.
	const finalFrameDurationTicks = decodeDurations[order.at(-1)!]!;
	if (finalFrameDurationTicks <= 0n) return null;
	return Object.freeze({
		timescale,
		presentationTicks: Object.freeze(presentationTicks),
		finalFrameDurationTicks,
	});
}

function readTimeToSample(bytes: Uint8Array, box: Box | null): bigint[] | null {
	if (box === null || box.end - box.body < 8) return null;
	const entries = Number(bigEndianUnsigned(bytes, box.body + 4, box.body + 8));
	if (!Number.isSafeInteger(entries) || box.body + 8 + entries * 8 > box.end) return null;
	const durations: bigint[] = [];
	for (let entry = 0; entry < entries; entry += 1) {
		const offset = box.body + 8 + entry * 8;
		const count = Number(bigEndianUnsigned(bytes, offset, offset + 4));
		const duration = bigEndianUnsigned(bytes, offset + 4, offset + 8);
		if (!Number.isSafeInteger(count) || count < 0
			|| durations.length + count > VIDEO_TIMING_ASSET_MAXIMUM_FRAMES) return null;
		for (let sample = 0; sample < count; sample += 1) durations.push(duration);
	}
	return durations;
}

function readCompositionOffsets(
	bytes: Uint8Array,
	box: Box | null,
	sampleCount: number,
): bigint[] | null {
	if (box === null) return [];
	if (box.end - box.body < 8) return null;
	const version = bytes[box.body];
	if (version !== 0 && version !== 1) return null;
	const entries = Number(bigEndianUnsigned(bytes, box.body + 4, box.body + 8));
	if (!Number.isSafeInteger(entries) || box.body + 8 + entries * 8 > box.end) return null;
	const offsets: bigint[] = [];
	for (let entry = 0; entry < entries; entry += 1) {
		const offset = box.body + 8 + entry * 8;
		const count = Number(bigEndianUnsigned(bytes, offset, offset + 4));
		const raw = bigEndianUnsigned(bytes, offset + 4, offset + 8);
		// Version 1 offsets are signed, which is how a file states that a frame is
		// presented before the one it is decoded after.
		const value = version === 1 && raw >= 0x8000_0000n ? raw - 0x1_0000_0000n : raw;
		if (!Number.isSafeInteger(count) || count < 0 || offsets.length + count > sampleCount) return null;
		for (let sample = 0; sample < count; sample += 1) offsets.push(value);
	}
	return offsets;
}

function* children(bytes: Uint8Array, start: number, end: number, type?: string): Generator<Box> {
	let offset = start;
	while (offset + 8 <= end) {
		let size = Number(bigEndianUnsigned(bytes, offset, offset + 4));
		let body = offset + 8;
		if (size === 1) {
			if (offset + 16 > end) return;
			size = Number(bigEndianUnsigned(bytes, offset + 8, offset + 16));
			body = offset + 16;
		} else if (size === 0) size = end - offset;
		if (!Number.isSafeInteger(size) || size < body - offset || offset + size > end) return;
		const boxTypeName = boxType(bytes, offset + 4);
		if (type === undefined || boxTypeName === type) {
			yield { type: boxTypeName, body, end: offset + size };
		}
		offset += size;
	}
}

function find(bytes: Uint8Array, box: Box, path: readonly string[]): Box | null {
	let current: Box | null = box;
	for (const type of path) {
		if (current === null) return null;
		const start: Box = current;
		current = null;
		for (const child of children(bytes, start.body, start.end, type)) {
			current = child;
			break;
		}
	}
	return current;
}

function boxType(bytes: Uint8Array, offset: number): string {
	if (offset + 4 > bytes.byteLength) return '';
	return String.fromCharCode(
		bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!,
	);
}

function compare(left: bigint, right: bigint): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
