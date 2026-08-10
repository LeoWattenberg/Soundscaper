/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	isLegalSequenceTimecode,
	isSequenceDropFrameRate,
	type SequenceRationalRate,
	type SequenceTimecode,
} from './sequence-timecode.ts';

/**
 * The wire contract for what an ingest probe reports about a video source.
 *
 * Every field is either a probed value or an explicit `null` meaning "this
 * backend did not report it". Nothing here is inferred from a plausible
 * default: an unknown rotation is not zero, an unknown field order is not
 * progressive, and an unknown colour tag is not sRGB. Consumers branch on the
 * null and disclose it rather than presenting a guess as source truth.
 */

export const VIDEO_SOURCE_MAXIMUM_CODED_DIMENSION = 65_536;
export const VIDEO_SOURCE_MAXIMUM_ASPECT_TERM = 1_000_000;
export const VIDEO_SOURCE_MAXIMUM_AUDIO_STREAMS = 64;
export const VIDEO_SOURCE_MAXIMUM_AUDIO_CHANNELS = 64;
export const VIDEO_SOURCE_MAXIMUM_AUDIO_SAMPLE_RATE = 768_000;
export const VIDEO_SOURCE_MAXIMUM_TAG_LENGTH = 64;
export const VIDEO_SOURCE_ROTATIONS: readonly number[] = Object.freeze([0, 90, 180, 270]);
export const VIDEO_SOURCE_FIELD_ORDERS: readonly string[] = Object.freeze([
	'progressive', 'top-field-first', 'bottom-field-first', 'interlaced-unknown-order',
]);
export const VIDEO_SOURCE_COLOUR_RANGES: readonly string[] = Object.freeze(['limited', 'full']);

const TAG = /^[A-Za-z0-9][A-Za-z0-9 ._+/()-]*$/u;
const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/u;
const ROTATION_SET: ReadonlySet<number> = new Set(VIDEO_SOURCE_ROTATIONS);
const FIELD_ORDER_SET: ReadonlySet<string> = new Set(VIDEO_SOURCE_FIELD_ORDERS);
const COLOUR_RANGE_SET: ReadonlySet<string> = new Set(VIDEO_SOURCE_COLOUR_RANGES);

const CHARACTERISTIC_KEYS: readonly string[] = Object.freeze([
	'backend', 'codedWidth', 'codedHeight', 'rotationDegrees', 'pixelAspectRatio', 'fieldOrder',
	'hasAlpha', 'videoCodec', 'colour', 'audioStreams', 'extractedAudioStreamIndex', 'startTimecode',
]);
const COLOUR_KEYS: readonly string[] = Object.freeze(['primaries', 'transfer', 'matrix', 'range']);
const AUDIO_STREAM_KEYS: readonly string[] = Object.freeze([
	'index', 'codec', 'channelCount', 'sampleRate', 'language',
]);
const START_TIMECODE_KEYS: readonly string[] = Object.freeze([
	'negative', 'hours', 'minutes', 'seconds', 'frames', 'dropFrame',
]);

export interface VideoSourceAspectRatio {
	readonly num: number;
	readonly den: number;
}

export interface VideoSourceAudioStream {
	readonly index: number;
	readonly codec: string | null;
	readonly channelCount: number | null;
	readonly sampleRate: number | null;
	readonly language: string | null;
}

export interface VideoSourceColour {
	readonly primaries: string | null;
	readonly transfer: string | null;
	readonly matrix: string | null;
	readonly range: string | null;
}

export interface VideoSourceStartTimecode extends SequenceTimecode {
	readonly dropFrame: boolean;
}

export interface VideoSourceCharacteristics {
	readonly backend: string | null;
	readonly codedWidth: number | null;
	readonly codedHeight: number | null;
	readonly rotationDegrees: number | null;
	readonly pixelAspectRatio: VideoSourceAspectRatio | null;
	readonly fieldOrder: string | null;
	readonly hasAlpha: boolean | null;
	readonly videoCodec: string | null;
	readonly colour: VideoSourceColour;
	readonly audioStreams: readonly VideoSourceAudioStream[] | null;
	readonly extractedAudioStreamIndex: number | null;
	readonly startTimecode: VideoSourceStartTimecode | null;
}

export interface VideoSourceCharacteristicsOptions {
	/** Required before a source start timecode can be proven legal. */
	readonly rate?: SequenceRationalRate;
}

/** The record a source carries when no backend reported anything about it. */
export function createUnreportedVideoSourceCharacteristics(): VideoSourceCharacteristics {
	return Object.freeze({
		backend: null,
		codedWidth: null,
		codedHeight: null,
		rotationDegrees: null,
		pixelAspectRatio: null,
		fieldOrder: null,
		hasAlpha: null,
		videoCodec: null,
		colour: Object.freeze({ primaries: null, transfer: null, matrix: null, range: null }),
		audioStreams: null,
		extractedAudioStreamIndex: null,
		startTimecode: null,
	});
}

/** Validate probed characteristics into their canonical persisted form. */
export function normalizeVideoSourceCharacteristics(
	value: unknown,
	options: VideoSourceCharacteristicsOptions = {},
): VideoSourceCharacteristics {
	if (value == null) return createUnreportedVideoSourceCharacteristics();
	const candidate = record(value, 'source characteristics');
	rejectUnknownKeys(candidate, CHARACTERISTIC_KEYS, 'source characteristics');
	const codedWidth = optionalBoundedInteger(
		candidate.codedWidth, 'characteristics.codedWidth', VIDEO_SOURCE_MAXIMUM_CODED_DIMENSION,
	);
	const codedHeight = optionalBoundedInteger(
		candidate.codedHeight, 'characteristics.codedHeight', VIDEO_SOURCE_MAXIMUM_CODED_DIMENSION,
	);
	if ((codedWidth === null) !== (codedHeight === null)) {
		throw new RangeError('A coded frame size reports both axes or neither.');
	}
	const audioStreams = normalizeAudioStreams(candidate.audioStreams);
	return Object.freeze({
		backend: optionalTag(candidate.backend, 'characteristics.backend'),
		codedWidth,
		codedHeight,
		rotationDegrees: optionalMember(
			candidate.rotationDegrees, ROTATION_SET, 'characteristics.rotationDegrees',
		) as number | null,
		pixelAspectRatio: normalizeAspectRatio(candidate.pixelAspectRatio),
		fieldOrder: optionalMember(candidate.fieldOrder, FIELD_ORDER_SET, 'characteristics.fieldOrder') as string | null,
		hasAlpha: optionalBoolean(candidate.hasAlpha, 'characteristics.hasAlpha'),
		videoCodec: optionalTag(candidate.videoCodec, 'characteristics.videoCodec'),
		colour: normalizeColour(candidate.colour),
		audioStreams,
		extractedAudioStreamIndex: normalizeExtractedIndex(candidate.extractedAudioStreamIndex, audioStreams),
		startTimecode: normalizeStartTimecode(candidate.startTimecode, options.rate),
	});
}

/** True when any backend reported anything, which is what makes the state owned. */
export function videoSourceCharacteristicsAreReported(value: unknown): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const candidate = value as Record<string, unknown>;
	const colour = candidate.colour;
	const colourReported = Boolean(colour) && typeof colour === 'object' && !Array.isArray(colour)
		&& COLOUR_KEYS.some((key) => (colour as Record<string, unknown>)[key] != null);
	return colourReported || CHARACTERISTIC_KEYS.some((key) => key !== 'colour' && candidate[key] != null);
}

function normalizeAspectRatio(value: unknown): VideoSourceAspectRatio | null {
	if (value == null) return null;
	const candidate = record(value, 'characteristics.pixelAspectRatio');
	rejectUnknownKeys(candidate, ['num', 'den'], 'characteristics.pixelAspectRatio');
	const num = boundedInteger(candidate.num, 'characteristics.pixelAspectRatio.num', VIDEO_SOURCE_MAXIMUM_ASPECT_TERM);
	const den = boundedInteger(candidate.den, 'characteristics.pixelAspectRatio.den', VIDEO_SOURCE_MAXIMUM_ASPECT_TERM);
	const divisor = greatestCommonDivisor(num, den);
	return Object.freeze({ num: num / divisor, den: den / divisor });
}

function normalizeColour(value: unknown): VideoSourceColour {
	if (value == null) return Object.freeze({ primaries: null, transfer: null, matrix: null, range: null });
	const candidate = record(value, 'characteristics.colour');
	rejectUnknownKeys(candidate, COLOUR_KEYS, 'characteristics.colour');
	return Object.freeze({
		primaries: optionalTag(candidate.primaries, 'characteristics.colour.primaries'),
		transfer: optionalTag(candidate.transfer, 'characteristics.colour.transfer'),
		matrix: optionalTag(candidate.matrix, 'characteristics.colour.matrix'),
		range: optionalMember(candidate.range, COLOUR_RANGE_SET, 'characteristics.colour.range') as string | null,
	});
}

function normalizeAudioStreams(value: unknown): readonly VideoSourceAudioStream[] | null {
	if (value == null) return null;
	if (!Array.isArray(value)) throw new TypeError('characteristics.audioStreams must be an array when reported.');
	if (value.length > VIDEO_SOURCE_MAXIMUM_AUDIO_STREAMS) {
		throw new RangeError('characteristics.audioStreams exceeds its inventory bound.');
	}
	let previousIndex = -1;
	const streams = value.map((entry, position) => {
		const name = `characteristics.audioStreams[${String(position)}]`;
		const candidate = record(entry, name);
		rejectUnknownKeys(candidate, AUDIO_STREAM_KEYS, name);
		const index = boundedInteger(candidate.index, `${name}.index`, VIDEO_SOURCE_MAXIMUM_AUDIO_STREAMS, 0);
		if (index <= previousIndex) throw new RangeError('characteristics.audioStreams must report increasing stream indexes.');
		previousIndex = index;
		return Object.freeze({
			index,
			codec: optionalTag(candidate.codec, `${name}.codec`),
			channelCount: optionalBoundedInteger(
				candidate.channelCount, `${name}.channelCount`, VIDEO_SOURCE_MAXIMUM_AUDIO_CHANNELS,
			),
			sampleRate: optionalBoundedInteger(
				candidate.sampleRate, `${name}.sampleRate`, VIDEO_SOURCE_MAXIMUM_AUDIO_SAMPLE_RATE,
			),
			language: optionalLanguage(candidate.language, `${name}.language`),
		});
	});
	return Object.freeze(streams);
}

function normalizeExtractedIndex(
	value: unknown,
	streams: readonly VideoSourceAudioStream[] | null,
): number | null {
	if (value == null) return null;
	const index = boundedInteger(
		value, 'characteristics.extractedAudioStreamIndex', VIDEO_SOURCE_MAXIMUM_AUDIO_STREAMS, 0,
	);
	if (!streams) throw new RangeError('An extracted audio stream requires a reported stream inventory.');
	if (!streams.some((stream) => stream.index === index)) {
		throw new RangeError('characteristics.extractedAudioStreamIndex names a stream the inventory does not report.');
	}
	return index;
}

function normalizeStartTimecode(value: unknown, rate?: SequenceRationalRate): VideoSourceStartTimecode | null {
	if (value == null) return null;
	const candidate = record(value, 'characteristics.startTimecode');
	rejectUnknownKeys(candidate, START_TIMECODE_KEYS, 'characteristics.startTimecode');
	if (!rate) throw new TypeError('A source frame rate is required to validate a source start timecode.');
	if (typeof candidate.negative !== 'boolean') {
		throw new TypeError('characteristics.startTimecode.negative must be a boolean.');
	}
	if (candidate.negative) throw new RangeError('A source start timecode cannot be negative.');
	if (typeof candidate.dropFrame !== 'boolean') {
		throw new TypeError('characteristics.startTimecode.dropFrame must be a boolean.');
	}
	const dropFrame = candidate.dropFrame;
	if (dropFrame && !isSequenceDropFrameRate(rate)) {
		throw new RangeError('A drop-frame source timecode requires a drop-frame source rate.');
	}
	const timecode = Object.freeze({
		negative: false,
		hours: nonNegativeInteger(candidate.hours, 'characteristics.startTimecode.hours'),
		minutes: nonNegativeInteger(candidate.minutes, 'characteristics.startTimecode.minutes'),
		seconds: nonNegativeInteger(candidate.seconds, 'characteristics.startTimecode.seconds'),
		frames: nonNegativeInteger(candidate.frames, 'characteristics.startTimecode.frames'),
	});
	if (!isLegalSequenceTimecode(timecode, rate, dropFrame)) {
		throw new RangeError('The source start timecode is not a label this source rate produces.');
	}
	return Object.freeze({ ...timecode, dropFrame });
}

function greatestCommonDivisor(left: number, right: number): number {
	let a = left;
	let b = right;
	while (b) {
		const next = a % b;
		a = b;
		b = next;
	}
	return a || 1;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
	for (const key of Object.keys(value)) {
		if (!allowed.includes(key)) throw new RangeError(`${name} carries the unsupported key ${key}.`);
	}
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function optionalBoolean(value: unknown, name: string): boolean | null {
	if (value == null) return null;
	if (typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean when reported.`);
	return value;
}

function optionalMember(value: unknown, allowed: ReadonlySet<unknown>, name: string): unknown {
	if (value == null) return null;
	if (!allowed.has(value)) throw new RangeError(`${name} is unsupported.`);
	return value;
}

function optionalTag(value: unknown, name: string): string | null {
	if (value == null) return null;
	if (typeof value !== 'string') throw new TypeError(`${name} must be text when reported.`);
	if (!value.length || value.length > VIDEO_SOURCE_MAXIMUM_TAG_LENGTH || !TAG.test(value)) {
		throw new RangeError(`${name} must be a bounded printable tag.`);
	}
	return value;
}

function optionalLanguage(value: unknown, name: string): string | null {
	if (value == null) return null;
	if (typeof value !== 'string') throw new TypeError(`${name} must be text when reported.`);
	if (!LANGUAGE.test(value)) throw new RangeError(`${name} must be a language tag.`);
	return value;
}

function optionalBoundedInteger(value: unknown, name: string, maximum: number): number | null {
	return value == null ? null : boundedInteger(value, name, maximum);
}

function boundedInteger(value: unknown, name: string, maximum: number, minimum = 1): number {
	if (!Number.isSafeInteger(value)) throw new TypeError(`${name} must be a safe integer.`);
	const result = Number(value);
	if (result < minimum || result > maximum) throw new RangeError(`${name} is out of range.`);
	return result;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be a non-negative safe integer.`);
	return Number(value);
}
