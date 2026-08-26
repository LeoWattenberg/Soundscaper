/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded streaming parser for the fixed FFmpeg scdet/metadata output graph. */

import { StringDecoder } from 'node:string_decoder';

import {
	VIDEO_TIMING_ASSET_MAXIMUM_FRAMES,
	VIDEO_TIMING_ASSET_MAXIMUM_TIMESCALE,
} from '../src/common/editor/video-timing-asset-reference.ts';

export interface ExternalFfmpegShotBoundary {
	/** Zero-based decoded source-frame ordinal. */
	readonly sourceFrame: number;
	/** Origin-normalized source presentation tick, serialized exactly for IPC/JSON. */
	readonly presentationTick: string;
	/** FFmpeg scdet percentage normalized to the unit interval. */
	readonly score: number;
}

export interface ExternalFfmpegShotDetectionResult {
	readonly schemaVersion: 1;
	readonly detector: 'ffmpeg-scdet';
	/** Denominator of the source filter time base after applying its numerator to ticks. */
	readonly timescale: number;
	readonly sourceFrameCount: number;
	readonly boundaries: readonly ExternalFfmpegShotBoundary[];
}

export interface ExternalFfmpegShotOutputParser {
	pushStderr(chunk: unknown): void;
	pushMetadata(chunk: unknown): void;
	finish(): ExternalFfmpegShotDetectionResult;
}

export type ExternalFfmpegShotOutputErrorReason =
	| 'stderr-limit'
	| 'metadata-limit'
	| 'metadata-invalid';

export class ExternalFfmpegShotOutputError extends Error {
	constructor(readonly reason: ExternalFfmpegShotOutputErrorReason, message: string) {
		super(message);
		this.name = 'ExternalFfmpegShotOutputError';
	}
}

const CONFIG = /config in time_base:\s*(\d+)\s*\/\s*(\d+),\s*frame_rate:/iu;
const HEADER = /^frame:(\d+)\s+pts:(-?\d+)\s+pts_time:(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*$/u;
const SCORE = /^lavfi\.scd\.score=(.*)$/u;
const TIME = /^lavfi\.scd\.time=(.*)$/u;
const DECIMAL = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;
const SIGNED_INT64_MINIMUM = -0x8000_0000_0000_0000n;
const SIGNED_INT64_MAXIMUM = 0x7fff_ffff_ffff_ffffn;
const MAXIMUM_LINE_BYTES = 4_096;
const MAXIMUM_STDERR_BYTES = 128 * 1024 * 1024;
const MAXIMUM_METADATA_BYTES = 512 * 1024 * 1024;

interface PendingFrame {
	readonly frame: number;
	readonly pts: bigint;
	scorePercent: number | null;
	hasBoundary: boolean;
}

interface RawBoundary {
	readonly sourceFrame: number;
	readonly pts: bigint;
	readonly score: number;
}

/** Create one-use parsers whose byte and line budgets are enforced while data arrives. */
export function createExternalFfmpegShotOutputParser(limits: Readonly<{
	readonly stderrBytes: number;
	readonly metadataBytes: number;
}>): ExternalFfmpegShotOutputParser {
	const stderrBytes = boundedLimit(limits?.stderrBytes, MAXIMUM_STDERR_BYTES, 'stderr');
	const metadataBytes = boundedLimit(limits?.metadataBytes, MAXIMUM_METADATA_BYTES, 'metadata');
	let timeBaseNumerator = 0;
	let timescale = 0;
	let pending: PendingFrame | null = null;
	let expectedFrame = 0;
	let originPts: bigint | null = null;
	let previousPts: bigint | null = null;
	let finished = false;
	const boundaries: RawBoundary[] = [];

	const invalid = (message: string): ExternalFfmpegShotOutputError => (
		new ExternalFfmpegShotOutputError('metadata-invalid', message)
	);
	const finishPending = (): void => {
		if (pending === null) return;
		if (pending.frame !== expectedFrame) throw invalid('FFmpeg shot frames are not contiguous.');
		if (pending.scorePercent === null) throw invalid('FFmpeg omitted a scene score for a source frame.');
		if (previousPts !== null && pending.pts <= previousPts) {
			throw invalid('FFmpeg shot presentation timestamps are not strictly increasing.');
		}
		originPts ??= pending.pts;
		previousPts = pending.pts;
		if (pending.hasBoundary) boundaries.push(Object.freeze({
			sourceFrame: pending.frame, pts: pending.pts, score: pending.scorePercent / 100,
		}));
		expectedFrame += 1;
		pending = null;
	};
	const stderr = new BoundedLineStream(stderrBytes, 'stderr-limit', (line) => {
		const config = CONFIG.exec(line);
		if (config === null) return;
		const numerator = positiveSafeInteger(config[1], 'FFmpeg shot time-base numerator', invalid);
		const denominator = positiveSafeInteger(config[2], 'FFmpeg shot time-base denominator', invalid);
		if (denominator > VIDEO_TIMING_ASSET_MAXIMUM_TIMESCALE) {
			throw invalid('FFmpeg shot timescale exceeds the timing-asset bound.');
		}
		if (timeBaseNumerator !== 0
			&& (timeBaseNumerator !== numerator || timescale !== denominator)) {
			throw invalid('FFmpeg changed the shot source time base during detection.');
		}
		timeBaseNumerator = numerator;
		timescale = denominator;
	});
	const metadata = new BoundedLineStream(metadataBytes, 'metadata-limit', (line) => {
		if (line === '') return;
		const header = HEADER.exec(line);
		if (header !== null) {
			finishPending();
			const frame = nonNegativeSafeInteger(header[1], 'FFmpeg shot frame', invalid);
			if (frame >= VIDEO_TIMING_ASSET_MAXIMUM_FRAMES) {
				throw invalid('FFmpeg shot frame count exceeds the timing-asset bound.');
			}
			const pts = BigInt(header[2]!);
			if (pts < SIGNED_INT64_MINIMUM || pts > SIGNED_INT64_MAXIMUM) {
				throw invalid('FFmpeg shot PTS exceeds signed 64-bit authority.');
			}
			pending = { frame, pts, scorePercent: null, hasBoundary: false };
			return;
		}
		if (line.startsWith('frame:')) throw invalid('FFmpeg emitted a malformed shot frame header.');
		const score = SCORE.exec(line);
		if (score !== null) {
			if (pending === null || pending.scorePercent !== null) {
				throw invalid('FFmpeg emitted an unbound or duplicate scene score.');
			}
			pending.scorePercent = percentage(score[1], invalid);
			return;
		}
		const time = TIME.exec(line);
		if (time !== null) {
			if (pending === null || pending.hasBoundary || !validDecimal(time[1])) {
				throw invalid('FFmpeg emitted malformed or duplicate scene-boundary metadata.');
			}
			pending.hasBoundary = true;
		}
	});

	return Object.freeze({
		pushStderr(chunk: unknown): void {
			if (finished) throw invalid('FFmpeg shot output parsing is already complete.');
			stderr.push(chunk);
		},
		pushMetadata(chunk: unknown): void {
			if (finished) throw invalid('FFmpeg shot output parsing is already complete.');
			metadata.push(chunk);
		},
		finish(): ExternalFfmpegShotDetectionResult {
			if (finished) throw invalid('FFmpeg shot output parsing is already complete.');
			finished = true;
			stderr.finish();
			metadata.finish();
			finishPending();
			if (timeBaseNumerator === 0 || timescale === 0 || expectedFrame === 0 || originPts === null) {
				throw invalid('FFmpeg did not report a complete shot timing stream.');
			}
			const normalized = boundaries.map((boundary) => {
				const tick = (boundary.pts - originPts!) * BigInt(timeBaseNumerator);
				if (tick < 0n || tick > SIGNED_INT64_MAXIMUM) {
					throw invalid('FFmpeg shot presentation ticks exceed signed 64-bit authority.');
				}
				return Object.freeze({
					sourceFrame: boundary.sourceFrame,
					presentationTick: tick.toString(),
					score: boundary.score,
				});
			});
			return Object.freeze({
				schemaVersion: 1,
				detector: 'ffmpeg-scdet',
				timescale,
				sourceFrameCount: expectedFrame,
				boundaries: Object.freeze(normalized),
			});
		},
	});
}

class BoundedLineStream {
	readonly #decoder = new StringDecoder('utf8');
	#bytes = 0;
	#pending = '';
	#finished = false;

	constructor(
		readonly maximumBytes: number,
		readonly limitReason: 'stderr-limit' | 'metadata-limit',
		readonly accept: (line: string) => void,
	) {}

	push(chunk: unknown): void {
		if (this.#finished) throw outputInvalid('FFmpeg shot output stream is already complete.');
		const bytes = chunkBytes(chunk);
		this.#bytes += bytes.byteLength;
		if (this.#bytes > this.maximumBytes) {
			throw new ExternalFfmpegShotOutputError(
				this.limitReason,
				`FFmpeg exceeded its bounded shot ${this.limitReason === 'stderr-limit' ? 'stderr' : 'metadata'} output.`,
			);
		}
		this.#append(this.#decoder.write(bytes));
	}

	finish(): void {
		if (this.#finished) throw outputInvalid('FFmpeg shot output stream is already complete.');
		this.#finished = true;
		this.#append(this.#decoder.end());
		if (this.#pending !== '') this.#acceptLine(this.#pending);
		this.#pending = '';
	}

	#append(text: string): void {
		this.#pending += text;
		let newline = this.#pending.indexOf('\n');
		while (newline !== -1) {
			this.#acceptLine(this.#pending.slice(0, newline));
			this.#pending = this.#pending.slice(newline + 1);
			newline = this.#pending.indexOf('\n');
		}
		if (Buffer.byteLength(this.#pending, 'utf8') > MAXIMUM_LINE_BYTES) {
			throw outputInvalid('FFmpeg shot output contains an oversized line.');
		}
	}

	#acceptLine(value: string): void {
		const line = value.endsWith('\r') ? value.slice(0, -1) : value;
		if (Buffer.byteLength(line, 'utf8') > MAXIMUM_LINE_BYTES) {
			throw outputInvalid('FFmpeg shot output contains an oversized line.');
		}
		this.accept(line);
	}
}

function percentage(
	value: string | undefined,
	invalid: (message: string) => ExternalFfmpegShotOutputError,
): number {
	if (!validDecimal(value)) throw invalid('FFmpeg emitted a malformed scene score.');
	const result = Number(value);
	if (result < 0 || result > 100) throw invalid('FFmpeg scene score falls outside zero through 100.');
	return result;
}

function validDecimal(value: string | undefined): boolean {
	return typeof value === 'string' && DECIMAL.test(value) && Number.isFinite(Number(value));
}

function positiveSafeInteger(
	value: string | undefined,
	label: string,
	invalid: (message: string) => ExternalFfmpegShotOutputError,
): number {
	const result = Number(value);
	if (!Number.isSafeInteger(result) || result <= 0) throw invalid(`${label} is invalid.`);
	return result;
}

function nonNegativeSafeInteger(
	value: string | undefined,
	label: string,
	invalid: (message: string) => ExternalFfmpegShotOutputError,
): number {
	const result = Number(value);
	if (!Number.isSafeInteger(result) || result < 0) throw invalid(`${label} is invalid.`);
	return result;
}

function boundedLimit(value: unknown, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
		throw new RangeError(`External FFmpeg shot ${label} limit is invalid.`);
	}
	return Number(value);
}

function outputInvalid(message: string): ExternalFfmpegShotOutputError {
	return new ExternalFfmpegShotOutputError('metadata-invalid', message);
}

function chunkBytes(chunk: unknown): Buffer {
	if (Buffer.isBuffer(chunk)) return chunk;
	if (chunk instanceof Uint8Array) return Buffer.from(chunk);
	return Buffer.from(String(chunk));
}
