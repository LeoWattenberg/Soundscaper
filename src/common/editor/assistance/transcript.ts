/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The transcript an on-device speech model produces, expressed in the
 * project's canonical coordinate.
 *
 * Recognition reports seconds; this module refuses them. Every boundary is an
 * integer sample frame, converted once at the adapter edge, so a transcript
 * compares, sorts, and abuts exactly like every other editorial position. A
 * transcript is a derived asset: it is produced from persisted media, it is
 * replaced whole rather than merged, and nothing here mutates a project.
 */

export const ASSISTANCE_TRANSCRIPT_SCHEMA_VERSION = 1;

/** A transcript may not exceed these bounds; a longer result is refused. */
export const MAX_TRANSCRIPT_SEGMENTS = 100_000;
export const MAX_TRANSCRIPT_WORDS_PER_SEGMENT = 1_000;

export interface TranscriptWord {
	readonly text: string;
	readonly startFrame: number;
	readonly endFrame: number;
	/** Model confidence in the unit interval, or null when unreported. */
	readonly confidence: number | null;
}

export interface TranscriptSegment {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly text: string;
	readonly words: readonly TranscriptWord[];
	/** A diarization label when one was produced, otherwise null. */
	readonly speaker: string | null;
}

export interface AssistanceTranscript {
	readonly schemaVersion: typeof ASSISTANCE_TRANSCRIPT_SCHEMA_VERSION;
	readonly sourceId: string;
	readonly sampleRate: number;
	/** BCP-47 tag the model reported, or null when it reported none. */
	readonly language: string | null;
	readonly modelId: string;
	readonly segments: readonly TranscriptSegment[];
}

export interface TranscriptDraftWord {
	readonly text: string;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly confidence?: number | null;
}

export interface TranscriptDraftSegment {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly text?: string;
	readonly words?: readonly TranscriptDraftWord[];
	readonly speaker?: string | null;
}

export interface TranscriptDraft {
	readonly sourceId: string;
	readonly sampleRate: number;
	readonly language?: string | null;
	readonly modelId: string;
	readonly segments: readonly TranscriptDraftSegment[];
}

function assertFrame(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new RangeError(`${label} must be a non-negative integer sample frame.`);
	}
	return value as number;
}

function assertNonEmptyString(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new TypeError(`${label} must be a non-empty string.`);
	}
	return value;
}

function normalizeConfidence(value: unknown, label: string): number | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
		throw new RangeError(`${label} confidence must be null or within the unit interval.`);
	}
	return value;
}

function normalizeWord(draft: TranscriptDraftWord, index: number, segmentIndex: number): TranscriptWord {
	const label = `Segment ${segmentIndex} word ${index}`;
	const startFrame = assertFrame(draft?.startFrame, `${label} start`);
	const endFrame = assertFrame(draft?.endFrame, `${label} end`);
	if (endFrame < startFrame) {
		throw new RangeError(`${label} ends before it starts.`);
	}
	return Object.freeze({
		text: assertNonEmptyString(draft?.text, `${label} text`),
		startFrame,
		endFrame,
		confidence: normalizeConfidence(draft?.confidence, label),
	});
}

function normalizeSegment(draft: TranscriptDraftSegment, index: number): TranscriptSegment {
	const label = `Segment ${index}`;
	const startFrame = assertFrame(draft?.startFrame, `${label} start`);
	const endFrame = assertFrame(draft?.endFrame, `${label} end`);
	if (endFrame <= startFrame) {
		throw new RangeError(`${label} must cover at least one sample frame.`);
	}
	const drafts = draft.words ?? [];
	if (drafts.length > MAX_TRANSCRIPT_WORDS_PER_SEGMENT) {
		throw new RangeError(`${label} exceeds the word ceiling.`);
	}
	const words = drafts.map((word, wordIndex) => normalizeWord(word, wordIndex, index));
	let previousEnd = -1;
	for (const word of words) {
		if (word.startFrame < previousEnd) {
			throw new RangeError(`${label} words overlap.`);
		}
		if (word.startFrame < startFrame || word.endFrame > endFrame) {
			throw new RangeError(`${label} words must stay inside the segment.`);
		}
		previousEnd = word.endFrame;
	}
	const text = draft.text === undefined
		? words.map(({ text: value }) => value).join(' ')
		: assertNonEmptyString(draft.text, `${label} text`);
	if (text.trim() === '') {
		throw new TypeError(`${label} text must be a non-empty string.`);
	}
	const speaker = draft.speaker === undefined || draft.speaker === null
		? null
		: assertNonEmptyString(draft.speaker, `${label} speaker`);
	return Object.freeze({ startFrame, endFrame, text, words: Object.freeze(words), speaker });
}

/**
 * Validates a recognition result and freezes it into a transcript. Segments
 * must be ordered and non-overlapping: an overlap would make one sample frame
 * belong to two utterances, which no downstream edit could resolve.
 */
export function createAssistanceTranscript(draft: TranscriptDraft): AssistanceTranscript {
	const sampleRate = draft?.sampleRate;
	if (!Number.isSafeInteger(sampleRate) || (sampleRate as number) <= 0) {
		throw new RangeError('A transcript sample rate must be a positive integer.');
	}
	const segmentDrafts = draft?.segments ?? [];
	if (!Array.isArray(segmentDrafts)) {
		throw new TypeError('A transcript needs an array of segments.');
	}
	if (segmentDrafts.length > MAX_TRANSCRIPT_SEGMENTS) {
		throw new RangeError('A transcript exceeds the segment ceiling.');
	}
	const segments = segmentDrafts.map(normalizeSegment);
	let previousEnd = -1;
	for (const [index, segment] of segments.entries()) {
		if (segment.startFrame < previousEnd) {
			throw new RangeError(`Segment ${index} overlaps the segment before it.`);
		}
		previousEnd = segment.endFrame;
	}
	return Object.freeze({
		schemaVersion: ASSISTANCE_TRANSCRIPT_SCHEMA_VERSION,
		sourceId: assertNonEmptyString(draft?.sourceId, 'A transcript source id'),
		sampleRate: sampleRate as number,
		language: draft.language === undefined || draft.language === null
			? null
			: assertNonEmptyString(draft.language, 'A transcript language'),
		modelId: assertNonEmptyString(draft?.modelId, 'A transcript model id'),
		segments: Object.freeze(segments),
	});
}

export interface TranscriptLabelDraft {
	readonly title: string;
	readonly startFrame: number;
	readonly endFrame: number;
}

export interface TranscriptLabelOptions {
	/** Prefixes each label with its speaker when diarization produced one. */
	readonly includeSpeaker?: boolean;
}

/**
 * Maps segments onto label-track entries. Labels are the surface transcripts
 * land on today: they already round-trip SubRip and WebVTT, so a transcript
 * exports as captions without inventing a schema before milestone 4 owns one.
 */
export function transcriptToLabelDrafts(
	transcript: AssistanceTranscript,
	options: TranscriptLabelOptions = {},
): readonly TranscriptLabelDraft[] {
	const includeSpeaker = options.includeSpeaker ?? true;
	return Object.freeze(transcript.segments.map((segment) => Object.freeze({
		title: includeSpeaker && segment.speaker ? `${segment.speaker}: ${segment.text}` : segment.text,
		startFrame: segment.startFrame,
		endFrame: segment.endFrame,
	})));
}

/** Every word in order, flattened across segments. */
export function transcriptWords(transcript: AssistanceTranscript): readonly TranscriptWord[] {
	return Object.freeze(transcript.segments.flatMap((segment) => [...segment.words]));
}

/** The segments overlapping a half-open frame range, in order. */
export function transcriptSegmentsInRange(
	transcript: AssistanceTranscript,
	startFrame: number,
	endFrame: number,
): readonly TranscriptSegment[] {
	assertFrame(startFrame, 'A range start');
	assertFrame(endFrame, 'A range end');
	return Object.freeze(transcript.segments.filter(
		(segment) => segment.startFrame < endFrame && segment.endFrame > startFrame,
	));
}

/**
 * Whether the transcript carries usable word timing. A model that reports only
 * segment boundaries cannot drive filler removal or word-level captions, and
 * callers must degrade rather than fabricate positions.
 */
export function hasWordTiming(transcript: AssistanceTranscript): boolean {
	return transcript.segments.length > 0
		&& transcript.segments.every((segment) => segment.words.length > 0);
}
