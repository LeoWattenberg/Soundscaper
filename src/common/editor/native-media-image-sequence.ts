/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Resolve a set of chosen files into one image sequence, or refuse.
 *
 * Everything here happens before the project is touched. A sequence with a
 * missing frame, a duplicate frame number, mixed stems, or an inconsistent
 * zero-padding width is rejected outright rather than imported and quietly
 * repaired, because a silently-renumbered sequence renders subtly wrong footage
 * that nothing downstream can detect.
 *
 * Ordering is numeric and explicit. The frame number is the trailing run of
 * digits before the extension, compared as an integer, so `frame_2.png` sorts
 * before `frame_10.png` — which lexical ordering would get backwards. The
 * frame rate is never inferred from file names or timestamps: the user selects
 * an exact rational, because a sequence carries no timing of its own and any
 * guess would become the project's authoritative timebase.
 */

import {
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_COUNT,
} from './video-keyframe-encoder-admission.ts';

export const NATIVE_MEDIA_IMAGE_SEQUENCE_EXTENSIONS: readonly string[] = Object.freeze([
	'png', 'tif', 'tiff', 'exr',
]);

export const NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_FRAMES = VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_COUNT;
export const NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_FRAME_NUMBER = 1_000_000_000;
export const NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_RATE_TERM = 1_000_000;

export const NATIVE_MEDIA_IMAGE_SEQUENCE_REFUSALS = Object.freeze([
	'no-numbered-frames',
	'mixed-sequences',
	'unsupported-extension',
	'inconsistent-frame-number-width',
	'duplicate-frame-numbers',
	'missing-frame-numbers',
	'too-many-frames',
	'frame-rate-not-exact',
] as const);

export type NativeMediaImageSequenceRefusal =
	(typeof NATIVE_MEDIA_IMAGE_SEQUENCE_REFUSALS)[number];

export class NativeMediaImageSequenceError extends Error {
	readonly refusal: NativeMediaImageSequenceRefusal;
	/** The exact frame numbers or names that caused the refusal, bounded. */
	readonly detail: readonly (number | string)[];

	constructor(
		refusal: NativeMediaImageSequenceRefusal,
		message: string,
		detail: readonly (number | string)[] = [],
	) {
		super(message);
		this.name = 'NativeMediaImageSequenceError';
		this.refusal = refusal;
		this.detail = Object.freeze([...detail]);
	}
}

export interface NativeMediaImageSequenceRateV1 {
	readonly num: number;
	readonly den: number;
}

export interface NativeMediaImageSequenceFrameV1 {
	readonly index: number;
	readonly frameNumber: number;
	readonly fileName: string;
}

export interface NativeMediaImageSequenceV1 {
	readonly stem: string;
	readonly extension: string;
	/** Zero-padding width, or 0 when the sequence is unpadded. */
	readonly frameNumberWidth: number;
	readonly firstFrameNumber: number;
	readonly lastFrameNumber: number;
	readonly frameCount: number;
	readonly frameRate: NativeMediaImageSequenceRateV1;
	readonly frames: readonly NativeMediaImageSequenceFrameV1[];
}

export interface NativeMediaImageSequenceRequestV1 {
	readonly fileNames: readonly string[];
	/** User-selected exact rational rate; a sequence states no timing itself. */
	readonly frameRate: NativeMediaImageSequenceRateV1;
}

interface ParsedName {
	readonly fileName: string;
	readonly stem: string;
	readonly extension: string;
	readonly digits: string;
	readonly frameNumber: number;
}

const MAXIMUM_DETAIL_ENTRIES = 32;
const NAME_PATTERN = /^(?<stem>.*?)(?<digits>\d+)\.(?<extension>[A-Za-z0-9]+)$/u;

/**
 * Resolve one image sequence from the files the user chose.
 *
 * Missing and duplicate frame numbers are reported with the exact numbers
 * involved rather than a count, because "frames 118 to 121 are missing" is
 * actionable and "the sequence is incomplete" is not.
 */
export function resolveNativeMediaImageSequence(
	request: NativeMediaImageSequenceRequestV1,
): NativeMediaImageSequenceV1 {
	const frameRate = exactFrameRate(request.frameRate);
	const parsed = parseFileNames(request.fileNames);
	assertSingleSequence(parsed);
	const { stem, extension } = parsed[0]!;
	const frameNumberWidth = resolveFrameNumberWidth(parsed);
	const byNumber = new Map<number, ParsedName>();
	const duplicates: number[] = [];
	for (const entry of parsed) {
		if (byNumber.has(entry.frameNumber)) duplicates.push(entry.frameNumber);
		else byNumber.set(entry.frameNumber, entry);
	}
	if (duplicates.length > 0) {
		throw new NativeMediaImageSequenceError(
			'duplicate-frame-numbers',
			'An image sequence must not name the same frame number twice.',
			bounded([...new Set(duplicates)].sort((left, right) => left - right)),
		);
	}
	const frameNumbers = [...byNumber.keys()].sort((left, right) => left - right);
	const firstFrameNumber = frameNumbers[0]!;
	const lastFrameNumber = frameNumbers.at(-1)!;
	const missing: number[] = [];
	for (let number = firstFrameNumber; number <= lastFrameNumber; number += 1) {
		if (!byNumber.has(number)) missing.push(number);
		if (missing.length > MAXIMUM_DETAIL_ENTRIES) break;
	}
	if (missing.length > 0) {
		throw new NativeMediaImageSequenceError(
			'missing-frame-numbers',
			'An image sequence must be continuous; missing frames are not filled in.',
			bounded(missing),
		);
	}
	if (frameNumbers.length > NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_FRAMES) {
		throw new NativeMediaImageSequenceError(
			'too-many-frames',
			'An image sequence exceeds the encoder frame-count ceiling.',
		);
	}
	return Object.freeze({
		stem,
		extension,
		frameNumberWidth,
		firstFrameNumber,
		lastFrameNumber,
		frameCount: frameNumbers.length,
		frameRate,
		frames: Object.freeze(frameNumbers.map((frameNumber, index) => Object.freeze({
			index,
			frameNumber,
			fileName: byNumber.get(frameNumber)!.fileName,
		}))),
	});
}

/** The printf-style pattern a sequence would be addressed by, for diagnostics. */
export function nativeMediaImageSequencePattern(sequence: NativeMediaImageSequenceV1): string {
	const digits = sequence.frameNumberWidth === 0 ? '%d' : `%0${sequence.frameNumberWidth}d`;
	return `${sequence.stem}${digits}.${sequence.extension}`;
}

function parseFileNames(value: unknown): readonly ParsedName[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new NativeMediaImageSequenceError(
			'no-numbered-frames',
			'An image sequence requires at least one numbered file.',
		);
	}
	const parsed: ParsedName[] = [];
	const unsupported: string[] = [];
	const unnumbered: string[] = [];
	for (const candidate of value as readonly unknown[]) {
		if (typeof candidate !== 'string' || candidate.length === 0 || candidate.includes('/')
			|| candidate.includes('\\') || candidate.includes('\0')) {
			throw new NativeMediaImageSequenceError(
				'no-numbered-frames',
				'An image sequence entry must be one plain file name.',
			);
		}
		const match = NAME_PATTERN.exec(candidate);
		if (!match?.groups) {
			unnumbered.push(candidate);
			continue;
		}
		const extension = match.groups.extension!.toLowerCase();
		if (!NATIVE_MEDIA_IMAGE_SEQUENCE_EXTENSIONS.includes(extension)) {
			unsupported.push(candidate);
			continue;
		}
		const digits = match.groups.digits!;
		const frameNumber = Number(digits);
		if (!Number.isSafeInteger(frameNumber)
			|| frameNumber > NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_FRAME_NUMBER) {
			throw new NativeMediaImageSequenceError(
				'no-numbered-frames',
				'An image sequence frame number exceeds its bound.',
				[candidate],
			);
		}
		parsed.push({ fileName: candidate, stem: match.groups.stem!, extension, digits, frameNumber });
	}
	if (unsupported.length > 0) {
		throw new NativeMediaImageSequenceError(
			'unsupported-extension',
			'An image sequence admits only the licensed still formats.',
			bounded(unsupported),
		);
	}
	if (unnumbered.length > 0) {
		throw new NativeMediaImageSequenceError(
			'no-numbered-frames',
			'Every image-sequence file must carry a trailing frame number.',
			bounded(unnumbered),
		);
	}
	return parsed;
}

function assertSingleSequence(parsed: readonly ParsedName[]): void {
	const groups = new Set(parsed.map((entry) => `${entry.stem}|${entry.extension}`));
	if (groups.size > 1) {
		throw new NativeMediaImageSequenceError(
			'mixed-sequences',
			'One import authors exactly one sequence; choose files with a single stem and extension.',
			bounded([...groups].sort()),
		);
	}
}

/**
 * A padded sequence must pad consistently. Mixing `frame_01` with `frame_001`
 * makes the intended numbering ambiguous, and guessing it is how a sequence
 * ends up silently reordered.
 */
function resolveFrameNumberWidth(parsed: readonly ParsedName[]): number {
	const padded = parsed.some((entry) => entry.digits.length > 1 && entry.digits.startsWith('0'));
	// Unpadded numbering legitimately changes width as it crosses a decade,
	// so only a sequence that pads at all is held to one width.
	if (!padded) return 0;
	const widths = new Set(parsed.map((entry) => entry.digits.length));
	if (widths.size > 1) {
		throw new NativeMediaImageSequenceError(
			'inconsistent-frame-number-width',
			'A zero-padded image sequence must pad every frame number to the same width.',
			bounded([...widths].sort((left, right) => left - right)),
		);
	}
	return [...widths][0]!;
}

function exactFrameRate(value: unknown): NativeMediaImageSequenceRateV1 {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new NativeMediaImageSequenceError(
			'frame-rate-not-exact',
			'An image sequence requires the user-selected exact rational frame rate.',
		);
	}
	const candidate = value as Record<string, unknown>;
	const keys = Object.keys(candidate);
	const num = candidate.num;
	const den = candidate.den;
	if (keys.length !== 2 || !keys.includes('num') || !keys.includes('den')
		|| !Number.isSafeInteger(num) || (num as number) <= 0
		|| (num as number) > NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_RATE_TERM
		|| !Number.isSafeInteger(den) || (den as number) <= 0
		|| (den as number) > NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_RATE_TERM
		|| greatestCommonDivisor(num as number, den as number) !== 1) {
		throw new NativeMediaImageSequenceError(
			'frame-rate-not-exact',
			'An image-sequence frame rate must be a bounded positive rational.',
		);
	}
	return Object.freeze({ num: num as number, den: den as number });
}

function greatestCommonDivisor(left: number, right: number): number {
	while (right !== 0) [left, right] = [right, left % right];
	return left;
}

function bounded(values: readonly (number | string)[]): readonly (number | string)[] {
	return values.length > MAXIMUM_DETAIL_ENTRIES
		? values.slice(0, MAXIMUM_DETAIL_ENTRIES)
		: values;
}
