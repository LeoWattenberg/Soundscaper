/* SPDX-License-Identifier: AGPL-3.0-only */

/** Tokenizer-owned, deterministic transcript preparation for nomic semantic search. */

import {
	ASSISTANCE_TRANSCRIPT_SCHEMA_VERSION,
	createAssistanceTranscript,
	type AssistanceTranscript,
} from './transcript.ts';

export const ASSISTANCE_TRANSCRIPT_INDEX_SCHEMA_VERSION = 1 as const;
export const ASSISTANCE_TRANSCRIPT_INDEX_TOKEN_LIMIT = 256 as const;
export const ASSISTANCE_TRANSCRIPT_INDEX_TOKEN_OVERLAP = 32 as const;
export const ASSISTANCE_NOMIC_DOCUMENT_PREFIX = 'search_document: ' as const;
export const ASSISTANCE_NOMIC_QUERY_PREFIX = 'search_query: ' as const;

const MAXIMUM_DOCUMENT_TOKENS = 4_000_000;
const MAXIMUM_SEGMENT_TOKENS = 65_536;
const MAXIMUM_QUERY_CHARACTERS = 16_384;

/**
 * A pinned tokenizer adapter. `encode` must disable automatic special tokens;
 * the model adapter remains the sole owner of BOS/EOS tensor construction.
 */
export interface AssistanceTokenizerV1 {
	encode(value: string): readonly number[];
}

export interface AssistanceTranscriptIndexChunkV1 {
	readonly schemaVersion: typeof ASSISTANCE_TRANSCRIPT_INDEX_SCHEMA_VERSION;
	readonly chunkId: string;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly segmentStartIndex: number;
	readonly segmentEndIndexExclusive: number;
	/** Nomic document prefix followed by at most the remaining 256-token budget. */
	readonly inputIds: readonly number[];
}

export interface AssistanceTranscriptIndexQueryV1 {
	readonly schemaVersion: typeof ASSISTANCE_TRANSCRIPT_INDEX_SCHEMA_VERSION;
	readonly inputIds: readonly number[];
}

interface IndexedToken {
	readonly id: number;
	readonly segmentIndex: number;
}

/**
 * Build fixed 256-token windows with an exact 32-token content overlap. Timeline
 * custody expands each window to the complete transcript segments its tokens touch.
 */
export function createAssistanceNomicDocumentChunksV1(
	transcriptValue: AssistanceTranscript,
	tokenizerValue: AssistanceTokenizerV1,
): readonly AssistanceTranscriptIndexChunkV1[] {
	const transcript = normalizeTranscript(transcriptValue);
	if (transcript.segments.length === 0) {
		throw new RangeError('Transcript indexing requires at least one segment.');
	}
	const tokenizer = normalizeTokenizer(tokenizerValue);
	const prefixIds = encodeTokenIds(tokenizer, ASSISTANCE_NOMIC_DOCUMENT_PREFIX,
		'document prefix', ASSISTANCE_TRANSCRIPT_INDEX_TOKEN_LIMIT - 1);
	const contentLimit = ASSISTANCE_TRANSCRIPT_INDEX_TOKEN_LIMIT - prefixIds.length;
	if (contentLimit <= ASSISTANCE_TRANSCRIPT_INDEX_TOKEN_OVERLAP) {
		throw new RangeError('The nomic document prefix leaves no bounded overlap window.');
	}
	const separatorIds = encodeTokenIds(tokenizer, '\n', 'segment separator',
		ASSISTANCE_TRANSCRIPT_INDEX_TOKEN_OVERLAP, true);
	const tokens: IndexedToken[] = [];
	for (const [segmentIndex, segment] of transcript.segments.entries()) {
		if (segmentIndex > 0) appendTokens(tokens, separatorIds, segmentIndex);
		const ids = encodeTokenIds(tokenizer, segment.text,
			`transcript segment ${String(segmentIndex)}`, MAXIMUM_SEGMENT_TOKENS);
		appendTokens(tokens, ids, segmentIndex);
		if (tokens.length > MAXIMUM_DOCUMENT_TOKENS) {
			throw new RangeError('The transcript index exceeds its token bound.');
		}
	}
	if (tokens.length === 0) throw new RangeError('Transcript indexing produced no content tokens.');

	const chunks: AssistanceTranscriptIndexChunkV1[] = [];
	let contentStart = 0;
	while (contentStart < tokens.length) {
		const contentEnd = Math.min(tokens.length, contentStart + contentLimit);
		const firstSegmentIndex = tokens[contentStart]!.segmentIndex;
		const lastSegmentIndex = tokens[contentEnd - 1]!.segmentIndex;
		const inputIds = Object.freeze([
			...prefixIds,
			...tokens.slice(contentStart, contentEnd).map(({ id }) => id),
		]);
		chunks.push(Object.freeze({
			schemaVersion: ASSISTANCE_TRANSCRIPT_INDEX_SCHEMA_VERSION,
			chunkId: `transcript:${String(chunks.length)}`,
			sourceStartFrame: transcript.segments[firstSegmentIndex]!.startFrame,
			sourceEndFrame: transcript.segments[lastSegmentIndex]!.endFrame,
			segmentStartIndex: firstSegmentIndex,
			segmentEndIndexExclusive: lastSegmentIndex + 1,
			inputIds,
		}));
		if (contentEnd === tokens.length) break;
		contentStart = contentEnd - ASSISTANCE_TRANSCRIPT_INDEX_TOKEN_OVERLAP;
	}
	return Object.freeze(chunks);
}

/** Prepare one explicitly authorized, short-lived query using nomic's distinct query prefix. */
export function createAssistanceNomicQueryV1(
	queryValue: string,
	tokenizerValue: AssistanceTokenizerV1,
): AssistanceTranscriptIndexQueryV1 {
	if (typeof queryValue !== 'string' || queryValue.trim() === ''
		|| queryValue.length > MAXIMUM_QUERY_CHARACTERS) {
		throw new TypeError('An assistance semantic-search query must be bounded and non-empty.');
	}
	const tokenizer = normalizeTokenizer(tokenizerValue);
	const inputIds = encodeTokenIds(tokenizer, `${ASSISTANCE_NOMIC_QUERY_PREFIX}${queryValue.trim()}`,
		'semantic-search query', ASSISTANCE_TRANSCRIPT_INDEX_TOKEN_LIMIT);
	return Object.freeze({
		schemaVersion: ASSISTANCE_TRANSCRIPT_INDEX_SCHEMA_VERSION,
		inputIds,
	});
}

function normalizeTranscript(value: AssistanceTranscript): AssistanceTranscript {
	if (!value || value.schemaVersion !== ASSISTANCE_TRANSCRIPT_SCHEMA_VERSION) {
		throw new RangeError('Transcript indexing requires a schema-v1 transcript.');
	}
	return createAssistanceTranscript({
		sourceId: value.sourceId,
		sampleRate: value.sampleRate,
		language: value.language,
		modelId: value.modelId,
		segments: value.segments,
	});
}

function normalizeTokenizer(value: AssistanceTokenizerV1): AssistanceTokenizerV1 {
	if (!value || typeof value !== 'object' || typeof value.encode !== 'function') {
		throw new TypeError('Transcript indexing requires a tokenizer adapter.');
	}
	return value;
}

function encodeTokenIds(
	tokenizer: AssistanceTokenizerV1,
	value: string,
	label: string,
	maximum: number,
	allowEmpty = false,
): readonly number[] {
	const result = tokenizer.encode(value);
	if (!Array.isArray(result) || (!allowEmpty && result.length === 0) || result.length > maximum) {
		throw new RangeError(`The assistance ${label} has an invalid token count.`);
	}
	const ids = result.map((candidate, index) => {
		if (!Number.isSafeInteger(candidate) || candidate < 0) {
			throw new RangeError(`The assistance ${label} token ${String(index)} is invalid.`);
		}
		return candidate;
	});
	return Object.freeze(ids);
}

function appendTokens(target: IndexedToken[], ids: readonly number[], segmentIndex: number): void {
	for (const id of ids) target.push(Object.freeze({ id, segmentIndex }));
}
