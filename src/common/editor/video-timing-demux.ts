/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Exact video frame timing read straight out of the container.
 *
 * MP4 and WebM already state, as integers, when every frame is presented. A
 * demuxing probe reads those integers; it never decodes a frame, needs no codec,
 * and so answers on a desktop build that carries no FFmpeg at all. The frame
 * timing it returns is the same timing an FFmpeg probe reports, because both are
 * reading the same numbers out of the same file.
 */

import { normalizeRational, type RationalRate } from './timeline-time.ts';
import { demuxIsobmffVideoTiming, type VideoTimingDemuxTrack } from './video-timing-demux-isobmff.ts';
import { demuxMatroskaVideoTiming } from './video-timing-demux-matroska.ts';
import {
	createVideoTimingDemuxReader,
	type VideoTimingDemuxReader,
	type VideoTimingDemuxReaderOptions,
} from './video-timing-demux-reader.ts';
import {
	VIDEO_TIMING_ASSET_MAXIMUM_FRAMES,
	VIDEO_TIMING_ASSET_MAXIMUM_TIMESCALE,
} from './video-timing-asset-reference.ts';
import type { VideoTimingProbePort, VideoTimingProbeResult } from './video-timing-probe.ts';

const ISOBMFF_BRANDS = new Set(['ftyp', 'styp', 'moov', 'mdat', 'free', 'skip', 'wide']);
const MATROSKA_MAGIC = Object.freeze([0x1a, 0x45, 0xdf, 0xa3]);
const SNIFF_BYTES = 16;

export class VideoTimingDemuxError extends Error {
	readonly code = 'VIDEO_TIMING_DEMUX_UNSUPPORTED';

	constructor(message: string) {
		super(message);
		this.name = 'VideoTimingDemuxError';
	}
}

/**
 * Read one video Blob's exact presentation timing. Throws when the container is
 * not one this reads, or does not state its timing completely, so the caller's
 * probe list moves on to the next backend exactly as it would for any other
 * failure.
 */
export async function demuxVideoTiming(
	input: Blob,
	options: VideoTimingDemuxReaderOptions = {},
): Promise<VideoTimingProbeResult> {
	if (!(input instanceof Blob)) throw new TypeError('A video Blob is required for timing demux.');
	const reader = createVideoTimingDemuxReader(input, options);
	const track = await demuxContainer(reader, options.signal);
	if (track === null) {
		throw new VideoTimingDemuxError('The container does not state exact video frame timing.');
	}
	return timingResult(track);
}

/**
 * The demuxing probe as a port, for the preference-ordered probe lists.
 *
 * It is ordered behind any codec-backed probe: where a decoder is present its
 * answer stays authoritative, and this is what answers where none is.
 */
export function createContainerVideoTimingProbe(): VideoTimingProbePort {
	return Object.freeze({
		id: 'container',
		probe: (input: Blob, options?: Readonly<{ signal?: AbortSignal }>) => (
			demuxVideoTiming(input, options ?? {})
		),
	});
}

async function demuxContainer(
	reader: VideoTimingDemuxReader,
	signal: AbortSignal | undefined,
): Promise<VideoTimingDemuxTrack | null> {
	const head = await reader.readAtMost(0, SNIFF_BYTES);
	if (head.byteLength >= 4 && MATROSKA_MAGIC.every((byte, index) => head[index] === byte)) {
		return demuxMatroskaVideoTiming(reader, { ...(signal ? { signal } : {}) });
	}
	if (head.byteLength >= 8 && ISOBMFF_BRANDS.has(String.fromCharCode(
		head[4]!, head[5]!, head[6]!, head[7]!,
	))) {
		return demuxIsobmffVideoTiming(reader, { ...(signal ? { signal } : {}) });
	}
	return null;
}

function timingResult(track: VideoTimingDemuxTrack): VideoTimingProbeResult {
	const frameCount = track.presentationTicks.length;
	if (frameCount === 0 || frameCount > VIDEO_TIMING_ASSET_MAXIMUM_FRAMES) {
		throw new VideoTimingDemuxError('The container states no persistable video frame count.');
	}
	if (track.timescale > VIDEO_TIMING_ASSET_MAXIMUM_TIMESCALE) {
		throw new VideoTimingDemuxError('The container timescale exceeds the timing-asset bound.');
	}
	return Object.freeze({
		timescale: track.timescale,
		presentationTicks: track.presentationTicks,
		finalFrameDurationTicks: track.finalFrameDurationTicks,
		nominalRate: nominalRate(track),
	});
}

/**
 * The rate the whole track runs at: its frames over the span they occupy,
 * including how long the last one stays up. For constant-rate media that is
 * exactly the coded rate — 22 frames over 11,264 ticks of a 12,800 timescale is
 * 25/1 and nothing else. For variable-rate media there is no coded rate to
 * recover, and the average across the track is the honest nominal answer.
 */
function nominalRate(track: VideoTimingDemuxTrack): RationalRate {
	const spanTicks = track.presentationTicks.at(-1)! + track.finalFrameDurationTicks;
	if (spanTicks <= 0n) {
		throw new VideoTimingDemuxError('The container states no positive video duration.');
	}
	const numerator = BigInt(track.presentationTicks.length) * BigInt(track.timescale);
	const divisor = greatestCommonDivisor(numerator, spanTicks);
	const num = numerator / divisor;
	const den = spanTicks / divisor;
	if (num > BigInt(Number.MAX_SAFE_INTEGER) || den > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new VideoTimingDemuxError('The container states a video rate that cannot be expressed exactly.');
	}
	try {
		return normalizeRational({ num: Number(num), den: Number(den) });
	} catch (error) {
		throw new VideoTimingDemuxError(
			`The container states a video rate that cannot be expressed exactly: ${
				error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
	let a = left < 0n ? -left : left;
	let b = right < 0n ? -right : right;
	while (b !== 0n) [a, b] = [b, a % b];
	return a === 0n ? 1n : a;
}
