/* SPDX-License-Identifier: AGPL-3.0-only */

/** Canonical, content-addressed publication of one reviewed speech transcript. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	ASSISTANCE_ASSET_REFERENCE_LIMITS_V1,
	ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1,
	ASSISTANCE_TRANSCRIPT_STORAGE_KEY_PREFIX_V1,
	createAssistanceAssetReferenceV1,
	type AssistanceTranscriptAssetReferenceV1,
} from './assistance-asset-reference-v1.ts';
import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
	type ClosedDomainRecord,
} from '../closed-domain-value.ts';
import {
	validateAssistanceSelectionFence,
	type AssistanceSelectionFence,
} from './proposal-session.ts';
import {
	ingestRecognitionResult,
	type RecognitionResult,
} from './transcript-ingest.ts';
import {
	createAssistanceTranscript,
	MAX_TRANSCRIPT_SEGMENTS,
	MAX_TRANSCRIPT_WORDS_PER_SEGMENT,
	type AssistanceTranscript,
} from './transcript.ts';

const REQUEST_FIELDS = Object.freeze([
	'assetId', 'review', 'selectedMedia', 'model', 'recipe',
] as const);
const REVIEW_FIELDS = Object.freeze(['kind', 'language', 'segments'] as const);
const SEGMENT_FIELDS = Object.freeze([
	'startSeconds', 'endSeconds', 'text', 'words', 'speaker',
] as const);
const WORD_FIELDS = Object.freeze([
	'text', 'startSeconds', 'endSeconds', 'confidence',
] as const);
const SELECTED_MEDIA_FIELDS = Object.freeze([
	'selectionFence', 'sampleRate', 'sourceVideoTimingSha256',
] as const);
const MODEL_FIELDS = Object.freeze(['modelId', 'artifactSha256s'] as const);
const RECIPE_FIELDS = Object.freeze(['id', 'version'] as const);
const SHA256 = /^[a-f0-9]{64}$/u;
const MODEL_ID = /^[a-z\d](?:[a-z\d.-]{0,62}[a-z\d])?$/u;
const UTF8 = new TextEncoder();

export interface AssistanceSpeechRecognitionReviewWordV1 {
	readonly text: string;
	readonly startSeconds: number;
	readonly endSeconds: number;
	readonly confidence: number | null;
}

export interface AssistanceSpeechRecognitionReviewSegmentV1 {
	readonly startSeconds: number;
	readonly endSeconds: number;
	readonly text: string;
	readonly words: readonly AssistanceSpeechRecognitionReviewWordV1[];
	readonly speaker: string | null;
}

/** Structural match for the renderer's already semantically reviewed transcript result. */
export interface AssistanceSpeechRecognitionReviewV1 {
	readonly kind: 'transcript';
	readonly language: string | null;
	readonly segments: readonly AssistanceSpeechRecognitionReviewSegmentV1[];
}

export interface AssistanceTranscriptSelectedMediaMetadataV1 {
	readonly selectionFence: AssistanceSelectionFence;
	readonly sampleRate: number;
	readonly sourceVideoTimingSha256: string | null;
}

export interface AssistanceTranscriptModelMetadataV1 {
	readonly modelId: string;
	readonly artifactSha256s: readonly string[];
}

export interface AssistanceTranscriptRecipeMetadataV1 {
	readonly id: string;
	readonly version: number;
}

export interface AssistanceTranscriptBodyPublicationRequestV1 {
	readonly assetId: string;
	readonly review: AssistanceSpeechRecognitionReviewV1;
	readonly selectedMedia: AssistanceTranscriptSelectedMediaMetadataV1;
	readonly model: AssistanceTranscriptModelMetadataV1;
	readonly recipe: AssistanceTranscriptRecipeMetadataV1;
}

export interface AssistanceTranscriptBodyPublicationV1 {
	readonly reference: Readonly<AssistanceTranscriptAssetReferenceV1>;
	/** Canonical absolute source-frame body used to derive `bytes`. */
	readonly body: AssistanceTranscript;
	readonly bytes: Uint8Array<ArrayBuffer>;
	/** Retained so acceptance can revalidate and project source frames through the occurrence. */
	readonly selectionFence: AssistanceSelectionFence;
	readonly normalization: Readonly<{
		readonly conformedBoundaries: number;
	}>;
}

/**
 * Convert an already reviewed speech result once at the canonical boundary,
 * authenticate its exact bytes, and bind it to the selected source authority.
 */
export function createAssistanceTranscriptBodyPublicationV1(
	value: AssistanceTranscriptBodyPublicationRequestV1,
): AssistanceTranscriptBodyPublicationV1 {
	const request = readClosedDomainRecord(value, 'assistance transcript publication', REQUEST_FIELDS);
	const review = normalizeReview(field(request, 'review', 'assistance transcript publication'));
	const selectedMedia = normalizeSelectedMedia(
		field(request, 'selectedMedia', 'assistance transcript publication'),
	);
	const model = normalizeModel(field(request, 'model', 'assistance transcript publication'));
	const recipe = normalizeRecipe(field(request, 'recipe', 'assistance transcript publication'));
	const selectionFrames = selectedMedia.selectionFence.sourceEndFrame
		- selectedMedia.selectionFence.sourceStartFrame;
	const report = ingestRecognitionResult(review, {
		sourceId: selectedMedia.selectionFence.sourceId,
		sampleRate: selectedMedia.sampleRate,
		modelId: model.modelId,
		sourceFrameCount: selectionFrames,
	});
	if (report.droppedSegments !== 0 || report.droppedWords !== 0) {
		throw new RangeError('Canonical transcript publication would drop reviewed speech content.');
	}
	const body = offsetTranscript(report.transcript, selectedMedia.selectionFence.sourceStartFrame);
	const bytes = Uint8Array.from(UTF8.encode(JSON.stringify(body)));
	if (bytes.byteLength > ASSISTANCE_ASSET_REFERENCE_LIMITS_V1.maximumBodyBytes) {
		throw new RangeError('The canonical assistance transcript body exceeds its maximum byte length.');
	}
	const bodySha256 = bytesToHex(sha256(bytes));
	const reference = createAssistanceAssetReferenceV1({
		id: field(request, 'assetId', 'assistance transcript publication'),
		kind: 'transcript-v1',
		sourceId: selectedMedia.selectionFence.sourceId,
		sourceSha256: selectedMedia.selectionFence.sourceSha256,
		sourceStartFrame: selectedMedia.selectionFence.sourceStartFrame,
		sourceEndFrame: selectedMedia.selectionFence.sourceEndFrame,
		sourceVideoTimingSha256: selectedMedia.sourceVideoTimingSha256,
		recipeId: recipe.id,
		recipeVersion: recipe.version,
		modelArtifactSha256s: model.artifactSha256s,
		body: {
			storageKey: `${ASSISTANCE_TRANSCRIPT_STORAGE_KEY_PREFIX_V1}${bodySha256}`,
			mimeType: ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1,
			byteLength: bytes.byteLength,
			sha256: bodySha256,
		},
	});
	return Object.freeze({
		reference,
		body,
		bytes,
		selectionFence: selectedMedia.selectionFence,
		normalization: Object.freeze({ conformedBoundaries: report.conformedBoundaries }),
	});
}

function normalizeReview(value: unknown): RecognitionResult {
	const review = readClosedDomainRecord(value, 'assistance transcript review', REVIEW_FIELDS);
	if (field(review, 'kind', 'assistance transcript review') !== 'transcript') {
		throw new RangeError('An assistance transcript review must use the transcript kind.');
	}
	const languageValue = field(review, 'language', 'assistance transcript review');
	const language = languageValue === null
		? null
		: boundedText(languageValue, 64, 'assistance transcript review language');
	const segmentValues = readClosedDomainArray(
		field(review, 'segments', 'assistance transcript review'),
		'assistance transcript review segments',
		0,
		MAX_TRANSCRIPT_SEGMENTS,
	);
	let previousEnd = 0;
	const segments = segmentValues.map((candidate, index) => {
		const segment = normalizeReviewSegment(candidate, index);
		if (index > 0 && segment.startSeconds < previousEnd) {
			throw new RangeError('Assistance transcript review segments overlap.');
		}
		previousEnd = segment.endSeconds;
		return segment;
	});
	return Object.freeze({ language, segments: Object.freeze(segments) });
}

function normalizeReviewSegment(
	value: unknown,
	index: number,
): AssistanceSpeechRecognitionReviewSegmentV1 {
	const name = `assistance transcript review segment ${String(index)}`;
	const segment = readClosedDomainRecord(value, name, SEGMENT_FIELDS);
	const startSeconds = seconds(field(segment, 'startSeconds', name), `${name} start`);
	const endSeconds = seconds(field(segment, 'endSeconds', name), `${name} end`);
	if (endSeconds <= startSeconds) throw new RangeError(`${name} must have positive duration.`);
	const wordValues = readClosedDomainArray(
		field(segment, 'words', name),
		`${name} words`,
		0,
		MAX_TRANSCRIPT_WORDS_PER_SEGMENT,
	);
	let previousEnd = startSeconds;
	const words = wordValues.map((candidate, wordIndex) => {
		const word = normalizeReviewWord(candidate, index, wordIndex);
		if (word.startSeconds < previousEnd || word.startSeconds < startSeconds
			|| word.endSeconds > endSeconds) {
			throw new RangeError(`${name} words exceed their timing authority.`);
		}
		previousEnd = word.endSeconds;
		return word;
	});
	const speakerValue = field(segment, 'speaker', name);
	return Object.freeze({
		startSeconds,
		endSeconds,
		text: boundedText(field(segment, 'text', name), 16_384, `${name} text`),
		words: Object.freeze(words),
		speaker: speakerValue === null ? null : boundedText(speakerValue, 160, `${name} speaker`),
	});
}

function normalizeReviewWord(
	value: unknown,
	segmentIndex: number,
	wordIndex: number,
): AssistanceSpeechRecognitionReviewWordV1 {
	const name = `assistance transcript review segment ${String(segmentIndex)} word ${String(wordIndex)}`;
	const word = readClosedDomainRecord(value, name, WORD_FIELDS);
	const startSeconds = seconds(field(word, 'startSeconds', name), `${name} start`);
	const endSeconds = seconds(field(word, 'endSeconds', name), `${name} end`);
	if (endSeconds < startSeconds) throw new RangeError(`${name} ends before it starts.`);
	const confidenceValue = field(word, 'confidence', name);
	if (confidenceValue !== null && (typeof confidenceValue !== 'number'
		|| !Number.isFinite(confidenceValue) || confidenceValue < 0 || confidenceValue > 1)) {
		throw new RangeError(`${name} confidence must be null or within the unit interval.`);
	}
	const confidence = typeof confidenceValue === 'number' && Object.is(confidenceValue, -0)
		? 0
		: confidenceValue;
	return Object.freeze({
		text: boundedText(field(word, 'text', name), 512, `${name} text`),
		startSeconds,
		endSeconds,
		confidence: confidence as number | null,
	});
}

function normalizeSelectedMedia(value: unknown): Readonly<AssistanceTranscriptSelectedMediaMetadataV1> {
	const selected = readClosedDomainRecord(value, 'assistance transcript selected media', SELECTED_MEDIA_FIELDS);
	return Object.freeze({
		selectionFence: validateAssistanceSelectionFence(
			field(selected, 'selectionFence', 'assistance transcript selected media'),
		),
		sampleRate: positiveInteger(
			field(selected, 'sampleRate', 'assistance transcript selected media'),
			'assistance transcript sample rate',
		),
		sourceVideoTimingSha256: optionalDigest(
			field(selected, 'sourceVideoTimingSha256', 'assistance transcript selected media'),
			'assistance transcript source video timing digest',
		),
	});
}

function normalizeModel(value: unknown): Readonly<AssistanceTranscriptModelMetadataV1> {
	const model = readClosedDomainRecord(value, 'assistance transcript model metadata', MODEL_FIELDS);
	const modelId = field(model, 'modelId', 'assistance transcript model metadata');
	if (typeof modelId !== 'string' || !MODEL_ID.test(modelId)) {
		throw new TypeError('Assistance transcript model metadata needs an exact catalog model ID.');
	}
	const artifactValues = readClosedDomainArray(
		field(model, 'artifactSha256s', 'assistance transcript model metadata'),
		'assistance transcript model artifact digests',
		1,
		ASSISTANCE_ASSET_REFERENCE_LIMITS_V1.maximumModelArtifacts,
	);
	const artifactSha256s = artifactValues.map((candidate) => digest(
		candidate,
		'assistance transcript model artifact digest',
	)).sort();
	if (artifactSha256s.some((candidate, index) => index > 0
		&& candidate === artifactSha256s[index - 1])) {
		throw new RangeError('Assistance transcript model artifact digests must be sorted and unique.');
	}
	return Object.freeze({ modelId, artifactSha256s: Object.freeze(artifactSha256s) });
}

function normalizeRecipe(value: unknown): Readonly<AssistanceTranscriptRecipeMetadataV1> {
	const recipe = readClosedDomainRecord(value, 'assistance transcript recipe metadata', RECIPE_FIELDS);
	const recipeId = field(recipe, 'id', 'assistance transcript recipe metadata');
	if (typeof recipeId !== 'string') {
		throw new TypeError('Assistance transcript recipe metadata needs a canonical recipe ID.');
	}
	return Object.freeze({
		id: recipeId,
		version: positiveInteger(
			field(recipe, 'version', 'assistance transcript recipe metadata'),
			'assistance transcript recipe version',
		),
	});
}

function offsetTranscript(transcript: AssistanceTranscript, offset: number): AssistanceTranscript {
	return createAssistanceTranscript({
		sourceId: transcript.sourceId,
		sampleRate: transcript.sampleRate,
		language: transcript.language,
		modelId: transcript.modelId,
		segments: transcript.segments.map((segment) => ({
			startFrame: addFrame(segment.startFrame, offset),
			endFrame: addFrame(segment.endFrame, offset),
			text: segment.text,
			words: segment.words.map((word) => ({
				text: word.text,
				startFrame: addFrame(word.startFrame, offset),
				endFrame: addFrame(word.endFrame, offset),
				confidence: word.confidence,
			})),
			speaker: segment.speaker,
		})),
	});
}

function field(record: ClosedDomainRecord, name: string, owner: string): unknown {
	return readClosedDomainField(record, name, owner);
}

function seconds(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new RangeError(`${name} must be finite non-negative seconds.`);
	}
	return Object.is(value, -0) ? 0 : value;
}

function boundedText(value: unknown, maximum: number, name: string): string {
	if (typeof value !== 'string' || value.trim() === '' || value.length > maximum) {
		throw new TypeError(`${name} must be bounded non-empty text.`);
	}
	return value;
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) {
		throw new TypeError(`${name} must be a lowercase SHA-256 digest.`);
	}
	return value;
}

function optionalDigest(value: unknown, name: string): string | null {
	return value === null ? null : digest(value, name);
}

function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}

function addFrame(frame: number, offset: number): number {
	const value = frame + offset;
	if (!Number.isSafeInteger(value)) {
		throw new RangeError('An assistance transcript frame exceeds the canonical source coordinate.');
	}
	return value;
}
