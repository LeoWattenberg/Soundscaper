/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded semantic review of authenticated local-assistance output bodies. */

import {
	MAX_TRANSCRIPT_SEGMENTS,
	MAX_TRANSCRIPT_WORDS_PER_SEGMENT,
} from '../assistance/transcript.ts';
import type { LocalAssistanceOutputClaim } from './local-assistance-bridge.ts';

const MAXIMUM_REVIEW_BYTES = 8 * 1024 * 1024;
const TRANSCRIPT_MEDIA_TYPES = new Set([
	'application/json',
	'application/vnd.soundscaper.transcript+json',
]);
const SEGMENT_KEYS = Object.freeze([
	'startSeconds', 'endSeconds', 'text', 'words', 'speaker',
]);
const WORD_KEYS = Object.freeze([
	'text', 'startSeconds', 'endSeconds', 'confidence',
]);

export interface LocalAssistanceTranscriptReviewWord {
	readonly text: string;
	readonly startSeconds: number;
	readonly endSeconds: number;
	readonly confidence: number | null;
}

export interface LocalAssistanceTranscriptReviewSegment {
	readonly startSeconds: number;
	readonly endSeconds: number;
	readonly text: string;
	readonly words: readonly LocalAssistanceTranscriptReviewWord[];
	readonly speaker: string | null;
}

export interface LocalAssistanceTranscriptReview {
	readonly kind: 'transcript';
	readonly language: string | null;
	readonly segments: readonly LocalAssistanceTranscriptReviewSegment[];
}

export type LocalAssistanceOutputReview = LocalAssistanceTranscriptReview;

export async function reviewLocalAssistanceOutput(
	claim: LocalAssistanceOutputClaim,
	body: Blob,
): Promise<LocalAssistanceOutputReview> {
	if (claim.role !== 'transcript' || !TRANSCRIPT_MEDIA_TYPES.has(claim.mediaType)) {
		throw new TypeError('This local-assistance output has no semantic reviewer.');
	}
	if (!(body instanceof Blob) || body.size !== claim.byteLength
		|| body.size < 1 || body.size > MAXIMUM_REVIEW_BYTES) {
		throw new RangeError('The local-assistance review body exceeds its exact bound.');
	}
	let value: unknown;
	try {
		const text = new TextDecoder('utf-8', { fatal: true }).decode(await body.arrayBuffer());
		value = JSON.parse(text) as unknown;
	} catch {
		throw new TypeError('The local-assistance transcript is not valid UTF-8 JSON.');
	}
	return transcriptReview(value);
}

function transcriptReview(value: unknown): LocalAssistanceTranscriptReview {
	const record = exactRecord(value, ['language', 'segments'], 'transcript');
	const language = nullableText(record.language, 64, 'transcript language');
	if (!Array.isArray(record.segments) || record.segments.length > MAX_TRANSCRIPT_SEGMENTS) {
		throw new RangeError('The local-assistance transcript has an invalid segment inventory.');
	}
	let previousEnd = 0;
	const segments = record.segments.map((candidate, index) => {
		const segment = reviewSegment(candidate, index);
		if (index > 0 && segment.startSeconds < previousEnd) {
			throw new RangeError('Local-assistance transcript segments overlap.');
		}
		previousEnd = segment.endSeconds;
		return segment;
	});
	return Object.freeze({ kind: 'transcript', language, segments: Object.freeze(segments) });
}

function reviewSegment(value: unknown, index: number): LocalAssistanceTranscriptReviewSegment {
	const record = admittedRecord(value, SEGMENT_KEYS, ['startSeconds', 'endSeconds'], `segment ${index}`);
	const startSeconds = seconds(record.startSeconds, `segment ${index} start`);
	const endSeconds = seconds(record.endSeconds, `segment ${index} end`);
	if (endSeconds <= startSeconds) throw new RangeError(`Local-assistance segment ${index} has no duration.`);
	const candidates = record.words ?? [];
	if (!Array.isArray(candidates) || candidates.length > MAX_TRANSCRIPT_WORDS_PER_SEGMENT) {
		throw new RangeError(`Local-assistance segment ${index} has an invalid word inventory.`);
	}
	let previousEnd = startSeconds;
	const words = candidates.map((candidate, wordIndex) => {
		const word = reviewWord(candidate, index, wordIndex);
		if (word.startSeconds < previousEnd || word.startSeconds < startSeconds
			|| word.endSeconds > endSeconds) {
			throw new RangeError(`Local-assistance segment ${index} words exceed their timing authority.`);
		}
		previousEnd = word.endSeconds;
		return word;
	});
	const authoredText = record.text === undefined ? null : boundedText(
		record.text, 16_384, `segment ${index} text`,
	);
	const text = authoredText ?? words.map((word) => word.text).join(' ');
	if (text === '') throw new TypeError(`Local-assistance segment ${index} has no reviewable text.`);
	return Object.freeze({
		startSeconds,
		endSeconds,
		text,
		words: Object.freeze(words),
		speaker: nullableText(record.speaker, 160, `segment ${index} speaker`),
	});
}

function reviewWord(
	value: unknown,
	segmentIndex: number,
	wordIndex: number,
): LocalAssistanceTranscriptReviewWord {
	const label = `segment ${segmentIndex} word ${wordIndex}`;
	const record = admittedRecord(value, WORD_KEYS,
		['text', 'startSeconds', 'endSeconds'], label);
	const startSeconds = seconds(record.startSeconds, `${label} start`);
	const endSeconds = seconds(record.endSeconds, `${label} end`);
	if (endSeconds < startSeconds) throw new RangeError(`Local-assistance ${label} ends before it starts.`);
	const confidence = record.confidence ?? null;
	if (confidence !== null && (typeof confidence !== 'number' || !Number.isFinite(confidence)
		|| confidence < 0 || confidence > 1)) {
		throw new RangeError(`Local-assistance ${label} confidence is invalid.`);
	}
	return Object.freeze({
		text: boundedText(record.text, 512, `${label} text`),
		startSeconds,
		endSeconds,
		confidence,
	});
}

function seconds(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new RangeError(`The local-assistance ${label} is invalid.`);
	}
	return value;
}

function nullableText(value: unknown, maximum: number, label: string): string | null {
	return value === undefined || value === null ? null : boundedText(value, maximum, label);
}

function boundedText(value: unknown, maximum: number, label: string): string {
	if (typeof value !== 'string' || value.trim() === '' || value.length > maximum) {
		throw new TypeError(`The local-assistance ${label} is invalid.`);
	}
	return value;
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
	const record = plainRecord(value, label);
	const present = Object.keys(record);
	if (present.length !== keys.length || present.some((key) => !keys.includes(key))) {
		throw new TypeError(`The local-assistance ${label} has unsupported fields.`);
	}
	return record;
}

function admittedRecord(
	value: unknown,
	keys: readonly string[],
	required: readonly string[],
	label: string,
): Record<string, unknown> {
	const record = plainRecord(value, label);
	const present = Object.keys(record);
	if (present.some((key) => !keys.includes(key)) || required.some((key) => !Object.hasOwn(record, key))) {
		throw new TypeError(`The local-assistance ${label} has unsupported fields.`);
	}
	return record;
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`The local-assistance ${label} must be a plain record.`);
	}
	return value as Record<string, unknown>;
}
