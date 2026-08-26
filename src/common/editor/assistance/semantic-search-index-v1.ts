/* SPDX-License-Identifier: AGPL-3.0-only */

/** Project-bound transcript/visual/OCR retrieval over disposable reviewed indexes. */

import {
	ASSISTANCE_ASYNC_SEARCH_RESULT_LIMIT,
	validateAssistanceSemanticSearchSession,
	type AssistanceAsyncSearchProvider,
	type AssistanceAsyncSearchRequest,
} from './async-search-provider.ts';
import {
	reviewAssistanceEmbeddingMatrixV1,
	type ReviewedAssistanceEmbeddingMatrixV1,
} from './binary-formats-v1.ts';
import {
	fuseAssistanceSearchRanksV1,
	type AssistanceProviderSearchHitV1,
	type AssistanceSearchProviderV1,
} from './visual-indexing-v1.ts';

export const ASSISTANCE_SEMANTIC_INDEX_VERSION = 1 as const;

const INDEX_FIELDS = Object.freeze([
	'indexVersion', 'projectId', 'projectRevision', 'transcript', 'visual', 'ocr',
]);
const EMBEDDED_INDEX_FIELDS = Object.freeze(['matrix', 'rows']);
const ROW_FIELDS = Object.freeze(['resultId', 'timelineFrame', 'label']);
const ID = /^[A-Za-z\d][A-Za-z\d._:-]{0,255}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const WORD = /[\p{L}\p{N}]+/gu;
const MAXIMUM_INDEX_ROWS = 100_000;
const MAXIMUM_PROVIDER_RANKS = 10_000;
const UNIT_NORM_TOLERANCE = 1e-4;

export interface AssistanceSemanticIndexRowV1 {
	readonly resultId: string;
	readonly timelineFrame: number;
	readonly label: string;
}

export interface AssistanceEmbeddedSemanticIndexV1 {
	readonly matrix: ArrayBuffer | ArrayBufferView;
	readonly rows: readonly AssistanceSemanticIndexRowV1[];
}

export interface AssistanceSemanticIndexV1 {
	readonly indexVersion: typeof ASSISTANCE_SEMANTIC_INDEX_VERSION;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly transcript: AssistanceEmbeddedSemanticIndexV1;
	readonly visual: AssistanceEmbeddedSemanticIndexV1;
	readonly ocr: readonly AssistanceSemanticIndexRowV1[];
}

export interface AssistanceSemanticQueryEmbeddingRequestV1 {
	readonly provider: 'transcript' | 'visual';
	readonly query: string;
	readonly signal: AbortSignal;
}

export interface AssistanceSemanticIndexResultV1 {
	readonly resultId: string;
	readonly timelineFrame: number;
	readonly label: string;
	readonly detail: string | null;
	readonly providers: readonly AssistanceSearchProviderV1[];
}

export interface AssistanceSemanticIndexSearchProviderV1 extends AssistanceAsyncSearchProvider {
	search(
		request: AssistanceAsyncSearchRequest,
	): Promise<readonly AssistanceSemanticIndexResultV1[]>;
}

export interface AssistanceSemanticIndexSearchProviderOptionsV1 {
	readonly index: AssistanceSemanticIndexV1;
	readonly embedQuery: (
		request: AssistanceSemanticQueryEmbeddingRequestV1,
	) => Promise<ArrayLike<number>>;
	readonly now?: () => number;
}

interface ReviewedEmbeddedIndex {
	readonly matrix: ReviewedAssistanceEmbeddingMatrixV1;
	readonly rows: readonly AssistanceSemanticIndexRowV1[];
}

interface ReviewedIndex {
	readonly projectId: string;
	readonly projectRevision: number;
	readonly transcript: ReviewedEmbeddedIndex;
	readonly visual: ReviewedEmbeddedIndex;
	readonly ocr: readonly AssistanceSemanticIndexRowV1[];
}

/**
 * Construct the provider only after opening the menu-owned search surface. The
 * caller supplies model-specific query embedding (nomic or SigLIP text tower),
 * so no download, prompt, or model execution is implicit here.
 */
export function createAssistanceSemanticIndexSearchProviderV1(
	options: AssistanceSemanticIndexSearchProviderOptionsV1,
): AssistanceSemanticIndexSearchProviderV1 {
	if (!options || typeof options !== 'object' || typeof options.embedQuery !== 'function'
		|| (options.now !== undefined && typeof options.now !== 'function')) {
		throw new TypeError('Semantic index search requires exact index and embedding ports.');
	}
	const index = reviewIndex(options.index);
	const now = options.now ?? Date.now;
	return Object.freeze({
		async search(request: AssistanceAsyncSearchRequest): Promise<readonly AssistanceSemanticIndexResultV1[]> {
			const session = validateAssistanceSemanticSearchSession(request?.session, now());
			if (session.projectId !== index.projectId || session.projectRevision !== index.projectRevision) {
				throw new Error('The semantic-search session disagrees with the index project authority or revision.');
			}
			if (request.maximumResults !== ASSISTANCE_ASYNC_SEARCH_RESULT_LIMIT
				|| !request.signal || typeof request.signal.throwIfAborted !== 'function') {
				throw new TypeError('The semantic-search request carries invalid bounds or cancellation authority.');
			}
			request.signal.throwIfAborted();
			const query = queryText(request.query);
			const [transcriptQuery, visualQuery] = await Promise.all([
				embed(index.transcript, 'transcript', query, request.signal, options.embedQuery),
				embed(index.visual, 'visual', query, request.signal, options.embedQuery),
			]);
			request.signal.throwIfAborted();
			const transcript = transcriptQuery === null ? [] : rankEmbedded(
				index.transcript, transcriptQuery, request.signal,
			);
			const visual = visualQuery === null ? [] : rankEmbedded(
				index.visual, visualQuery, request.signal,
			);
			const ocr = rankOcr(index.ocr, query, request.signal);
			const fused = fuseAssistanceSearchRanksV1({ transcript, visual, ocr });
			return Object.freeze(fused.slice(0, request.maximumResults).map((hit) => {
				const primary = hit.providers[0]!;
				const label = hit.labels[primary]!;
				const details = hit.providers.slice(1).map((provider) =>
					`${providerLabel(provider)}: ${hit.labels[provider]!}`);
				return Object.freeze({
					resultId: hit.resultId,
					timelineFrame: hit.timelineFrame,
					label,
					detail: details.length === 0 ? null : details.join(' · '),
					providers: hit.providers,
				});
			}));
		},
	});
}

function reviewIndex(value: unknown): ReviewedIndex {
	const row = exactRecord(value, INDEX_FIELDS, 'semantic index');
	if (row.indexVersion !== ASSISTANCE_SEMANTIC_INDEX_VERSION) {
		throw new TypeError('The semantic index version is unsupported.');
	}
	return Object.freeze({
		projectId: stableId(row.projectId, 'semantic index project ID'),
		projectRevision: integer(row.projectRevision, 0, Number.MAX_SAFE_INTEGER,
			'semantic index project revision'),
		transcript: reviewEmbedded(row.transcript, 'transcript'),
		visual: reviewEmbedded(row.visual, 'visual'),
		ocr: reviewRows(row.ocr, 'OCR'),
	});
}

function reviewEmbedded(value: unknown, label: string): ReviewedEmbeddedIndex {
	const row = exactRecord(value, EMBEDDED_INDEX_FIELDS, `${label} semantic index`);
	const matrix = reviewAssistanceEmbeddingMatrixV1(row.matrix as ArrayBuffer | ArrayBufferView);
	const rows = reviewRows(row.rows, label);
	if (matrix.rowCount !== rows.length) {
		throw new RangeError(`The ${label} semantic index row inventory disagrees with its matrix.`);
	}
	return Object.freeze({ matrix, rows });
}

function reviewRows(value: unknown, label: string): readonly AssistanceSemanticIndexRowV1[] {
	if (!Array.isArray(value) || value.length > MAXIMUM_INDEX_ROWS) {
		throw new RangeError(`The ${label} semantic index row inventory exceeds its bound.`);
	}
	const seen = new Set<string>();
	return Object.freeze(value.map((candidate, index) => {
		const row = exactRecord(candidate, ROW_FIELDS, `${label} semantic row ${String(index)}`);
		const resultId = stableId(row.resultId, `${label} result ID`);
		if (seen.has(resultId)) throw new TypeError(`The ${label} semantic index repeats a result ID.`);
		seen.add(resultId);
		return Object.freeze({
			resultId,
			timelineFrame: integer(row.timelineFrame, 0, Number.MAX_SAFE_INTEGER,
				`${label} result timeline frame`),
			label: boundedText(row.label, 1_024, `${label} result label`),
		});
	}));
}

async function embed(
	index: ReviewedEmbeddedIndex,
	provider: 'transcript' | 'visual',
	query: string,
	signal: AbortSignal,
	embedQuery: AssistanceSemanticIndexSearchProviderOptionsV1['embedQuery'],
): Promise<Float32Array | null> {
	if (index.rows.length === 0) return null;
	const value = await embedQuery(Object.freeze({ provider, query, signal }));
	signal.throwIfAborted();
	return normalizedVector(value, index.matrix.dimensions, `${provider} query embedding`);
}

function rankEmbedded(
	index: ReviewedEmbeddedIndex,
	query: Float32Array,
	signal: AbortSignal,
): readonly AssistanceProviderSearchHitV1[] {
	const values = index.rows.map((row, indexValue) => {
		if ((indexValue & 127) === 0) signal.throwIfAborted();
		const vector = index.matrix.vector(indexValue);
		let score = 0;
		for (let column = 0; column < query.length; column += 1) {
			score += query[column]! * vector[column]!;
		}
		if (!Number.isFinite(score)) throw new RangeError('Semantic-search similarity is non-finite.');
		return { ...row, score };
	});
	values.sort((left, right) => right.score - left.score
		|| left.timelineFrame - right.timelineFrame || left.resultId.localeCompare(right.resultId));
	return Object.freeze(values.slice(0, MAXIMUM_PROVIDER_RANKS).map(providerHit));
}

function rankOcr(
	rows: readonly AssistanceSemanticIndexRowV1[],
	query: string,
	signal: AbortSignal,
): readonly AssistanceProviderSearchHitV1[] {
	const normalizedQuery = query.normalize('NFKC').toLowerCase();
	const tokens = new Set(normalizedQuery.match(WORD) ?? []);
	const values = rows.flatMap((row, index) => {
		if ((index & 127) === 0) signal.throwIfAborted();
		const text = row.label.normalize('NFKC').toLowerCase();
		const words = new Set(text.match(WORD) ?? []);
		let matches = 0;
		for (const token of tokens) if (words.has(token)) matches += 1;
		if (matches === 0) return [];
		const phrase = text.includes(normalizedQuery) ? 1 : 0;
		return [{ ...row, score: phrase + matches / tokens.size }];
	});
	values.sort((left, right) => right.score - left.score
		|| left.timelineFrame - right.timelineFrame || left.resultId.localeCompare(right.resultId));
	return Object.freeze(values.slice(0, MAXIMUM_PROVIDER_RANKS).map(providerHit));
}

function providerHit(value: AssistanceSemanticIndexRowV1): AssistanceProviderSearchHitV1 {
	return Object.freeze({
		resultId: value.resultId, timelineFrame: value.timelineFrame, label: value.label,
	});
}

function normalizedVector(value: ArrayLike<number>, dimensions: number, label: string): Float32Array {
	if (!value || !Number.isSafeInteger(value.length) || value.length !== dimensions) {
		throw new RangeError(`The ${label} has invalid dimensions.`);
	}
	const result = new Float32Array(dimensions);
	let squaredNorm = 0;
	for (let index = 0; index < dimensions; index += 1) {
		const candidate = value[index];
		if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
			throw new RangeError(`The ${label} contains a non-finite value.`);
		}
		result[index] = candidate === 0 ? 0 : Math.fround(candidate);
		squaredNorm += result[index]! * result[index]!;
	}
	if (!Number.isFinite(squaredNorm)
		|| Math.abs(Math.sqrt(squaredNorm) - 1) > UNIT_NORM_TOLERANCE) {
		throw new RangeError(`The ${label} must be normalized.`);
	}
	return result;
}

function exactRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const row = value as Record<string, unknown>;
	const keys = Reflect.ownKeys(row);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`The ${label} fields are invalid.`);
	}
	return row;
}

function stableId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`The ${label} is invalid.`);
	return value;
}

function boundedText(value: unknown, maximum: number, label: string): string {
	if (typeof value !== 'string' || value.trim() === '' || value.length > maximum
		|| CONTROL.test(value)) throw new TypeError(`The ${label} is invalid.`);
	return value;
}

function queryText(value: unknown): string {
	return boundedText(value, 512, 'semantic-search query').trim();
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}

function providerLabel(value: AssistanceSearchProviderV1): string {
	return value === 'ocr' ? 'OCR' : value[0]!.toUpperCase() + value.slice(1);
}
