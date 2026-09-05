/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded semantic review of authenticated local-assistance output bodies. */

import {
	MAX_TRANSCRIPT_SEGMENTS,
	MAX_TRANSCRIPT_WORDS_PER_SEGMENT,
} from './transcript.ts';
import {
	reviewAssistanceEmbeddingMatrixV1,
	type ReviewedAssistanceEmbeddingMatrixV1,
} from './binary-formats-v1.ts';
import {
	reviewAssistanceAudioTagsV1,
	reviewAssistanceBeatGridV1,
	reviewAssistanceEditorialProposalV1,
	reviewAssistanceWordAlignmentV1,
	type AssistanceAudioTagsV1,
	type AssistanceBeatGridV1,
	type AssistanceEditorialProposalV1,
	type AssistanceWordAlignmentV1,
} from './m7-semantic-results.ts';
import type { LocalAssistanceOutputClaim } from './local-assistance-bridge.ts';
import {
	reviewLocalAssistanceShotBoundaries,
	type LocalAssistanceShotBoundariesReview,
} from './local-assistance-shot-review.ts';
import { inspectWavBlobPcm } from '../wav-import.js';
import {
	reviewAssistanceOcrResultV1,
	reviewAssistanceSaliencyResultV1,
	reviewAssistanceSubjectResultV1,
	type AssistanceOcrResultV1,
	type AssistanceSaliencyResultV1,
	type AssistanceSubjectResultV1,
	type AssistanceVisualFrameAuthorityV1,
} from './visual-semantic-results-v1.ts';

const MAXIMUM_REVIEW_BYTES = 8 * 1024 * 1024;
const MAXIMUM_SAMPLE_RANGES = 100_000;
const REVIEW_SAMPLE_RATE = 16_000;
const TRANSCRIPT_MEDIA_TYPES = new Set([
	'application/json',
	'application/vnd.soundscaper.transcript+json',
]);
const VOICE_ACTIVITY_MEDIA_TYPES = new Set([
	'application/json',
	'application/vnd.soundscaper.voice-activity+json',
]);
const SPEAKER_TURN_MEDIA_TYPES = new Set([
	'application/json',
	'application/vnd.soundscaper.speaker-turns+json',
]);
const SHOT_BOUNDARY_MEDIA_TYPES = new Set([
	'application/json',
	'application/vnd.soundscaper.shot-boundaries+json',
]);
const WORD_ALIGNMENT_MEDIA_TYPES = new Set([
	'application/json',
	'application/vnd.soundscaper.word-alignment+json',
]);
const AUDIO_TAG_MEDIA_TYPES = new Set([
	'application/json',
	'application/vnd.soundscaper.audio-tags+json',
]);
const BEAT_GRID_MEDIA_TYPES = new Set([
	'application/json',
	'application/vnd.soundscaper.beat-grid+json',
]);
const EDITORIAL_PROPOSAL_MEDIA_TYPES = new Set([
	'application/json',
	'application/vnd.soundscaper.editorial-proposal+json',
]);
const EMBEDDING_MATRIX_MEDIA_TYPES = new Set([
	'application/vnd.soundscaper.embedding-matrix-v1',
]);
const AUDIO_WAVE_MEDIA_TYPES = new Set(['audio/wav']);
const RECOGNIZED_TEXT_MEDIA_TYPES = new Set([
	'application/json', 'application/vnd.soundscaper.recognized-text+json',
]);
const SUBJECT_TRACK_MEDIA_TYPES = new Set([
	'application/json', 'application/vnd.soundscaper.subject-tracks+json',
]);
const SALIENCY_MAP_MEDIA_TYPES = new Set([
	'application/json', 'application/vnd.soundscaper.saliency-map+json',
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

export interface LocalAssistanceSampleRangeReview {
	readonly startSample: number;
	readonly sampleCount: number;
}

export interface LocalAssistanceVoiceActivityReview {
	readonly kind: 'voice-activity';
	readonly sampleRate: 16_000;
	readonly segments: readonly LocalAssistanceSampleRangeReview[];
}

export interface LocalAssistanceSpeakerTurnReview extends LocalAssistanceSampleRangeReview {
	readonly speakerId: number;
}

export interface LocalAssistanceSpeakerTurnsReview {
	readonly kind: 'speaker-turns';
	readonly sampleRate: 16_000;
	readonly turns: readonly LocalAssistanceSpeakerTurnReview[];
}

export type LocalAssistanceWordAlignmentReview = Readonly<{
	readonly kind: 'word-alignment';
}> & AssistanceWordAlignmentV1;

export type LocalAssistanceAudioTagsReview = Readonly<{
	readonly kind: 'audio-tags';
}> & AssistanceAudioTagsV1;

export type LocalAssistanceBeatGridReview = Readonly<{
	readonly kind: 'beat-grid';
}> & AssistanceBeatGridV1;

export type LocalAssistanceEmbeddingsReview = Readonly<{
	readonly kind: 'embeddings';
}> & ReviewedAssistanceEmbeddingMatrixV1;

export type LocalAssistanceEditorialProposalReview = Readonly<{
	readonly kind: 'editorial-proposal';
}> & AssistanceEditorialProposalV1;

export interface LocalAssistanceAudioWaveGeometry {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
}

export interface LocalAssistanceAudioWaveReview extends LocalAssistanceAudioWaveGeometry {
	readonly kind: 'audio-wave';
	readonly role: 'enhanced-audio' | 'separated-audio';
	readonly sampleFormat: 'float32';
}

export type LocalAssistanceOcrReview = Readonly<{ readonly kind: 'recognized-text' }>
	& AssistanceOcrResultV1;
export type LocalAssistanceSubjectReview = Readonly<{ readonly kind: 'subject-tracks' }>
	& AssistanceSubjectResultV1;
export type LocalAssistanceSaliencyReview = Readonly<{ readonly kind: 'saliency-map' }>
	& AssistanceSaliencyResultV1;

export interface LocalAssistanceReviewAuthority {
	readonly editorialCandidateIds?: readonly string[];
	readonly audioWave?: LocalAssistanceAudioWaveGeometry;
	readonly visualFrames?: AssistanceVisualFrameAuthorityV1;
}

export type LocalAssistanceOutputReview =
	| LocalAssistanceTranscriptReview
	| LocalAssistanceVoiceActivityReview
	| LocalAssistanceSpeakerTurnsReview
	| LocalAssistanceShotBoundariesReview
	| LocalAssistanceWordAlignmentReview
	| LocalAssistanceAudioTagsReview
	| LocalAssistanceBeatGridReview
	| LocalAssistanceEmbeddingsReview
	| LocalAssistanceEditorialProposalReview
	| LocalAssistanceAudioWaveReview
	| LocalAssistanceOcrReview
	| LocalAssistanceSubjectReview
	| LocalAssistanceSaliencyReview;

export async function reviewLocalAssistanceOutput(
	claim: LocalAssistanceOutputClaim,
	body: Blob,
	authority: LocalAssistanceReviewAuthority = {},
): Promise<LocalAssistanceOutputReview> {
	if (!reviewMediaType(claim)) {
		throw new TypeError('This local-assistance output has no semantic reviewer.');
	}
	if (!(body instanceof Blob) || body.size !== claim.byteLength
		|| body.size < 1 || (!isAudioWaveRole(claim.role) && body.size > MAXIMUM_REVIEW_BYTES)) {
		throw new RangeError('The local-assistance review body exceeds its exact bound.');
	}
	if (isAudioWaveRole(claim.role)) return audioWaveReview(claim.role, body, authority.audioWave);
	const bytes = await body.arrayBuffer();
	if (claim.role === 'embeddings') {
		return withReviewKind('embeddings', reviewAssistanceEmbeddingMatrixV1(bytes));
	}
	let value: unknown;
	try {
		const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		value = JSON.parse(text) as unknown;
	} catch {
		throw new TypeError(claim.role === 'transcript'
			? 'The local-assistance transcript is not valid UTF-8 JSON.'
			: 'The local-assistance output is not valid UTF-8 JSON.');
	}
	if (claim.role === 'voice-activity') return voiceActivityReview(value);
	if (claim.role === 'speaker-turns') return speakerTurnsReview(value);
	if (claim.role === 'shot-boundaries') return reviewLocalAssistanceShotBoundaries(value);
	if (claim.role === 'word-alignment') {
		return withReviewKind('word-alignment', reviewAssistanceWordAlignmentV1(value));
	}
	if (claim.role === 'audio-tags') {
		return withReviewKind('audio-tags', reviewAssistanceAudioTagsV1(value));
	}
	if (claim.role === 'beat-grid') {
		return withReviewKind('beat-grid', reviewAssistanceBeatGridV1(value));
	}
	if (claim.role === 'editorial-proposal') {
		if (!authority.editorialCandidateIds) {
			throw new TypeError('Editorial semantic review requires exact candidate authority.');
		}
		return withReviewKind('editorial-proposal', reviewAssistanceEditorialProposalV1(
			value, authority.editorialCandidateIds,
		));
	}
	if (claim.role === 'recognized-text') {
		return withReviewKind('recognized-text', reviewAssistanceOcrResultV1(
			value, authority.visualFrames,
		));
	}
	if (claim.role === 'subject-tracks') {
		return withReviewKind('subject-tracks', reviewAssistanceSubjectResultV1(
			value, authority.visualFrames,
		));
	}
	if (claim.role === 'saliency-map') {
		return withReviewKind('saliency-map', reviewAssistanceSaliencyResultV1(
			value, authority.visualFrames,
		));
	}
	return transcriptReview(value);
}

function reviewMediaType(claim: LocalAssistanceOutputClaim): boolean {
	if (isAudioWaveRole(claim.role)) return AUDIO_WAVE_MEDIA_TYPES.has(claim.mediaType);
	if (claim.role === 'transcript') return TRANSCRIPT_MEDIA_TYPES.has(claim.mediaType);
	if (claim.role === 'voice-activity') return VOICE_ACTIVITY_MEDIA_TYPES.has(claim.mediaType);
	if (claim.role === 'speaker-turns') return SPEAKER_TURN_MEDIA_TYPES.has(claim.mediaType);
	if (claim.role === 'shot-boundaries') return SHOT_BOUNDARY_MEDIA_TYPES.has(claim.mediaType);
	if (claim.role === 'word-alignment') return WORD_ALIGNMENT_MEDIA_TYPES.has(claim.mediaType);
	if (claim.role === 'audio-tags') return AUDIO_TAG_MEDIA_TYPES.has(claim.mediaType);
	if (claim.role === 'beat-grid') return BEAT_GRID_MEDIA_TYPES.has(claim.mediaType);
	if (claim.role === 'embeddings') return EMBEDDING_MATRIX_MEDIA_TYPES.has(claim.mediaType);
	if (claim.role === 'recognized-text') return RECOGNIZED_TEXT_MEDIA_TYPES.has(claim.mediaType);
	if (claim.role === 'subject-tracks') return SUBJECT_TRACK_MEDIA_TYPES.has(claim.mediaType);
	if (claim.role === 'saliency-map') return SALIENCY_MAP_MEDIA_TYPES.has(claim.mediaType);
	if (claim.role === 'editorial-proposal') {
		return EDITORIAL_PROPOSAL_MEDIA_TYPES.has(claim.mediaType);
	}
	return false;
}

function isAudioWaveRole(
	role: LocalAssistanceOutputClaim['role'],
): role is LocalAssistanceAudioWaveReview['role'] {
	return role === 'enhanced-audio' || role === 'separated-audio';
}

async function audioWaveReview(
	role: LocalAssistanceAudioWaveReview['role'],
	body: Blob,
	authorityValue: LocalAssistanceAudioWaveGeometry | undefined,
): Promise<LocalAssistanceAudioWaveReview> {
	const authority = exactAudioWaveGeometry(authorityValue);
	const descriptor = await inspectWavBlobPcm(body) as Readonly<{
		container: string;
		encoding: string;
		sampleFormat: string;
		formatTag: number;
		subFormatTag: number;
		sampleRate: number;
		channelCount: number;
		frameCount: number;
		bitDepth: number;
		validBitsPerSample: number;
		bytesPerSample: number;
		dataOffset: number;
		dataByteLength: number;
		riffByteLength: number;
		sourceByteLength: number;
	}>;
	if (descriptor.container !== 'wav' || descriptor.encoding !== 'ieee-float'
		|| descriptor.sampleFormat !== 'float32' || descriptor.formatTag !== 3
		|| descriptor.subFormatTag !== 3 || descriptor.bitDepth !== 32
		|| descriptor.validBitsPerSample !== 32 || descriptor.bytesPerSample !== 4) {
		throw new TypeError('The local-assistance audio result must be a Float32 WAV.');
	}
	if (descriptor.sampleRate !== authority.sampleRate
		|| descriptor.channelCount !== authority.channelCount
		|| descriptor.frameCount !== authority.frameCount) {
		throw new RangeError('The local-assistance WAV does not preserve its exact audio geometry.');
	}
	const dataByteLength = authority.frameCount * authority.channelCount * 4;
	if (!Number.isSafeInteger(dataByteLength) || descriptor.dataOffset !== 44
		|| descriptor.dataByteLength !== dataByteLength
		|| descriptor.dataOffset + dataByteLength !== body.size
		|| descriptor.riffByteLength !== body.size || descriptor.sourceByteLength !== body.size) {
		throw new RangeError('The local-assistance WAV is not the canonical geometry-exact body.');
	}
	return Object.freeze({
		kind: 'audio-wave', role, sampleRate: authority.sampleRate,
		channelCount: authority.channelCount, frameCount: authority.frameCount,
		sampleFormat: 'float32',
	});
}

function exactAudioWaveGeometry(
	value: LocalAssistanceAudioWaveGeometry | undefined,
): LocalAssistanceAudioWaveGeometry {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Reflect.ownKeys(value).length !== 3
		|| !Number.isSafeInteger(value.sampleRate) || value.sampleRate < 8_000
		|| value.sampleRate > 384_000
		|| !Number.isSafeInteger(value.channelCount) || value.channelCount < 1
		|| value.channelCount > 64
		|| !Number.isSafeInteger(value.frameCount) || value.frameCount < 1) {
		throw new TypeError('Local-assistance WAV review requires exact audio geometry authority.');
	}
	return Object.freeze({ sampleRate: value.sampleRate,
		channelCount: value.channelCount, frameCount: value.frameCount });
}

function withReviewKind<Kind extends string, Result extends Readonly<object>>(
	kind: Kind,
	result: Result,
): Readonly<{ readonly kind: Kind }> & Result {
	return Object.freeze({ kind, ...result });
}

function voiceActivityReview(value: unknown): LocalAssistanceVoiceActivityReview {
	const record = exactRecord(value, ['sampleRate', 'segments'], 'voice-activity result');
	exactReviewSampleRate(record.sampleRate, 'voice-activity result');
	if (!Array.isArray(record.segments) || record.segments.length > MAXIMUM_SAMPLE_RANGES) {
		throw new RangeError('The local-assistance voice-activity result exceeds its segment bound.');
	}
	let previousEnd = 0;
	const segments = record.segments.map((candidate, index) => {
		const segment = sampleRange(candidate, ['startSample', 'sampleCount'],
			`voice-activity segment ${index}`);
		if (segment.startSample < previousEnd) {
			throw new RangeError('Local-assistance voice-activity segments must be ordered and disjoint.');
		}
		previousEnd = segment.startSample + segment.sampleCount;
		return segment;
	});
	return Object.freeze({
		kind: 'voice-activity', sampleRate: REVIEW_SAMPLE_RATE, segments: Object.freeze(segments),
	});
}

function speakerTurnsReview(value: unknown): LocalAssistanceSpeakerTurnsReview {
	const record = exactRecord(value, ['sampleRate', 'turns'], 'speaker-turns result');
	exactReviewSampleRate(record.sampleRate, 'speaker-turns result');
	if (!Array.isArray(record.turns) || record.turns.length > MAXIMUM_SAMPLE_RANGES) {
		throw new RangeError('The local-assistance speaker-turns result exceeds its turn bound.');
	}
	let previous: LocalAssistanceSpeakerTurnReview | null = null;
	const turns = record.turns.map((candidate, index): LocalAssistanceSpeakerTurnReview => {
		const label = `speaker turn ${index}`;
		const range = sampleRange(candidate, ['startSample', 'sampleCount', 'speakerId'], label);
		const speakerId = exactSafeInteger((candidate as Record<string, unknown>).speakerId, 0,
			`${label} speaker ID`);
		const turn = Object.freeze({ ...range, speakerId });
		if (previous && compareSpeakerTurns(previous, turn) > 0) {
			throw new RangeError('Local-assistance speaker turns are not in stable order.');
		}
		previous = turn;
		return turn;
	});
	return Object.freeze({
		kind: 'speaker-turns', sampleRate: REVIEW_SAMPLE_RATE, turns: Object.freeze(turns),
	});
}

function sampleRange(
	value: unknown,
	keys: readonly string[],
	label: string,
): LocalAssistanceSampleRangeReview {
	const record = exactRecord(value, keys, label);
	const startSample = exactSafeInteger(record.startSample, 0, `${label} start`);
	const sampleCount = exactSafeInteger(record.sampleCount, 1, `${label} count`);
	if (!Number.isSafeInteger(startSample + sampleCount)) {
		throw new RangeError(`The local-assistance ${label} exceeds safe timing.`);
	}
	return Object.freeze({ startSample, sampleCount });
}

function exactReviewSampleRate(value: unknown, label: string): asserts value is 16_000 {
	if (value !== REVIEW_SAMPLE_RATE) {
		throw new RangeError(`The local-assistance ${label} must use the exact 16 kHz review rate.`);
	}
}

function exactSafeInteger(value: unknown, minimum: number, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum) {
		throw new RangeError(`The local-assistance ${label} is invalid.`);
	}
	return value as number;
}

function compareSpeakerTurns(
	left: LocalAssistanceSpeakerTurnReview,
	right: LocalAssistanceSpeakerTurnReview,
): number {
	return compareInteger(left.startSample, right.startSample)
		|| compareInteger(left.speakerId, right.speakerId)
		|| compareInteger(left.sampleCount, right.sampleCount);
}

function compareInteger(left: number, right: number): number {
	return left === right ? 0 : left < right ? -1 : 1;
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
