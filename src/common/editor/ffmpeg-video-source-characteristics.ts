/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeVideoSourceCharacteristics,
	type VideoSourceCharacteristics,
} from './video-source-characteristics.ts';
import {
	isLegalSequenceTimecode,
	isSequenceDropFrameRate,
	type SequenceRationalRate,
} from './sequence-timecode.ts';

/**
 * Read source characteristics out of the logs the timing probe already
 * produces, so nothing costs a second decode of the file.
 *
 * Coded size, sample aspect, field order, and alpha come from the `showinfo`
 * filter's structured per-frame line rather than the human-readable banner.
 * Codec, colour tags, rotation, container timecode, and the audio stream
 * inventory have no filter equivalent and are read from the input banner,
 * which is only ever parsed for facts it states outright: anything the parser
 * cannot recognise stays unreported instead of being guessed at.
 */

const SHOWINFO_GEOMETRY = /\bfmt:(\S+)\s+sar:(\d+)\/(\d+)\s+s:(\d+)x(\d+)\s+i:([A-Z])/u;
const INPUT_STREAM = /\bStream #(\d+):(\d+)(?:\[[^\]]*\])?(?:\(([^)]*)\))?:\s*(Video|Audio):\s*([^\s,(]+)/u;
const OUTPUT_SECTION = /^\s*Output #\d+/u;
const PIXEL_FORMAT_DETAIL = /,\s*[a-z][a-z0-9]*\(([^)]*)\)/u;
const DISPLAY_MATRIX = /displaymatrix:\s*rotation of\s*(-?\d+(?:\.\d+)?)\s*degrees/iu;
const TIMECODE = /\btimecode\s*:\s*(\d{1,3}):(\d{1,2}):(\d{1,2})([:;])(\d{1,3})\b/u;
const SAMPLE_RATE = /\b(\d+)\s*Hz\b/u;
const CHANNEL_COUNT = /\b(\d+)\s+channels\b/u;
const ALPHA_PIXEL_FORMAT = /^(?:ya|yuva|gbra|rgba|bgra|argb|abgr)/u;
const COLOUR_TAG = /^[a-z][a-z0-9_.-]*$/u;
const MAXIMUM_BANNER_LINES = 512;

const FIELD_ORDERS: Readonly<Record<string, string>> = Object.freeze({
	P: 'progressive',
	T: 'top-field-first',
	B: 'bottom-field-first',
	I: 'interlaced-unknown-order',
});
const COLOUR_RANGES: Readonly<Record<string, string>> = Object.freeze({
	tv: 'limited',
	limited: 'limited',
	mpeg: 'limited',
	pc: 'full',
	full: 'full',
	jpeg: 'full',
});
const CHANNEL_LAYOUTS: Readonly<Record<string, number>> = Object.freeze({
	mono: 1,
	stereo: 2,
	downmix: 2,
	'2.1': 3,
	'3.0': 3,
	'4.0': 4,
	quad: 4,
	'5.0': 5,
	'5.1': 6,
	'6.1': 7,
	'7.1': 8,
});
const NON_COLOUR_DETAIL: ReadonlySet<string> = new Set([
	'progressive', 'interlaced', 'unknown', 'left', 'center', 'topleft', 'top', 'bottom', 'bottomleft',
]);

export interface FfmpegVideoSourceCharacteristicsOptions {
	readonly rate?: SequenceRationalRate;
}

/** Collect the banner lines the characteristics parser needs, bounded. */
export function isFfmpegSourceCharacteristicsLog(message: unknown): boolean {
	if (typeof message !== 'string') return false;
	return INPUT_STREAM.test(message) || DISPLAY_MATRIX.test(message)
		|| TIMECODE.test(message) || OUTPUT_SECTION.test(message);
}

/** Parse probe logs into the persisted characteristics contract. */
export function parseFfmpegVideoSourceCharacteristics(
	lines: readonly string[],
	options: FfmpegVideoSourceCharacteristicsOptions = {},
): VideoSourceCharacteristics {
	if (!Array.isArray(lines)) throw new TypeError('FFmpeg probe logs must be an array.');
	if (!options.rate) throw new TypeError('A nominal source rate is required to read source characteristics.');
	const reported: Record<string, unknown> = { backend: 'ffmpeg' };
	const audioStreams: Record<string, unknown>[] = [];
	const seenAudioIndexes = new Set<number>();
	let geometryFound = false;
	let inOutputSection = false;
	let bannerLines = 0;
	for (const line of lines) {
		if (typeof line !== 'string') throw new TypeError('Every FFmpeg probe log must be text.');
		if (OUTPUT_SECTION.test(line)) inOutputSection = true;
		if (!geometryFound) geometryFound = readShowinfoGeometry(line, reported);
		if (inOutputSection || line.includes('->')) continue;
		if (bannerLines >= MAXIMUM_BANNER_LINES) continue;
		const stream = INPUT_STREAM.exec(line);
		if (stream) {
			bannerLines += 1;
			if (stream[4] === 'Video') readVideoStream(line, stream[5], reported);
			else readAudioStream(line, stream, audioStreams, seenAudioIndexes);
			continue;
		}
		const rotation = DISPLAY_MATRIX.exec(line);
		if (rotation) {
			bannerLines += 1;
			const degrees = clockwiseRotation(Number(rotation[1]));
			if (degrees !== null) reported.rotationDegrees = degrees;
			continue;
		}
		const timecode = TIMECODE.exec(line);
		if (timecode && reported.startTimecode === undefined) {
			bannerLines += 1;
			const candidate = Object.freeze({
				negative: false,
				hours: Number(timecode[1]),
				minutes: Number(timecode[2]),
				seconds: Number(timecode[3]),
				frames: Number(timecode[5]),
				dropFrame: timecode[4] === ';',
			});
			if (isReadableSourceTimecode(candidate, options.rate)) reported.startTimecode = candidate;
		}
	}
	if (audioStreams.length) {
		audioStreams.sort((left, right) => Number(left.index) - Number(right.index));
		reported.audioStreams = audioStreams;
	}
	return normalizeVideoSourceCharacteristics(reported, options);
}

function readShowinfoGeometry(line: string, reported: Record<string, unknown>): boolean {
	const geometry = SHOWINFO_GEOMETRY.exec(line);
	if (!geometry) return false;
	const pixelFormat = geometry[1];
	const aspectNum = Number(geometry[2]);
	const aspectDen = Number(geometry[3]);
	reported.codedWidth = Number(geometry[4]);
	reported.codedHeight = Number(geometry[5]);
	// FFmpeg reports an undefined sample aspect as 0/1; square pixels are 1/1.
	if (aspectNum > 0 && aspectDen > 0) reported.pixelAspectRatio = { num: aspectNum, den: aspectDen };
	const fieldOrder = FIELD_ORDERS[geometry[6]];
	if (fieldOrder) reported.fieldOrder = fieldOrder;
	reported.hasAlpha = ALPHA_PIXEL_FORMAT.test(pixelFormat);
	return true;
}

function readVideoStream(line: string, codec: string, reported: Record<string, unknown>): void {
	if (reported.videoCodec === undefined) reported.videoCodec = codec;
	const detail = PIXEL_FORMAT_DETAIL.exec(line);
	if (!detail) return;
	const colour: Record<string, unknown> = {};
	for (const part of detail[1].split(',').map((value) => value.trim()).filter(Boolean)) {
		const range = COLOUR_RANGES[part];
		if (range) {
			colour.range = range;
			continue;
		}
		if (part.includes('/')) {
			const tags = part.split('/');
			if (tags.length !== 3 || !tags.every((tag) => COLOUR_TAG.test(tag))) continue;
			// libavcodec prints colour space, primaries, and transfer in that order.
			[colour.matrix, colour.primaries, colour.transfer] = tags;
			continue;
		}
		if (!COLOUR_TAG.test(part) || NON_COLOUR_DETAIL.has(part) || colour.matrix !== undefined) continue;
		colour.matrix = part;
		colour.primaries = part;
		colour.transfer = part;
	}
	if (Object.keys(colour).length) reported.colour = colour;
}

function readAudioStream(
	line: string,
	stream: RegExpExecArray,
	audioStreams: Record<string, unknown>[],
	seen: Set<number>,
): void {
	const index = Number(stream[2]);
	if (!Number.isSafeInteger(index) || seen.has(index)) return;
	seen.add(index);
	const language = stream[3] && stream[3] !== 'und' ? stream[3] : null;
	const sampleRate = SAMPLE_RATE.exec(line);
	audioStreams.push({
		index,
		codec: stream[5],
		channelCount: channelCount(line),
		sampleRate: sampleRate ? Number(sampleRate[1]) : null,
		language,
	});
}

function channelCount(line: string): number | null {
	const counted = CHANNEL_COUNT.exec(line);
	if (counted) return Number(counted[1]);
	for (const [layout, channels] of Object.entries(CHANNEL_LAYOUTS)) {
		if (line.includes(`, ${layout},`) || line.includes(`, ${layout}(`)) return channels;
	}
	return null;
}

/**
 * A container timecode that its own frame rate cannot produce is not source
 * truth, so it is left unreported rather than persisted or repaired. The
 * properties surface then says the origin is unknown, which is what happened.
 */
function isReadableSourceTimecode(
	candidate: Readonly<{ dropFrame: boolean } & Record<string, unknown>>,
	rate: SequenceRationalRate,
): boolean {
	if (candidate.dropFrame && !isSequenceDropFrameRate(rate)) return false;
	return isLegalSequenceTimecode({
		negative: false,
		hours: Number(candidate.hours),
		minutes: Number(candidate.minutes),
		seconds: Number(candidate.seconds),
		frames: Number(candidate.frames),
	}, rate, candidate.dropFrame);
}

/**
 * The display matrix states the counter-clockwise angle a player must undo, so
 * the clockwise rotation a surface applies is its negation. Anything that is
 * not a quarter turn stays unreported rather than being rounded into one.
 */
function clockwiseRotation(value: number): number | null {
	if (!Number.isFinite(value)) return null;
	const clockwise = ((-value % 360) + 360) % 360;
	const quarter = Math.round(clockwise / 90) % 4;
	return Math.abs(clockwise - quarter * 90) > 0.01 && Math.abs(clockwise - 360) > 0.01 ? null : quarter * 90;
}
