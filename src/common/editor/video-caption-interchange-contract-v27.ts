/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoCaptionTrackV1 } from './video-caption-track-v27.ts';

export const VIDEO_CAPTION_INTERCHANGE_FORMATS_V1 = Object.freeze([
	'srt', 'webvtt', 'imsc1.1',
] as const);

export const VIDEO_CAPTION_INTERCHANGE_HARD_LIMITS_V1 = Object.freeze({
	maximumInputBytes: 16 * 1024 * 1024,
	maximumElements: 200_000,
	maximumDepth: 64,
	maximumCues: 100_000,
});

export type VideoCaptionInterchangeFormatV1 =
	(typeof VIDEO_CAPTION_INTERCHANGE_FORMATS_V1)[number];

export type VideoCaptionInterchangeLossCodeV1 =
	| 'cue-identity-normalized'
	| 'cue-identity-omitted'
	| 'region-identity-normalized'
	| 'region-omitted'
	| 'sequence-binding-omitted'
	| 'speaker-identity-omitted'
	| 'speaker-identity-normalized'
	| 'speaker-omitted'
	| 'style-identity-normalized'
	| 'style-omitted'
	| 'style-properties-defaulted'
	| 'style-properties-omitted'
	| 'text-lines-normalized'
	| 'timing-quantized'
	| 'track-identity-normalized'
	| 'track-metadata-omitted'
	| 'word-timing-omitted';

export interface VideoCaptionInterchangeLossV1 {
	readonly code: VideoCaptionInterchangeLossCodeV1;
	readonly path: string;
	readonly message: string;
	readonly details: Readonly<Record<string, string | number>>;
}

export interface VideoCaptionInterchangeLimitsV1 {
	readonly maximumInputBytes: number;
	readonly maximumElements: number;
	readonly maximumDepth: number;
	readonly maximumCues: number;
}

interface VideoCaptionInterchangeOptionsV1 {
	readonly format: VideoCaptionInterchangeFormatV1;
	readonly sampleRate: number;
}

export interface VideoCaptionImportOptionsV1 extends VideoCaptionInterchangeOptionsV1 {
	readonly trackId: string;
	readonly sequenceId: string;
	readonly trackName: string;
	readonly language: string;
	readonly limits?: Partial<VideoCaptionInterchangeLimitsV1>;
}

export type VideoCaptionExportOptionsV1 = VideoCaptionInterchangeOptionsV1;

export interface VideoCaptionImportResultV1 {
	readonly format: VideoCaptionInterchangeFormatV1;
	readonly track: VideoCaptionTrackV1;
	readonly losses: readonly VideoCaptionInterchangeLossV1[];
}

export interface VideoCaptionExportResultV1 {
	readonly format: VideoCaptionInterchangeFormatV1;
	readonly mediaType: 'application/ttml+xml' | 'application/x-subrip' | 'text/vtt';
	readonly text: string;
	readonly losses: readonly VideoCaptionInterchangeLossV1[];
}

export type VideoCaptionTrackNormalizerV1 = (value: unknown) => VideoCaptionTrackV1;

export class VideoCaptionInterchangeError extends Error {
	readonly code: string;
	readonly details: Readonly<Record<string, string | number>>;

	constructor(message: string, code: string, details: Record<string, string | number> = {}) {
		super(message);
		this.name = 'VideoCaptionInterchangeError';
		this.code = code;
		this.details = Object.freeze({ ...details });
	}
}

export function resolveCaptionInterchangeFormat(value: unknown): VideoCaptionInterchangeFormatV1 {
	if (typeof value !== 'string'
		|| !(VIDEO_CAPTION_INTERCHANGE_FORMATS_V1 as readonly string[]).includes(value)) {
		throw new RangeError(`Unsupported caption interchange format: ${String(value)}.`);
	}
	return value as VideoCaptionInterchangeFormatV1;
}

export function resolveCaptionSampleRate(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 768_000) {
		throw new RangeError('Caption interchange sampleRate must be a positive safe integer no greater than 768000.');
	}
	return Number(value);
}

export function resolveCaptionInterchangeLimits(
	value: unknown,
): Readonly<VideoCaptionInterchangeLimitsV1> {
	if (value === undefined) return VIDEO_CAPTION_INTERCHANGE_HARD_LIMITS_V1;
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Caption interchange limits must be an object.');
	}
	for (const key of Object.keys(value)) {
		if (!Object.hasOwn(VIDEO_CAPTION_INTERCHANGE_HARD_LIMITS_V1, key)) {
			throw new TypeError(`Unsupported caption interchange limit: ${key}.`);
		}
	}
	const resolved = {
		...VIDEO_CAPTION_INTERCHANGE_HARD_LIMITS_V1,
		...(value as Partial<VideoCaptionInterchangeLimitsV1>),
	};
	for (const key of Object.keys(VIDEO_CAPTION_INTERCHANGE_HARD_LIMITS_V1) as (keyof VideoCaptionInterchangeLimitsV1)[]) {
		const candidate = resolved[key];
		if (!Number.isSafeInteger(candidate) || candidate < 1) {
			throw new RangeError(`Caption interchange ${key} must be a positive safe integer.`);
		}
		if (candidate > VIDEO_CAPTION_INTERCHANGE_HARD_LIMITS_V1[key]) {
			throw new RangeError(`Caption interchange ${key} cannot exceed its hard limit.`);
		}
	}
	return Object.freeze(resolved);
}

export function decodeCaptionInput(
	input: unknown,
	limits: Readonly<VideoCaptionInterchangeLimitsV1>,
): string {
	let text: string;
	let bytes: number;
	if (typeof input === 'string') {
		text = input;
		bytes = new TextEncoder().encode(input).byteLength;
	} else {
		const view = byteView(input);
		bytes = view.byteLength;
		try {
			text = new TextDecoder('utf-8', { fatal: true }).decode(view);
		} catch (error) {
			throw interchangeError('Caption interchange input is not valid UTF-8.', 'INVALID_UTF8', {}, error);
		}
	}
	if (bytes > limits.maximumInputBytes) {
		throw interchangeError('Caption interchange input exceeds its UTF-8 byte limit.', 'INPUT_LIMIT', {
			maximum: limits.maximumInputBytes,
			observed: bytes,
		});
	}
	if (!isWellFormedCaptionInput(text)) {
		throw interchangeError('Caption interchange input contains an unpaired Unicode surrogate.', 'INVALID_UTF8');
	}
	if (/\0/u.test(text)) throw interchangeError('Caption interchange input contains NUL.', 'INVALID_CHARACTER');
	return (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/\r\n?/gu, '\n');
}

export function captionLoss(
	code: VideoCaptionInterchangeLossCodeV1,
	path: string,
	message: string,
	details: Record<string, string | number> = {},
): VideoCaptionInterchangeLossV1 {
	return Object.freeze({ code, path, message, details: Object.freeze({ ...details }) });
}

export function freezeCaptionLosses(
	losses: readonly VideoCaptionInterchangeLossV1[],
): readonly VideoCaptionInterchangeLossV1[] {
	return Object.freeze([...losses]);
}

export function timeUnitsToFrame(
	units: bigint,
	unitsPerSecond: bigint,
	sampleRate: number,
): { readonly frame: number; readonly exact: boolean } {
	if (units < 0n || unitsPerSecond <= 0n) throw interchangeError('Caption time must be non-negative.', 'INVALID_TIMING');
	const scaled = units * BigInt(sampleRate);
	const quotient = scaled / unitsPerSecond;
	const remainder = scaled % unitsPerSecond;
	const rounded = quotient + (remainder * 2n >= unitsPerSecond ? 1n : 0n);
	if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw interchangeError('Caption time exceeds the safe sample-frame range.', 'INVALID_TIMING');
	}
	return Object.freeze({ frame: Number(rounded), exact: remainder === 0n });
}

export function frameToMilliseconds(
	frame: number,
	sampleRate: number,
): { readonly milliseconds: number; readonly exact: boolean } {
	const scaled = BigInt(frame) * 1_000n;
	const divisor = BigInt(sampleRate);
	const quotient = scaled / divisor;
	const remainder = scaled % divisor;
	const rounded = quotient + (remainder * 2n >= divisor ? 1n : 0n);
	if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw interchangeError('Caption time exceeds the millisecond sidecar range.', 'INVALID_TIMING');
	}
	return Object.freeze({ milliseconds: Number(rounded), exact: remainder === 0n });
}

export function assertCaptionOutputBytes(text: string): void {
	const observed = new TextEncoder().encode(text).byteLength;
	const maximum = VIDEO_CAPTION_INTERCHANGE_HARD_LIMITS_V1.maximumInputBytes;
	if (observed > maximum) {
		throw interchangeError('Caption interchange output exceeds its UTF-8 byte limit.', 'OUTPUT_LIMIT', {
			maximum,
			observed,
		});
	}
}

export function interchangeError(
	message: string,
	code: string,
	details: Record<string, string | number> = {},
	cause?: unknown,
): VideoCaptionInterchangeError {
	const error = new VideoCaptionInterchangeError(message, code, details);
	if (cause !== undefined) error.cause = cause;
	return error;
}

function byteView(input: unknown): Uint8Array {
	if (input instanceof Uint8Array) return input;
	if (input instanceof ArrayBuffer) return new Uint8Array(input);
	if (ArrayBuffer.isView(input)) {
		return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
	}
	throw new TypeError('Caption interchange input must be text or bytes.');
}

function isWellFormedCaptionInput(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const unit = value.charCodeAt(index);
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
			index += 1;
		} else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
	}
	return true;
}
