/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The boundary where a recognition result becomes a transcript.
 *
 * Speech models report float seconds and routinely emit boundaries that
 * overlap by a few milliseconds or run a hair past the utterance they belong
 * to. The transcript domain refuses all of that, deliberately: inside the
 * editor a position is an exact integer sample frame. So the conforming
 * happens here, once, at the edge — the same split the video ingest uses, where
 * a probe result is conformed on the way in rather than tolerated everywhere
 * downstream.
 *
 * Every conforming decision is counted and returned. A caller reports what was
 * adjusted instead of presenting a silently repaired transcript as exact.
 */

import { createAssistanceTranscript, type AssistanceTranscript } from './transcript.ts';

export interface RecognizedWord {
	readonly text: string;
	readonly startSeconds: number;
	readonly endSeconds: number;
	readonly confidence?: number | null;
}

export interface RecognizedSegment {
	readonly startSeconds: number;
	readonly endSeconds: number;
	readonly text?: string;
	readonly words?: readonly RecognizedWord[];
	readonly speaker?: string | null;
}

export interface RecognitionResult {
	readonly language?: string | null;
	readonly segments: readonly RecognizedSegment[];
}

export interface TranscriptIngestOptions {
	readonly sourceId: string;
	readonly sampleRate: number;
	readonly modelId: string;
	/** Clamps every boundary inside the media when its length is known. */
	readonly sourceFrameCount?: number | null;
}

export interface TranscriptIngestReport {
	readonly transcript: AssistanceTranscript;
	/** Segments that carried no frames after rounding and were dropped. */
	readonly droppedSegments: number;
	/** Words that carried no text and were dropped. */
	readonly droppedWords: number;
	/** Boundaries moved to keep the result ordered and inside its parent. */
	readonly conformedBoundaries: number;
}

function assertSeconds(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new RangeError(`${label} must be a finite, non-negative number of seconds.`);
	}
	return value;
}

/**
 * Rounds to the nearest sample. Recognition timing is already approximate, so
 * rounding to nearest keeps the error symmetric instead of biasing every
 * boundary one direction the way truncation would.
 */
function secondsToFrame(seconds: number, sampleRate: number, label: string): number {
	const frame = Math.round(assertSeconds(seconds, label) * sampleRate);
	if (!Number.isSafeInteger(frame)) {
		throw new RangeError(`${label} does not land on a representable sample frame.`);
	}
	return frame;
}

interface ConformState {
	conformed: number;
}

function clampFrame(frame: number, low: number, high: number | null, state: ConformState): number {
	let value = frame;
	if (value < low) {
		value = low;
		state.conformed += 1;
	}
	if (high !== null && value > high) {
		value = high;
		state.conformed += 1;
	}
	return value;
}

/**
 * Conforms a recognition result onto the project's sample grid.
 *
 * Ordering is enforced by construction: each boundary is clamped to at least
 * the previous one, so an overlap reported by the model becomes an abutment
 * rather than a refusal the user cannot act on. A segment or word left with no
 * frames is dropped and counted.
 */
export function ingestRecognitionResult(
	result: RecognitionResult,
	options: TranscriptIngestOptions,
): TranscriptIngestReport {
	const sampleRate = options?.sampleRate;
	if (!Number.isSafeInteger(sampleRate) || (sampleRate as number) <= 0) {
		throw new RangeError('Ingesting a recognition result needs a positive integer sample rate.');
	}
	const segments = result?.segments;
	if (!Array.isArray(segments)) {
		throw new TypeError('A recognition result needs an array of segments.');
	}
	const limit = options.sourceFrameCount ?? null;
	if (limit !== null && (!Number.isSafeInteger(limit) || limit < 0)) {
		throw new RangeError('A source frame count must be a non-negative integer when supplied.');
	}

	const state: ConformState = { conformed: 0 };
	let droppedSegments = 0;
	let droppedWords = 0;
	const conformedSegments: {
		startFrame: number;
		endFrame: number;
		text?: string;
		words: { text: string; startFrame: number; endFrame: number; confidence: number | null }[];
		speaker: string | null;
	}[] = [];
	let segmentFloor = 0;

	for (const [index, segment] of segments.entries()) {
		const label = `Recognized segment ${index}`;
		const rawStart = secondsToFrame(segment?.startSeconds, sampleRate, `${label} start`);
		const rawEnd = secondsToFrame(segment?.endSeconds, sampleRate, `${label} end`);
		const startFrame = clampFrame(rawStart, segmentFloor, limit, state);
		const endFrame = clampFrame(Math.max(rawEnd, startFrame), startFrame, limit, state);
		if (endFrame <= startFrame) {
			droppedSegments += 1;
			continue;
		}

		const words: { text: string; startFrame: number; endFrame: number; confidence: number | null }[] = [];
		let wordFloor = startFrame;
		for (const [wordIndex, word] of (segment.words ?? []).entries()) {
			const wordLabel = `${label} word ${wordIndex}`;
			if (typeof word?.text !== 'string' || word.text.trim() === '') {
				droppedWords += 1;
				continue;
			}
			const rawWordStart = secondsToFrame(word.startSeconds, sampleRate, `${wordLabel} start`);
			const rawWordEnd = secondsToFrame(word.endSeconds, sampleRate, `${wordLabel} end`);
			const wordStart = clampFrame(rawWordStart, wordFloor, endFrame, state);
			const wordEnd = clampFrame(Math.max(rawWordEnd, wordStart), wordStart, endFrame, state);
			words.push({
				text: word.text,
				startFrame: wordStart,
				endFrame: wordEnd,
				confidence: word.confidence ?? null,
			});
			wordFloor = wordEnd;
		}

		const text = typeof segment.text === 'string' && segment.text.trim() !== ''
			? segment.text
			: words.map(({ text: value }) => value).join(' ');
		if (text.trim() === '') {
			droppedSegments += 1;
			continue;
		}

		conformedSegments.push({
			startFrame,
			endFrame,
			text,
			words,
			speaker: segment.speaker ?? null,
		});
		segmentFloor = endFrame;
	}

	const transcript = createAssistanceTranscript({
		sourceId: options.sourceId,
		sampleRate: sampleRate as number,
		language: result.language ?? null,
		modelId: options.modelId,
		segments: conformedSegments,
	});

	return Object.freeze({
		transcript,
		droppedSegments,
		droppedWords,
		conformedBoundaries: state.conformed,
	});
}
