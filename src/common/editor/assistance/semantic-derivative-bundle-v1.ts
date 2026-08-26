/* SPDX-License-Identifier: AGPL-3.0-only */

/** Atomic disposable custody for one revision-bound semantic index provider. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	reviewAssistanceEmbeddingMatrixV1,
	type ReviewedAssistanceEmbeddingMatrixV1,
} from './binary-formats-v1.ts';

export const ASSISTANCE_SEMANTIC_DERIVATIVE_BUNDLE_VERSION = 1 as const;
export const ASSISTANCE_SEMANTIC_DERIVATIVE_MEDIA_TYPE =
	'application/vnd.soundscaper.semantic-index-bundle-v1' as const;

const MAGIC = Uint8Array.of(0x53, 0x43, 0x41, 0x50, 0x45, 0x49, 0x44, 0x58);
const PREFIX_BYTES = 16;
const MAXIMUM_HEADER_BYTES = 16 * 1024 * 1024;
const MAXIMUM_MATRIX_BYTES = 512 * 1024 * 1024;
const MAXIMUM_ROWS = 100_000;
const HEADER_FIELDS = Object.freeze([
	'bundleVersion', 'provider', 'projectId', 'projectRevision', 'sequenceId', 'sourceId',
	'matrixByteLength', 'matrixSha256', 'rows', 'ocr',
]);
const ROW_FIELDS = Object.freeze(['resultId', 'timelineFrame', 'label']);
const ID = /^[A-Za-z\d][A-Za-z\d._:-]{0,255}$/u;
const SHA256 = /^[a-f\d]{64}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const UTF8 = new TextEncoder();

export interface AssistanceSemanticDerivativeRowV1 {
	readonly resultId: string;
	readonly timelineFrame: number;
	readonly label: string;
}

export interface AssistanceSemanticDerivativeBundleDraftV1 {
	readonly provider: 'transcript' | 'visual';
	readonly projectId: string;
	readonly projectRevision: number;
	readonly sequenceId: string;
	readonly sourceId: string;
	readonly matrix: ArrayBuffer | ArrayBufferView;
	readonly rows: readonly AssistanceSemanticDerivativeRowV1[];
	readonly ocr: readonly AssistanceSemanticDerivativeRowV1[];
}

export interface ReviewedAssistanceSemanticDerivativeBundleV1 {
	readonly bundleVersion: typeof ASSISTANCE_SEMANTIC_DERIVATIVE_BUNDLE_VERSION;
	readonly provider: AssistanceSemanticDerivativeBundleDraftV1['provider'];
	readonly projectId: string;
	readonly projectRevision: number;
	readonly sequenceId: string;
	readonly sourceId: string;
	readonly matrixBytes: Uint8Array;
	readonly matrixSha256: string;
	readonly matrix: ReviewedAssistanceEmbeddingMatrixV1;
	readonly rows: readonly AssistanceSemanticDerivativeRowV1[];
	readonly ocr: readonly AssistanceSemanticDerivativeRowV1[];
}

export function createAssistanceSemanticDerivativeBundleV1(
	draft: AssistanceSemanticDerivativeBundleDraftV1,
): Uint8Array {
	const matrixBytes = binaryBytes(draft?.matrix);
	const reviewed = reviewParts({ ...draft, matrixBytes,
		matrixSha256: digest(matrixBytes), matrix: reviewAssistanceEmbeddingMatrixV1(matrixBytes) });
	const header = headerOf(reviewed);
	const headerBytes = UTF8.encode(JSON.stringify(header));
	if (headerBytes.byteLength > MAXIMUM_HEADER_BYTES) {
		throw new RangeError('The semantic derivative header exceeds its byte bound.');
	}
	const result = new Uint8Array(PREFIX_BYTES + headerBytes.byteLength + matrixBytes.byteLength);
	result.set(MAGIC, 0);
	const view = new DataView(result.buffer);
	view.setUint16(8, ASSISTANCE_SEMANTIC_DERIVATIVE_BUNDLE_VERSION, true);
	view.setUint16(10, 0, true);
	view.setUint32(12, headerBytes.byteLength, true);
	result.set(headerBytes, PREFIX_BYTES);
	result.set(matrixBytes, PREFIX_BYTES + headerBytes.byteLength);
	return result;
}

export function reviewAssistanceSemanticDerivativeBundleV1(
	value: ArrayBuffer | ArrayBufferView,
): ReviewedAssistanceSemanticDerivativeBundleV1 {
	const bytes = binaryBytes(value);
	if (bytes.byteLength < PREFIX_BYTES || !MAGIC.every((item, index) => bytes[index] === item)) {
		throw new TypeError('The semantic derivative magic or format is unsupported.');
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint16(8, true) !== ASSISTANCE_SEMANTIC_DERIVATIVE_BUNDLE_VERSION
		|| view.getUint16(10, true) !== 0) {
		throw new TypeError('The semantic derivative version or flags are unsupported.');
	}
	const headerLength = view.getUint32(12, true);
	if (headerLength < 2 || headerLength > MAXIMUM_HEADER_BYTES
		|| PREFIX_BYTES + headerLength >= bytes.byteLength) {
		throw new RangeError('The semantic derivative header or matrix length is truncated.');
	}
	const headerBytes = bytes.subarray(PREFIX_BYTES, PREFIX_BYTES + headerLength);
	let headerValue: unknown;
	try {
		headerValue = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(headerBytes));
	} catch {
		throw new TypeError('The semantic derivative header is not valid UTF-8 JSON.');
	}
	const matrixBytes = Uint8Array.from(bytes.subarray(PREFIX_BYTES + headerLength));
	const header = exactRecord(headerValue, HEADER_FIELDS, 'semantic derivative header');
	const reviewed = reviewParts({
		provider: header.provider,
		projectId: header.projectId,
		projectRevision: header.projectRevision,
		sequenceId: header.sequenceId,
		sourceId: header.sourceId,
		matrixBytes,
		matrixSha256: header.matrixSha256,
		matrix: reviewAssistanceEmbeddingMatrixV1(matrixBytes),
		rows: header.rows,
		ocr: header.ocr,
	});
	if (header.bundleVersion !== ASSISTANCE_SEMANTIC_DERIVATIVE_BUNDLE_VERSION
		|| header.matrixByteLength !== matrixBytes.byteLength
		|| JSON.stringify(header) !== JSON.stringify(headerOf(reviewed))) {
		throw new TypeError('The semantic derivative header is noncanonical or disagrees with its matrix.');
	}
	return reviewed;
}

function reviewParts(value: Readonly<Record<string, unknown>> & Readonly<{
	readonly matrixBytes: Uint8Array;
	readonly matrix: ReviewedAssistanceEmbeddingMatrixV1;
}>): ReviewedAssistanceSemanticDerivativeBundleV1 {
	if (value.matrixBytes.byteLength > MAXIMUM_MATRIX_BYTES) {
		throw new RangeError('The semantic derivative embedding matrix exceeds its byte bound.');
	}
	const provider = enumValue(value.provider, ['transcript', 'visual'] as const,
		'semantic derivative provider');
	const rows = reviewRows(value.rows, `${provider} semantic`);
	const ocr = reviewRows(value.ocr, 'OCR');
	if (value.matrix.rowCount !== rows.length) {
		throw new RangeError('The semantic derivative row inventory disagrees with its matrix.');
	}
	if (provider === 'transcript' && ocr.length !== 0) {
		throw new TypeError('A transcript semantic derivative cannot carry OCR rows.');
	}
	const matrixSha256 = stringValue(value.matrixSha256, SHA256,
		'semantic derivative matrix SHA-256');
	if (matrixSha256 !== digest(value.matrixBytes)) {
		throw new Error('The semantic derivative matrix digest disagrees with its bytes.');
	}
	return Object.freeze({
		bundleVersion: ASSISTANCE_SEMANTIC_DERIVATIVE_BUNDLE_VERSION,
		provider,
		projectId: id(value.projectId, 'semantic derivative project ID'),
		projectRevision: integer(value.projectRevision, 'semantic derivative project revision'),
		sequenceId: id(value.sequenceId, 'semantic derivative sequence ID'),
		sourceId: id(value.sourceId, 'semantic derivative source ID'),
		matrixBytes: Uint8Array.from(value.matrixBytes), matrixSha256, matrix: value.matrix, rows, ocr,
	});
}

function headerOf(value: ReviewedAssistanceSemanticDerivativeBundleV1): unknown {
	return {
		bundleVersion: value.bundleVersion, provider: value.provider, projectId: value.projectId,
		projectRevision: value.projectRevision, sequenceId: value.sequenceId, sourceId: value.sourceId,
		matrixByteLength: value.matrixBytes.byteLength, matrixSha256: value.matrixSha256,
		rows: value.rows, ocr: value.ocr,
	};
}

function reviewRows(value: unknown, label: string): readonly AssistanceSemanticDerivativeRowV1[] {
	if (!Array.isArray(value) || value.length > MAXIMUM_ROWS) {
		throw new RangeError(`The ${label} row inventory exceeds its bound.`);
	}
	const ids = new Set<string>();
	let priorFrame = -1;
	return Object.freeze(value.map((candidate, index) => {
		const row = exactRecord(candidate, ROW_FIELDS, `${label} row ${String(index)}`);
		const resultId = id(row.resultId, `${label} result ID`);
		if (ids.has(resultId)) throw new TypeError(`The ${label} result IDs must be unique.`);
		ids.add(resultId);
		const timelineFrame = integer(row.timelineFrame, `${label} timeline frame`);
		if (timelineFrame < priorFrame) throw new RangeError(`The ${label} rows must be ordered.`);
		priorFrame = timelineFrame;
		return Object.freeze({ resultId, timelineFrame,
			label: boundedText(row.label, 4_096, `${label} label`) });
	}));
}

function binaryBytes(value: unknown): Uint8Array {
	if (value instanceof ArrayBuffer) return Uint8Array.from(new Uint8Array(value));
	if (ArrayBuffer.isView(value)) {
		return Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
	}
	throw new TypeError('A semantic derivative requires one binary embedding matrix.');
}

function exactRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| Reflect.ownKeys(value).length !== fields.length
		|| Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`The ${label} fields are invalid.`);
	}
	return value as Record<string, unknown>;
}

function enumValue<const Values extends readonly string[]>(
	value: unknown, values: Values, label: string,
): Values[number] {
	if (!values.includes(value as Values[number])) throw new TypeError(`The ${label} is invalid.`);
	return value as Values[number];
}

function id(value: unknown, label: string): string { return stringValue(value, ID, label); }
function stringValue(value: unknown, pattern: RegExp, label: string): string {
	if (typeof value !== 'string' || !pattern.test(value)) throw new TypeError(`The ${label} is invalid.`);
	return value;
}
function integer(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`The ${label} is invalid.`);
	return Number(value);
}
function boundedText(value: unknown, maximum: number, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > maximum || CONTROL.test(value)) {
		throw new TypeError(`The ${label} is invalid.`);
	}
	return value;
}
function digest(value: Uint8Array): string { return bytesToHex(sha256(value)); }
