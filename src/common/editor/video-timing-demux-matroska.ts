/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Exact video frame timing read from a Matroska or WebM segment.
 *
 * Matroska states timing as integers too, but spreads it out: the segment names
 * a timecode scale in nanoseconds, each cluster names its own base timecode, and
 * every block carries a signed offset from that base. Blocks written live — by a
 * recorder that cannot know a length in advance — sit inside elements of unknown
 * size, so the walk below is a single forward scan that tracks the most recent
 * cluster base rather than a descent into sized containers.
 */

import {
	bigEndianUnsigned,
	throwIfAborted,
	type VideoTimingDemuxReader,
} from './video-timing-demux-reader.ts';
import { VIDEO_TIMING_ASSET_MAXIMUM_FRAMES } from './video-timing-asset-reference.ts';
import type { VideoTimingDemuxTrack } from './video-timing-demux-isobmff.ts';

const ELEMENT = Object.freeze({
	segment: 0x1853_8067,
	info: 0x1549_a966,
	timecodeScale: 0x2a_d7b1,
	tracks: 0x1654_ae6b,
	trackEntry: 0xae,
	trackNumber: 0xd7,
	trackType: 0x83,
	cluster: 0x1f43_b675,
	clusterTimecode: 0xe7,
	simpleBlock: 0xa3,
	blockGroup: 0xa0,
	block: 0xa1,
	blockDuration: 0x9b,
});
const CONTAINERS = new Set<number>([
	ELEMENT.segment, ELEMENT.info, ELEMENT.tracks, ELEMENT.trackEntry,
	ELEMENT.cluster, ELEMENT.blockGroup,
]);
const TRACK_TYPE_VIDEO = 1n;
const NANOSECONDS_PER_SECOND = 1_000_000_000n;
const MAXIMUM_LEAF_BYTES = 8;
const HEADER_BYTES = 16;
const BLOCK_HEADER_BYTES = 12;

interface Element {
	readonly id: number;
	readonly body: number;
	readonly end: number;
	readonly unknownSize: boolean;
}

interface Block {
	readonly ticks: bigint;
	readonly durationTicks: bigint | null;
}

interface ScanState {
	timecodeScale: bigint;
	videoTrackNumber: bigint | null;
	pendingTrackNumber: bigint | null;
	pendingTrackType: bigint | null;
	clusterTimecode: bigint;
	pendingBlockDuration: bigint | null;
	readonly blocks: Block[];
}

/**
 * Read the video track's exact presentation timing, or null when the segment
 * does not describe one completely enough to persist.
 */
export async function demuxMatroskaVideoTiming(
	reader: VideoTimingDemuxReader,
	options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<VideoTimingDemuxTrack | null> {
	const state: ScanState = {
		timecodeScale: 1_000_000n,
		videoTrackNumber: null,
		pendingTrackNumber: null,
		pendingTrackType: null,
		clusterTimecode: 0n,
		pendingBlockDuration: null,
		blocks: [],
	};
	const complete = await scan(reader, 0, reader.byteLength, state, options.signal);
	if (!complete || state.blocks.length === 0) return null;
	if (state.timecodeScale <= 0n || NANOSECONDS_PER_SECOND % state.timecodeScale !== 0n) return null;
	const timescale = Number(NANOSECONDS_PER_SECOND / state.timecodeScale);
	if (!Number.isSafeInteger(timescale) || timescale <= 0) return null;

	const ordered = [...state.blocks].sort((left, right) => (
		left.ticks < right.ticks ? -1 : left.ticks > right.ticks ? 1 : 0
	));
	const origin = ordered[0]!.ticks;
	const presentationTicks = ordered.map((block) => block.ticks - origin);
	for (let index = 1; index < presentationTicks.length; index += 1) {
		if (presentationTicks[index]! <= presentationTicks[index - 1]!) return null;
	}
	// Matroska blocks usually state no duration at all. The frame presented last
	// then inherits the interval before it, which is what the timing asset means
	// by a final duration: how long the last frame stays on screen.
	const finalFrameDurationTicks = ordered.at(-1)!.durationTicks
		?? (presentationTicks.length > 1
			? presentationTicks.at(-1)! - presentationTicks.at(-2)!
			: null);
	if (finalFrameDurationTicks === null || finalFrameDurationTicks <= 0n) return null;
	return Object.freeze({
		timescale,
		presentationTicks: Object.freeze(presentationTicks),
		finalFrameDurationTicks,
	});
}

async function scan(
	reader: VideoTimingDemuxReader,
	start: number,
	end: number,
	state: ScanState,
	signal: AbortSignal | undefined,
): Promise<boolean> {
	let offset = start;
	while (offset < end) {
		throwIfAborted(signal);
		const element = await readElementHeader(reader, offset, end);
		if (element === null) return offset === end || state.blocks.length > 0;
		if (!await readElement(reader, element, state, signal)) return false;
		if (element.unknownSize) {
			// The rest of the source is this element's content, so the same forward
			// scan continues through it rather than resuming beside it.
			return scan(reader, element.body, end, state, signal);
		}
		offset = element.end;
	}
	return true;
}

async function readElement(
	reader: VideoTimingDemuxReader,
	element: Element,
	state: ScanState,
	signal: AbortSignal | undefined,
): Promise<boolean> {
	if (CONTAINERS.has(element.id)) {
		if (element.id === ELEMENT.trackEntry) {
			state.pendingTrackNumber = null;
			state.pendingTrackType = null;
		}
		if (element.id === ELEMENT.blockGroup) state.pendingBlockDuration = null;
		if (element.unknownSize) return true;
		if (!await scan(reader, element.body, element.end, state, signal)) return false;
		if (element.id === ELEMENT.trackEntry && state.videoTrackNumber === null
			&& state.pendingTrackType === TRACK_TYPE_VIDEO && state.pendingTrackNumber !== null) {
			state.videoTrackNumber = state.pendingTrackNumber;
		}
		return true;
	}
	if (element.id === ELEMENT.simpleBlock || element.id === ELEMENT.block) {
		return readBlock(reader, element, state);
	}
	const length = element.end - element.body;
	if (length > MAXIMUM_LEAF_BYTES) return true;
	const bytes = await reader.read(element.body, length);
	const value = bigEndianUnsigned(bytes, 0, bytes.byteLength);
	if (element.id === ELEMENT.timecodeScale) state.timecodeScale = value;
	else if (element.id === ELEMENT.trackNumber) state.pendingTrackNumber = value;
	else if (element.id === ELEMENT.trackType) state.pendingTrackType = value;
	else if (element.id === ELEMENT.clusterTimecode) state.clusterTimecode = value;
	else if (element.id === ELEMENT.blockDuration) state.pendingBlockDuration = value;
	return true;
}

async function readBlock(
	reader: VideoTimingDemuxReader,
	element: Element,
	state: ScanState,
): Promise<boolean> {
	if (state.videoTrackNumber === null) return false;
	const header = await reader.readAtMost(
		element.body, Math.min(BLOCK_HEADER_BYTES, element.end - element.body),
	);
	const track = readVariableInteger(header, 0, false);
	if (track === null || track.length + 2 > header.byteLength) return true;
	if (track.value !== state.videoTrackNumber) return true;
	const raw = Number(bigEndianUnsigned(header, track.length, track.length + 2));
	// The block timecode is a signed 16-bit offset from its cluster's base.
	const relative = BigInt(raw >= 0x8000 ? raw - 0x1_0000 : raw);
	if (state.blocks.length >= VIDEO_TIMING_ASSET_MAXIMUM_FRAMES) return false;
	state.blocks.push(Object.freeze({
		ticks: state.clusterTimecode + relative,
		durationTicks: state.pendingBlockDuration,
	}));
	return true;
}

async function readElementHeader(
	reader: VideoTimingDemuxReader,
	offset: number,
	end: number,
): Promise<Element | null> {
	const header = await reader.readAtMost(offset, Math.min(HEADER_BYTES, end - offset));
	const id = readVariableInteger(header, 0, true);
	if (id === null) return null;
	const size = readVariableInteger(header, id.length, false);
	if (size === null) return null;
	const body = offset + id.length + size.length;
	const unknownSize = size.value === unknownSizeValue(size.length);
	if (unknownSize) return { id: Number(id.value), body, end, unknownSize };
	const declaredEnd = body + Number(size.value);
	if (!Number.isSafeInteger(declaredEnd) || declaredEnd < body || declaredEnd > end) return null;
	return { id: Number(id.value), body, end: declaredEnd, unknownSize };
}

/**
 * Read one EBML variable-length integer. The leading one-bit states the width;
 * an identifier keeps that marker because the marker is part of its value, while
 * a size strips it.
 */
function readVariableInteger(
	bytes: Uint8Array,
	offset: number,
	keepMarker: boolean,
): Readonly<{ value: bigint; length: number }> | null {
	const first = bytes[offset];
	if (first === undefined || first === 0) return null;
	let length = 1;
	while (length <= 8 && (first & 0x80 >> length - 1) === 0) length += 1;
	if (length > 8 || offset + length > bytes.byteLength) return null;
	let value = BigInt(keepMarker ? first : first & 0xff >> length);
	for (let index = 1; index < length; index += 1) {
		value = value << 8n | BigInt(bytes[offset + index]!);
	}
	return { value, length };
}

function unknownSizeValue(length: number): bigint {
	return (1n << BigInt(length * 7)) - 1n;
}
