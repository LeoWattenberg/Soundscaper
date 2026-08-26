/* SPDX-License-Identifier: AGPL-3.0-only */

/** Derives bounded window evidence from one authenticated disposable visual index. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { createAssistanceEmbeddingMatrixV1 } from '../assistance/binary-formats-v1.ts';
import {
	ASSISTANCE_SEMANTIC_DERIVATIVE_MEDIA_TYPE,
	reviewAssistanceSemanticDerivativeBundleV1,
} from '../assistance/semantic-derivative-bundle-v1.ts';
import type { LocalAssistanceGuidedHighlightVideoSignalsV1 } from
	'./local-assistance-guided-highlight-signals.ts';
import type { LocalAssistanceGuidedPrimitiveFence } from
	'./local-assistance-guided-transcript-context.ts';

const MAXIMUM_INDEX_RECORDS = 64;
const MAXIMUM_MULTIPLY_ADDS = 10_000_000;
const SHA256 = /^[a-f\d]{64}$/u;

export interface LocalAssistanceGuidedHighlightVisualEvidenceV1 {
	readonly video: LocalAssistanceGuidedHighlightVideoSignalsV1;
	readonly embeddings: Uint8Array<ArrayBuffer>;
}

export function prepareLocalAssistanceGuidedHighlightVisualEvidenceV1(request: Readonly<{
	readonly video: LocalAssistanceGuidedHighlightVideoSignalsV1;
	readonly fence: LocalAssistanceGuidedPrimitiveFence;
	readonly records: readonly unknown[];
	readonly signal: AbortSignal;
}>): LocalAssistanceGuidedHighlightVisualEvidenceV1 | null {
	if (!(request?.signal instanceof AbortSignal)) {
		throw new TypeError('Highlight visual evidence requires one cancellation signal.');
	}
	request.signal.throwIfAborted();
	if (!Array.isArray(request.records) || request.records.length > MAXIMUM_INDEX_RECORDS) {
		throw new RangeError('Highlight visual-index custody exceeds its record bound.');
	}
	const candidates = request.records.flatMap((value) => {
		const record = dataRecord(value, 'highlight visual-index record');
		if (record.kind !== 'visual-index' || record.projectId !== request.fence.projectId) return [];
		if (record.mediaType !== ASSISTANCE_SEMANTIC_DERIVATIVE_MEDIA_TYPE
			|| !(record.bytes instanceof Uint8Array)
			|| record.payloadByteLength !== record.bytes.byteLength
			|| typeof record.payloadSha256 !== 'string' || !SHA256.test(record.payloadSha256)
			|| bytesToHex(sha256(record.bytes)) !== record.payloadSha256) {
			throw new Error('Highlight visual-index payload authentication failed.');
		}
		const bundle = reviewAssistanceSemanticDerivativeBundleV1(record.bytes);
		if (bundle.provider !== 'visual' || bundle.projectId !== request.fence.projectId
			|| bundle.projectRevision !== request.fence.revision
			|| bundle.sequenceId !== request.fence.sequenceId
			|| bundle.sourceId !== request.fence.sourceId
			|| bundle.sourceId !== request.video.sourceId) return [];
		const derived = deriveWindowEvidence(request.video, bundle, request.signal);
		return derived === null ? [] : [derived];
	});
	request.signal.throwIfAborted();
	return candidates.length === 1 ? candidates[0]! : null;
}

function deriveWindowEvidence(
	video: LocalAssistanceGuidedHighlightVideoSignalsV1,
	bundle: ReturnType<typeof reviewAssistanceSemanticDerivativeBundleV1>,
	signal: AbortSignal,
): LocalAssistanceGuidedHighlightVisualEvidenceV1 | null {
	if (video.windows.length < 1) return null;
	const work = bundle.matrix.rowCount * bundle.matrix.dimensions
		+ video.windows.length * video.windows.length * bundle.matrix.dimensions;
	if (!Number.isSafeInteger(work) || work > MAXIMUM_MULTIPLY_ADDS) {
		throw new RangeError('Highlight visual evidence exceeds its deterministic work bound.');
	}
	const vectors = video.windows.map((window) => {
		const ordinals: number[] = [];
		for (const [ordinal, row] of bundle.rows.entries()) {
			if (row.timelineFrame >= window.startFrame && row.timelineFrame < window.endFrame) {
				ordinals.push(ordinal);
			}
		}
		if (ordinals.length === 0) return null;
		return centroid(ordinals.map((ordinal) => bundle.matrix.vector(ordinal)));
	});
	if (vectors.some((vector) => vector === null)) return null;
	const admitted = vectors as readonly Float32Array[];
	const visualInterest = admitted.map((vector, index) => {
		let maximumSimilarity = 0;
		for (const [otherIndex, other] of admitted.entries()) {
			if (otherIndex === index) continue;
			maximumSimilarity = Math.max(maximumSimilarity, unitDot(vector, other));
		}
		return admitted.length === 1 ? 0 : quantize(1 - maximumSimilarity);
	});
	signal.throwIfAborted();
	const windows = video.windows.map((window, index) => Object.freeze({
		...window, visualInterest: visualInterest[index]!,
	}));
	return Object.freeze({
		video: Object.freeze({ ...video, windows: Object.freeze(windows) }),
		embeddings: createAssistanceEmbeddingMatrixV1({
			dimensions: bundle.matrix.dimensions, vectors: admitted,
		}),
	});
}

function centroid(vectors: readonly Float32Array[]): Float32Array | null {
	const result = new Float32Array(vectors[0]!.length);
	for (const vector of vectors) {
		for (let index = 0; index < result.length; index += 1) {
			result[index] = Math.fround(result[index]! + vector[index]!);
		}
	}
	let normSquared = 0;
	for (const value of result) normSquared += value * value;
	if (!Number.isFinite(normSquared) || normSquared <= Number.EPSILON) return null;
	const norm = Math.sqrt(normSquared);
	for (let index = 0; index < result.length; index += 1) {
		result[index] = Math.fround(result[index]! / norm);
	}
	return result;
}

function unitDot(left: Float32Array, right: Float32Array): number {
	let result = 0;
	for (let index = 0; index < left.length; index += 1) result += left[index]! * right[index]!;
	return Math.min(1, Math.max(0, result));
}

function quantize(value: number): number {
	return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}

function dataRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError(`The ${label} must be a record.`);
	}
	return value as Record<string, unknown>;
}
