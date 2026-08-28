/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded, deterministic CTC forced alignment for the pinned wav2vec2 adapter. */

import {
	ASSISTANCE_ALIGNMENT_SAMPLE_RATE,
	ASSISTANCE_WORD_ALIGNMENT_SCHEMA_VERSION,
	reviewAssistanceWordAlignmentV1,
	type AssistanceWordAlignmentV1,
} from './m7-semantic-results.ts';

export const ASSISTANCE_CTC_ALIGNMENT_SCHEMA_VERSION = 1 as const;

const REQUEST_FIELDS = Object.freeze([
	'schemaVersion', 'sampleRate', 'frameStrideSamples', 'blankTokenId', 'vocabularySize',
	'frameCount', 'emissionLogProbabilities', 'words',
] as const);
const WORD_FIELDS = Object.freeze([
	'segmentIndex', 'wordIndex', 'text', 'tokenIds',
] as const);
const MAXIMUM_FRAMES = 100_000;
const MAXIMUM_VOCABULARY = 65_536;
const MAXIMUM_EMISSION_VALUES = 20_000_000;
const MAXIMUM_TRELLIS_CELLS = 20_000_000;
const MAXIMUM_WORDS = 100_000;
const MAXIMUM_TOKENS = 250_000;
const UNREACHABLE = Number.NEGATIVE_INFINITY;
const NO_BACKPOINTER = 255;
const CONTROL = /[\u0000-\u001f\u007f]/u;

export interface AssistanceCtcWordV1 {
	readonly segmentIndex: number;
	readonly wordIndex: number;
	readonly text: string;
	readonly tokenIds: readonly number[];
}

export interface AssistanceCtcAlignmentRequestV1 {
	readonly schemaVersion: typeof ASSISTANCE_CTC_ALIGNMENT_SCHEMA_VERSION;
	readonly sampleRate: typeof ASSISTANCE_ALIGNMENT_SAMPLE_RATE;
	readonly frameStrideSamples: number;
	readonly blankTokenId: number;
	readonly vocabularySize: number;
	readonly frameCount: number;
	/** Row-major, normalized log probabilities. Negative infinity marks an impossible emission. */
	readonly emissionLogProbabilities: Float32Array;
	readonly words: readonly AssistanceCtcWordV1[];
}

interface NormalizedCtcRequest extends AssistanceCtcAlignmentRequestV1 {
	readonly tokenIds: readonly number[];
	readonly tokenWords: readonly number[];
}

/**
 * Align an already-tokenized transcript to normalized CTC emissions. Tokenizer
 * execution stays adapter-owned; this function owns the reproducible trellis,
 * repeated-token blank rule, tie breaking, and sample geometry.
 */
export function alignAssistanceCtcWordsV1(value: unknown): AssistanceWordAlignmentV1 {
	const request = normalizeRequest(value);
	const stateCount = request.tokenIds.length * 2 + 1;
	const trellisCells = safeProduct(request.frameCount, stateCount, 'CTC trellis work');
	if (trellisCells > MAXIMUM_TRELLIS_CELLS) {
		throw new RangeError('The CTC alignment work exceeds its bounded trellis.');
	}
	const backpointers = new Uint8Array(trellisCells);
	backpointers.fill(NO_BACKPOINTER);
	let prior = new Float64Array(stateCount);
	prior.fill(UNREACHABLE);
	prior[0] = emission(request, 0, request.blankTokenId);
	backpointers[0] = 0;
	if (stateCount > 1) {
		prior[1] = emission(request, 0, request.tokenIds[0]!);
		backpointers[1] = 0;
	}
	for (let frame = 1; frame < request.frameCount; frame += 1) {
		const current = new Float64Array(stateCount);
		current.fill(UNREACHABLE);
		for (let state = 0; state < stateCount; state += 1) {
			let best = prior[state]!;
			let step = 0;
			if (state > 0 && prior[state - 1]! > best) {
				best = prior[state - 1]!;
				step = 1;
			}
			if (maySkipBlank(request.tokenIds, state) && prior[state - 2]! > best) {
				best = prior[state - 2]!;
				step = 2;
			}
			if (best === UNREACHABLE) continue;
			const tokenId = stateToken(request, state);
			current[state] = best + emission(request, frame, tokenId);
			backpointers[frame * stateCount + state] = step;
		}
		prior = current;
	}
	const finalTokenState = stateCount - 2;
	const finalBlankState = stateCount - 1;
	let state = prior[finalBlankState]! >= prior[finalTokenState]!
		? finalBlankState
		: finalTokenState;
	if (prior[state] === UNREACHABLE) {
		throw new RangeError('The CTC transcript has no reachable path through the available frames.');
	}
	const path = new Uint32Array(request.frameCount);
	for (let frame = request.frameCount - 1; frame >= 0; frame -= 1) {
		path[frame] = state;
		if (frame === 0) break;
		const step = backpointers[frame * stateCount + state]!;
		if (step === NO_BACKPOINTER || step > state) {
			throw new Error('The CTC trellis produced an invalid backpointer.');
		}
		state -= step;
	}
	return alignedWords(request, path);
}

function normalizeRequest(value: unknown): NormalizedCtcRequest {
	const row = exactRecord(value, REQUEST_FIELDS, 'CTC alignment request');
	if (row.schemaVersion !== ASSISTANCE_CTC_ALIGNMENT_SCHEMA_VERSION) {
		throw new TypeError('The CTC alignment schema version is unsupported.');
	}
	if (row.sampleRate !== ASSISTANCE_ALIGNMENT_SAMPLE_RATE) {
		throw new RangeError('CTC alignment requires exact 16 kHz audio authority.');
	}
	const frameStrideSamples = integer(row.frameStrideSamples, 1,
		ASSISTANCE_ALIGNMENT_SAMPLE_RATE, 'CTC frame stride');
	const vocabularySize = integer(row.vocabularySize, 2, MAXIMUM_VOCABULARY,
		'CTC vocabulary size');
	const blankTokenId = integer(row.blankTokenId, 0, vocabularySize - 1,
		'CTC blank token ID');
	const frameCount = integer(row.frameCount, 1, MAXIMUM_FRAMES, 'CTC frame count');
	if (!(row.emissionLogProbabilities instanceof Float32Array)) {
		throw new TypeError('CTC emissions must use one Float32Array matrix.');
	}
	const emissionCount = safeProduct(frameCount, vocabularySize, 'CTC emission matrix');
	if (emissionCount > MAXIMUM_EMISSION_VALUES
		|| row.emissionLogProbabilities.length !== emissionCount) {
		throw new RangeError('The CTC emission matrix exceeds its exact bound or geometry.');
	}
	for (const candidate of row.emissionLogProbabilities) {
		if (Number.isNaN(candidate) || candidate === Number.POSITIVE_INFINITY || candidate > 0) {
			throw new RangeError('Every CTC emission must be a finite non-positive log probability.');
		}
	}
	const normalized = normalizeWords(row.words, vocabularySize, blankTokenId);
	const repeated = normalized.tokenIds.reduce((count, tokenId, index, tokens) =>
		count + (index > 0 && tokenId === tokens[index - 1] ? 1 : 0), 0);
	if (normalized.tokenIds.length + repeated > frameCount) {
		throw new RangeError('The CTC transcript is not reachable in the available frames.');
	}
	return Object.freeze({
		schemaVersion: ASSISTANCE_CTC_ALIGNMENT_SCHEMA_VERSION,
		sampleRate: ASSISTANCE_ALIGNMENT_SAMPLE_RATE,
		frameStrideSamples,
		blankTokenId,
		vocabularySize,
		frameCount,
		emissionLogProbabilities: row.emissionLogProbabilities,
		words: normalized.words,
		tokenIds: normalized.tokenIds,
		tokenWords: normalized.tokenWords,
	});
}

function normalizeWords(
	value: unknown,
	vocabularySize: number,
	blankTokenId: number,
): Readonly<{
	words: readonly AssistanceCtcWordV1[];
	tokenIds: readonly number[];
	tokenWords: readonly number[];
}> {
	if (!Array.isArray(value) || value.length < 1 || value.length > MAXIMUM_WORDS) {
		throw new RangeError('The CTC transcript word inventory exceeds its bound.');
	}
	let priorSegment = -1;
	let priorWord = -1;
	const tokenIds: number[] = [];
	const tokenWords: number[] = [];
	const words = value.map((candidate, wordOffset): AssistanceCtcWordV1 => {
		const row = exactRecord(candidate, WORD_FIELDS, `CTC word ${String(wordOffset)}`);
		const segmentIndex = integer(row.segmentIndex, 0, Number.MAX_SAFE_INTEGER,
			'CTC segment index');
		const wordIndex = integer(row.wordIndex, 0, Number.MAX_SAFE_INTEGER, 'CTC word index');
		if (segmentIndex < priorSegment || (segmentIndex === priorSegment && wordIndex <= priorWord)) {
			throw new RangeError('CTC words must preserve strict transcript order.');
		}
		const text = boundedText(row.text, 512, 'CTC word text');
		if (!Array.isArray(row.tokenIds) || row.tokenIds.length < 1
			|| tokenIds.length + row.tokenIds.length > MAXIMUM_TOKENS) {
			throw new RangeError('The CTC token inventory exceeds its bound.');
		}
		const wordTokens = row.tokenIds.map((tokenId) => {
			const normalized = integer(tokenId, 0, vocabularySize - 1, 'CTC token ID');
			if (normalized === blankTokenId) {
				throw new TypeError('CTC transcript tokens cannot contain the blank token.');
			}
			tokenIds.push(normalized);
			tokenWords.push(wordOffset);
			return normalized;
		});
		priorSegment = segmentIndex;
		priorWord = wordIndex;
		return Object.freeze({ segmentIndex, wordIndex, text, tokenIds: Object.freeze(wordTokens) });
	});
	return Object.freeze({ words: Object.freeze(words), tokenIds: Object.freeze(tokenIds),
		tokenWords: Object.freeze(tokenWords) });
}

function alignedWords(request: NormalizedCtcRequest, path: Uint32Array): AssistanceWordAlignmentV1 {
	const firstFrames = new Int32Array(request.tokenIds.length);
	firstFrames.fill(-1);
	const lastFrames = new Int32Array(request.tokenIds.length);
	lastFrames.fill(-1);
	const confidenceSums = new Float64Array(request.tokenIds.length);
	const confidenceCounts = new Uint32Array(request.tokenIds.length);
	for (let frame = 0; frame < path.length; frame += 1) {
		const state = path[frame]!;
		if ((state & 1) === 0) continue;
		const tokenIndex = (state - 1) / 2;
		const tokenId = request.tokenIds[tokenIndex];
		if (tokenId === undefined || firstFrames[tokenIndex] === undefined
			|| lastFrames[tokenIndex] === undefined || confidenceSums[tokenIndex] === undefined
			|| confidenceCounts[tokenIndex] === undefined) {
			throw new RangeError('The CTC alignment path contains an invalid token state.');
		}
		if (firstFrames[tokenIndex] === -1) firstFrames[tokenIndex] = frame;
		lastFrames[tokenIndex] = frame;
		confidenceSums[tokenIndex] = confidenceSums[tokenIndex] + Math.exp(emission(request, frame, tokenId));
		confidenceCounts[tokenIndex] = confidenceCounts[tokenIndex] + 1;
	}
	const words = request.words.map((word, wordOffset) => {
		const ownedTokens: number[] = [];
		for (let index = 0; index < request.tokenWords.length; index += 1) {
			if (request.tokenWords[index] === wordOffset) ownedTokens.push(index);
		}
		const firstToken = ownedTokens[0];
		const lastToken = ownedTokens.at(-1);
		const firstFrame = firstToken === undefined ? undefined : firstFrames[firstToken];
		const lastFrame = lastToken === undefined ? undefined : lastFrames[lastToken];
		if (firstToken === undefined || lastToken === undefined
			|| firstFrame === undefined || lastFrame === undefined || firstFrame < 0 || lastFrame < 0) {
			throw new RangeError('The CTC transcript has an unaligned token.');
		}
		let confidence = 0;
		for (const tokenIndex of ownedTokens) {
			if (confidenceCounts[tokenIndex] === 0) {
				throw new RangeError('The CTC transcript has an unaligned token.');
			}
			confidence += confidenceSums[tokenIndex]! / confidenceCounts[tokenIndex]!;
		}
		return Object.freeze({
			segmentIndex: word.segmentIndex,
			wordIndex: word.wordIndex,
			text: word.text,
		startSample: safeProduct(firstFrame, request.frameStrideSamples,
				'CTC word start sample'),
			endSample: safeProduct(lastFrame + 1, request.frameStrideSamples,
				'CTC word end sample'),
			confidence: quantize(confidence / ownedTokens.length),
		});
	});
	return reviewAssistanceWordAlignmentV1(Object.freeze({
		schemaVersion: ASSISTANCE_WORD_ALIGNMENT_SCHEMA_VERSION,
		sampleRate: ASSISTANCE_ALIGNMENT_SAMPLE_RATE,
		words: Object.freeze(words),
	}));
}

function maySkipBlank(tokens: readonly number[], state: number): boolean {
	if (state < 3 || (state & 1) === 0) return false;
	const tokenIndex = (state - 1) / 2;
	return tokens[tokenIndex] !== tokens[tokenIndex - 1];
}

function stateToken(request: NormalizedCtcRequest, state: number): number {
	return (state & 1) === 0 ? request.blankTokenId : request.tokenIds[(state - 1) / 2]!;
}

function emission(request: NormalizedCtcRequest, frame: number, tokenId: number): number {
	return request.emissionLogProbabilities[frame * request.vocabularySize + tokenId]!;
}

function exactRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Record<Field, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const row = value as Record<string, unknown>;
	const keys = Object.keys(row);
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(key as Field))) {
		throw new TypeError(`The ${label} fields are invalid.`);
	}
	return row as Record<Field, unknown>;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}

function boundedText(value: unknown, maximum: number, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > maximum || CONTROL.test(value)) {
		throw new TypeError(`The ${label} is invalid.`);
	}
	return value;
}

function safeProduct(left: number, right: number, label: string): number {
	const result = left * right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`The ${label} overflowed.`);
	return result;
}

function quantize(value: number): number {
	return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}
