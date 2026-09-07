/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Exact video frame timing read from an ISO base media file (MP4, M4V, MOV).
 *
 * The sample tables carry the timing directly: `mdhd` names the media timescale
 * every value below is counted in, `stts` gives each sample's decode duration,
 * and `ctts` gives the composition offset that reorders coded frames into the
 * order they are presented in. Nothing here decodes a frame — the integers the
 * container already states are the answer.
 *
 * The track's `edts/elst` then states which part of that media is presented and
 * when. A stream-copy trim leaves the samples it skipped in `mdat` and says so
 * only here, and an initial empty edit delays the whole track; a media element
 * and FFmpeg both apply the edit, so timing read without it describes a file
 * nobody plays. An edit list this cannot apply exactly — a rate change, a
 * boundary inside a frame, more than one presented segment — is refused instead,
 * so the probe list falls through rather than publish timing that is not true.
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

/** The part of a track's media the edit list presents, in media ticks. */
interface EditWindow {
	/** Ticks an initial empty edit holds before the first frame is presented. */
	readonly shiftTicks: bigint;
	/** Composition time the presented segment opens at, or null for all of it. */
	readonly startTicks: bigint | null;
	/** Composition time the presented segment closes at, or null for all of it. */
	readonly endTicks: bigint | null;
}

/** One `elst` entry, read at whichever width its version states. */
interface Edit {
	readonly movieTicks: bigint;
	readonly mediaTicks: bigint;
	readonly rate: bigint;
}

const MAXIMUM_MOVIE_BOX_BYTES = 64 * 1024 * 1024;
const HANDLER_VIDEO = 'vide';
const UNIT_EDIT_RATE = 0x0001_0000n;
const WHOLE_TRACK: EditWindow = Object.freeze({ shiftTicks: 0n, startTicks: null, endTicks: null });

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
	const movieTimescale = readTimescale(bytes, firstChild(bytes, 0, bytes.byteLength, 'mvhd'));
	for (const trak of children(bytes, 0, bytes.byteLength, 'trak')) {
		const track = readTrack(bytes, trak, movieTimescale);
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

function readTrack(
	bytes: Uint8Array,
	trak: Box,
	movieTimescale: number | null,
): VideoTimingDemuxTrack | null {
	const handler = find(bytes, trak, ['mdia', 'hdlr']);
	if (handler === null || handler.end - handler.body < 12
		|| boxType(bytes, handler.body + 8) !== HANDLER_VIDEO) return null;
	const timescale = readTimescale(bytes, find(bytes, trak, ['mdia', 'mdhd']));
	if (timescale === null) return null;
	const edit = readEditWindow(bytes, trak, movieTimescale, timescale);
	if (edit === null) return null;

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
	// An edit opening at or before the first coded picture trims nothing, so the
	// earliest composition time stays the origin exactly as it does with no edit.
	const coded = composition[order[0]!]!;
	const start = edit.startTicks !== null && edit.startTicks > coded ? edit.startTicks : null;
	const origin = start ?? coded;
	const presented = start === null && edit.endTicks === null ? order : order.filter((index) => (
		composition[index]! >= origin && (edit.endTicks === null || composition[index]! < edit.endTicks)
	));
	if (presented.length === 0) return null;
	// The edit has to name whole frames. A boundary that falls inside one leaves a
	// picture this cannot place, and guessing is how two backends come to disagree.
	if (start !== null && composition[presented[0]!]! !== start) return null;
	const presentationTicks = presented.map((index) => composition[index]! - origin + edit.shiftTicks);
	for (let index = 1; index < presentationTicks.length; index += 1) {
		if (presentationTicks[index]! <= presentationTicks[index - 1]!) return null;
	}
	// The frame presented last owns the final duration, whatever its decode order.
	const last = presented.at(-1)!;
	const finalFrameDurationTicks = decodeDurations[last]!;
	if (finalFrameDurationTicks <= 0n) return null;
	if (edit.endTicks !== null && composition[last]! + finalFrameDurationTicks > edit.endTicks) return null;
	return Object.freeze({
		timescale,
		presentationTicks: Object.freeze(presentationTicks),
		finalFrameDurationTicks,
	});
}

/**
 * The window `edts/elst` presents, in the track's own media ticks, or null when
 * the edit list is a shape this cannot apply exactly. A track with no edit list
 * presents all of its media, which is what `WHOLE_TRACK` states.
 */
function readEditWindow(
	bytes: Uint8Array,
	trak: Box,
	movieTimescale: number | null,
	mediaTimescale: number,
): EditWindow | null {
	const list = find(bytes, trak, ['edts', 'elst']);
	if (list === null) return WHOLE_TRACK;
	if (list.end - list.body < 8) return null;
	const version = bytes[list.body];
	if (version !== 0 && version !== 1) return null;
	const width = version === 1 ? 8 : 4;
	const entries = Number(bigEndianUnsigned(bytes, list.body + 4, list.body + 8));
	if (!Number.isSafeInteger(entries) || entries < 0
		|| list.body + 8 + entries * (width * 2 + 4) > list.end) return null;
	if (entries === 0) return WHOLE_TRACK;
	if (entries > 2) return null;
	const first = readEdit(bytes, list.body + 8, width);
	// A leading empty edit is a delay; anything else with two entries is more than
	// one presented segment, which is a timeline these sample tables do not carry.
	const empty = first.mediaTicks < 0n;
	if (empty ? first.mediaTicks !== -1n || entries !== 2 : entries !== 1) return null;
	const segment = empty ? readEdit(bytes, list.body + 8 + width * 2 + 4, width) : first;
	if (segment.mediaTicks < 0n || segment.rate !== UNIT_EDIT_RATE) return null;
	const shiftTicks = empty ? toMediaTicks(first.movieTicks, mediaTimescale, movieTimescale) : 0n;
	const spanTicks = toMediaTicks(segment.movieTicks, mediaTimescale, movieTimescale);
	if (shiftTicks === null || spanTicks === null) return null;
	return Object.freeze({
		shiftTicks,
		startTicks: segment.mediaTicks,
		endTicks: spanTicks === 0n ? null : segment.mediaTicks + spanTicks,
	});
}

function readEdit(bytes: Uint8Array, offset: number, width: number): Edit {
	// `media_time` is signed, which is how a file states an empty edit as -1.
	const raw = bigEndianUnsigned(bytes, offset + width, offset + width * 2);
	const limit = 1n << BigInt(width * 8);
	return {
		movieTicks: bigEndianUnsigned(bytes, offset, offset + width),
		mediaTicks: raw >= limit >> 1n ? raw - limit : raw,
		rate: bigEndianUnsigned(bytes, offset + width * 2, offset + width * 2 + 4),
	};
}

/**
 * Restate a duration the movie header counts in the track's media ticks, or null
 * when there is a duration to convert and no readable movie timescale to do it.
 */
function toMediaTicks(
	movieTicks: bigint,
	mediaTimescale: number,
	movieTimescale: number | null,
): bigint | null {
	if (movieTicks <= 0n) return 0n;
	if (movieTimescale === null) return null;
	const divisor = BigInt(movieTimescale);
	return (movieTicks * BigInt(mediaTimescale) + divisor / 2n) / divisor;
}

/** The timescale an `mvhd` or `mdhd` header names, or null when it states none. */
function readTimescale(bytes: Uint8Array, header: Box | null): number | null {
	if (header === null || header.end - header.body < 4) return null;
	const version = bytes[header.body];
	if (version !== 0 && version !== 1) return null;
	const offset = header.body + (version === 1 ? 20 : 12);
	if (offset + 4 > header.end) return null;
	const timescale = Number(bigEndianUnsigned(bytes, offset, offset + 4));
	return Number.isSafeInteger(timescale) && timescale > 0 ? timescale : null;
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
		current = firstChild(bytes, current.body, current.end, type);
	}
	return current;
}

function firstChild(bytes: Uint8Array, start: number, end: number, type: string): Box | null {
	for (const child of children(bytes, start, end, type)) return child;
	return null;
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
