/* SPDX-License-Identifier: AGPL-3.0-only */

/** Versioned, non-biometric visual tags and OCR rows for disposable semantic indexes. */

import type { AssistanceSemanticIndexRowV1 } from './semantic-search-index-v1.ts';
import {
	sampleAssistanceShotsV1,
	type AssistanceShotV1,
	type AssistanceShotSampleAnchorV1,
} from './visual-indexing-v1.ts';

export const ASSISTANCE_VISUAL_SEARCH_RECORDS_SCHEMA_VERSION = 1 as const;
export const ASSISTANCE_VISUAL_SEARCH_RECORD_VERSION = 1 as const;
export const ASSISTANCE_VISUAL_TAG_TAXONOMY_VERSION = 1 as const;
export const ASSISTANCE_VISUAL_SEARCH_RECORDS_MEDIA_TYPE =
	'application/vnd.soundscaper.visual-search-records-v1+json' as const;

/** This closed vocabulary deliberately carries no identity, age, gender, or ethnicity labels. */
export const ASSISTANCE_NON_BIOMETRIC_VISUAL_TAGS_V1 = Object.freeze([
	'animal', 'close-up', 'document', 'food', 'group', 'high-motion', 'indoor',
	'landscape', 'low-motion', 'medium-shot', 'nature', 'office', 'outdoor',
	'performance', 'person', 'presentation', 'product', 'screen', 'sports', 'stage',
	'studio', 'text-overlay', 'urban', 'vehicle', 'vehicle-interior', 'wide-shot',
] as const);

export type AssistanceNonBiometricVisualTagV1 =
	(typeof ASSISTANCE_NON_BIOMETRIC_VISUAL_TAGS_V1)[number];

export interface AssistanceVisualSearchSampleAuthorityV1 {
	readonly resultId: string;
	readonly shotId: string;
	readonly anchor: AssistanceShotSampleAnchorV1;
	readonly sourceFrame: number;
	readonly timelineFrame: number;
}

export interface AssistanceVisualSearchTagV1 {
	readonly tag: AssistanceNonBiometricVisualTagV1;
	readonly score: number;
}

export interface AssistanceVisualSearchRecordV1 extends AssistanceVisualSearchSampleAuthorityV1 {
	readonly recordVersion: typeof ASSISTANCE_VISUAL_SEARCH_RECORD_VERSION;
	readonly embeddingRow: number;
	readonly tags: readonly AssistanceVisualSearchTagV1[];
}

export interface AssistanceOcrSearchRecordV1 extends AssistanceVisualSearchSampleAuthorityV1 {
	readonly recordVersion: typeof ASSISTANCE_VISUAL_SEARCH_RECORD_VERSION;
	readonly text: string;
	readonly confidence: number;
}

export interface AssistanceVisualSearchRecordsV1 {
	readonly schemaVersion: typeof ASSISTANCE_VISUAL_SEARCH_RECORDS_SCHEMA_VERSION;
	readonly tagTaxonomyVersion: typeof ASSISTANCE_VISUAL_TAG_TAXONOMY_VERSION;
	readonly visual: readonly AssistanceVisualSearchRecordV1[];
	readonly ocr: readonly AssistanceOcrSearchRecordV1[];
}

export interface AssistanceVisualSearchRowsV1 {
	readonly visual: readonly AssistanceSemanticIndexRowV1[];
	readonly ocr: readonly AssistanceSemanticIndexRowV1[];
}

const SAMPLE_FIELDS = Object.freeze(['shotId', 'sourceFrame', 'anchor']);
const AUTHORITY_FIELDS = Object.freeze([
	'resultId', 'shotId', 'anchor', 'sourceFrame', 'timelineFrame',
] as const);
const RECORDS_FIELDS = Object.freeze([
	'schemaVersion', 'tagTaxonomyVersion', 'visual', 'ocr',
]);
const VISUAL_FIELDS = Object.freeze([
	'recordVersion', ...AUTHORITY_FIELDS, 'embeddingRow', 'tags',
]);
const OCR_FIELDS = Object.freeze([
	'recordVersion', ...AUTHORITY_FIELDS, 'text', 'confidence',
]);
const TAG_FIELDS = Object.freeze(['tag', 'score']);
const ANCHORS = Object.freeze([
	'first-quarter', 'first-third', 'midpoint', 'second-third', 'third-quarter',
] as const);
const ID = /^[A-Za-z\d][A-Za-z\d._:-]{0,255}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const MAXIMUM_RECORDS = 100_000;
const MAXIMUM_OCR_TEXT = 4_096;
const MAXIMUM_SERIALIZED_BYTES = 64 * 1024 * 1024;

/** Bind deterministic shot samples to caller-reviewed source-to-timeline mapping. */
export function createAssistanceVisualSearchSampleAuthorityV1(
	shotsValue: readonly AssistanceShotV1[],
	sampleRateValue: number,
	timelineFramesValue: readonly number[],
): readonly AssistanceVisualSearchSampleAuthorityV1[] {
	const samples = sampleAssistanceShotsV1(shotsValue, sampleRateValue);
	if (!Array.isArray(timelineFramesValue) || samples.length !== timelineFramesValue.length
		|| samples.length > MAXIMUM_RECORDS) {
		throw new RangeError('Visual search sample authority requires matching bounded samples and jumps.');
	}
	let priorSourceFrame = -1;
	let priorTimelineFrame = -1;
	return Object.freeze(samples.map((candidate, index) => {
		const row = exactRecord(candidate, SAMPLE_FIELDS, `visual sample ${String(index)}`);
		const shotId = stableId(row.shotId, `visual sample ${String(index)} shot ID`);
		const sourceFrame = frame(row.sourceFrame, `visual sample ${String(index)} source frame`);
		const timelineFrame = frame(timelineFramesValue[index],
			`visual sample ${String(index)} timeline jump`);
		const anchor = enumValue(row.anchor, ANCHORS, `visual sample ${String(index)} anchor`);
		if (sourceFrame <= priorSourceFrame || timelineFrame < priorTimelineFrame) {
			throw new RangeError('Visual search sample authority must be source-ordered and timeline-monotonic.');
		}
		priorSourceFrame = sourceFrame;
		priorTimelineFrame = timelineFrame;
		return Object.freeze({ resultId: `visual-sample:${String(index)}`,
			shotId, anchor, sourceFrame, timelineFrame });
	}));
}

export function reviewAssistanceVisualSearchRecordsV1(
	value: unknown,
	authorityValue: readonly AssistanceVisualSearchSampleAuthorityV1[],
): AssistanceVisualSearchRecordsV1 {
	const authority = reviewAuthority(authorityValue);
	const row = exactRecord(value, RECORDS_FIELDS, 'visual search record set');
	if (row.schemaVersion !== ASSISTANCE_VISUAL_SEARCH_RECORDS_SCHEMA_VERSION
		|| row.tagTaxonomyVersion !== ASSISTANCE_VISUAL_TAG_TAXONOMY_VERSION) {
		throw new TypeError('The visual search record or non-biometric tag taxonomy version is unsupported.');
	}
	if (!Array.isArray(row.visual) || row.visual.length !== authority.length) {
		throw new RangeError('Visual search records must bind every exact sampled frame once.');
	}
	const visual = row.visual.map((candidate, index): AssistanceVisualSearchRecordV1 => {
		const label = `visual search record ${String(index)}`;
		const record = exactRecord(candidate, VISUAL_FIELDS, label);
		if (record.recordVersion !== ASSISTANCE_VISUAL_SEARCH_RECORD_VERSION) {
			throw new TypeError(`${label} has an unsupported record version.`);
		}
		const expected = authority[index]!;
		assertAuthority(record, expected, label);
		if (record.embeddingRow !== index) {
			throw new RangeError(`${label} has an ambiguous embedding row.`);
		}
		return Object.freeze({ recordVersion: ASSISTANCE_VISUAL_SEARCH_RECORD_VERSION,
			...expected, embeddingRow: index, tags: reviewTags(record.tags, label) });
	});
	if (!Array.isArray(row.ocr) || row.ocr.length > authority.length) {
		throw new RangeError('OCR search records exceed their exact sampled-frame authority.');
	}
	const authorityById = new Map(authority.map((sample, index) => [sample.resultId,
		Object.freeze({ sample, index })] as const));
	let priorAuthorityIndex = -1;
	const ocr = row.ocr.map((candidate, index): AssistanceOcrSearchRecordV1 => {
		const label = `OCR search record ${String(index)}`;
		const record = exactRecord(candidate, OCR_FIELDS, label);
		if (record.recordVersion !== ASSISTANCE_VISUAL_SEARCH_RECORD_VERSION) {
			throw new TypeError(`${label} has an unsupported record version.`);
		}
		const resultId = stableId(record.resultId, `${label} result ID`);
		const binding = authorityById.get(resultId);
		if (!binding || binding.index <= priorAuthorityIndex) {
			throw new TypeError('OCR search records must be unique and follow sampled-frame order.');
		}
		priorAuthorityIndex = binding.index;
		assertAuthority(record, binding.sample, label);
		return Object.freeze({ recordVersion: ASSISTANCE_VISUAL_SEARCH_RECORD_VERSION,
			...binding.sample, text: boundedText(record.text, MAXIMUM_OCR_TEXT, `${label} text`),
			confidence: unit(record.confidence, `${label} confidence`) });
	});
	return Object.freeze({ schemaVersion: ASSISTANCE_VISUAL_SEARCH_RECORDS_SCHEMA_VERSION,
		tagTaxonomyVersion: ASSISTANCE_VISUAL_TAG_TAXONOMY_VERSION,
		visual: Object.freeze(visual), ocr: Object.freeze(ocr) });
}

/** Convert reviewed metadata into exact rows paired with the separately stored embedding matrix. */
export function createAssistanceVisualSearchRowsV1(
	value: unknown,
	authorityValue: readonly AssistanceVisualSearchSampleAuthorityV1[],
): AssistanceVisualSearchRowsV1 {
	const records = reviewAssistanceVisualSearchRecordsV1(value, authorityValue);
	return Object.freeze({
		visual: Object.freeze(records.visual.map((record) => Object.freeze({
			resultId: record.resultId,
			timelineFrame: record.timelineFrame,
			label: record.tags.length === 0 ? 'Visual sample'
				: record.tags.map(({ tag }) => tag).join(', '),
		}))),
		ocr: Object.freeze(records.ocr.map((record) => Object.freeze({
			resultId: record.resultId, timelineFrame: record.timelineFrame, label: record.text,
		}))),
	});
}

export function createAssistanceVisualSearchDerivativePayloadV1(
	value: unknown,
	authorityValue: readonly AssistanceVisualSearchSampleAuthorityV1[],
): Readonly<{ mediaType: typeof ASSISTANCE_VISUAL_SEARCH_RECORDS_MEDIA_TYPE; bytes: Uint8Array }> {
	const records = reviewAssistanceVisualSearchRecordsV1(value, authorityValue);
	const bytes = new TextEncoder().encode(JSON.stringify(records));
	if (bytes.byteLength > MAXIMUM_SERIALIZED_BYTES) {
		throw new RangeError('Visual search records exceed their serialized derivative bound.');
	}
	return Object.freeze({ mediaType: ASSISTANCE_VISUAL_SEARCH_RECORDS_MEDIA_TYPE, bytes });
}

export function parseAssistanceVisualSearchRecordsV1(
	value: ArrayBuffer | ArrayBufferView,
	authorityValue: readonly AssistanceVisualSearchSampleAuthorityV1[],
): AssistanceVisualSearchRecordsV1 {
	const bytes = byteView(value);
	if (bytes.byteLength < 1 || bytes.byteLength > MAXIMUM_SERIALIZED_BYTES) {
		throw new RangeError('Visual search derivative bytes exceed their bound.');
	}
	const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
	return reviewAssistanceVisualSearchRecordsV1(JSON.parse(text) as unknown, authorityValue);
}

function reviewAuthority(
	value: readonly AssistanceVisualSearchSampleAuthorityV1[],
): readonly AssistanceVisualSearchSampleAuthorityV1[] {
	if (!Array.isArray(value) || value.length > MAXIMUM_RECORDS) {
		throw new RangeError('Visual search sample authority exceeds its bound.');
	}
	let priorSourceFrame = -1;
	let priorTimelineFrame = -1;
	const seen = new Set<string>();
	return Object.freeze(value.map((candidate, index) => {
		const label = `visual search sample authority ${String(index)}`;
		const row = exactRecord(candidate, AUTHORITY_FIELDS, label);
		const resultId = stableId(row.resultId, `${label} result ID`);
		if (seen.has(resultId)) throw new TypeError('Visual search sample result IDs must be unique.');
		seen.add(resultId);
		const sourceFrame = frame(row.sourceFrame, `${label} source frame`);
		const timelineFrame = frame(row.timelineFrame, `${label} timeline frame`);
		if (sourceFrame <= priorSourceFrame || timelineFrame < priorTimelineFrame) {
			throw new RangeError('Visual search sample authority must remain ordered and monotonic.');
		}
		priorSourceFrame = sourceFrame;
		priorTimelineFrame = timelineFrame;
		return Object.freeze({ resultId,
			shotId: stableId(row.shotId, `${label} shot ID`),
			anchor: enumValue(row.anchor, ANCHORS, `${label} anchor`),
			sourceFrame, timelineFrame });
	}));
}

function reviewTags(value: unknown, label: string): readonly AssistanceVisualSearchTagV1[] {
	if (!Array.isArray(value) || value.length > ASSISTANCE_NON_BIOMETRIC_VISUAL_TAGS_V1.length) {
		throw new RangeError(`${label} non-biometric tag inventory exceeds its taxonomy.`);
	}
	let prior = -1;
	return Object.freeze(value.map((candidate, index) => {
		const row = exactRecord(candidate, TAG_FIELDS, `${label} tag ${String(index)}`);
		const taxonomyIndex = ASSISTANCE_NON_BIOMETRIC_VISUAL_TAGS_V1.indexOf(
			row.tag as AssistanceNonBiometricVisualTagV1,
		);
		if (taxonomyIndex <= prior) {
			throw new TypeError(`${label} tags must be canonical, unique, and non-biometric.`);
		}
		prior = taxonomyIndex;
		return Object.freeze({ tag: ASSISTANCE_NON_BIOMETRIC_VISUAL_TAGS_V1[taxonomyIndex]!,
			score: positiveUnit(row.score, `${label} tag score`) });
	}));
}

function assertAuthority(
	row: Readonly<Record<string, unknown>>,
	expected: AssistanceVisualSearchSampleAuthorityV1,
	label: string,
): void {
	for (const field of AUTHORITY_FIELDS) {
		if (row[field] !== expected[field]) {
			throw new RangeError(`${label} disagrees with its exact sampled timeline-jump authority.`);
		}
	}
}

function exactRecord(
	value: unknown,
	fields: readonly string[],
	label: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const row = value as Readonly<Record<string, unknown>>;
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

function frame(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}

function unit(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
		throw new RangeError(`The ${label} must be finite and between zero and one.`);
	}
	return value;
}

function positiveUnit(value: unknown, label: string): number {
	const result = unit(value, label);
	if (result === 0) throw new RangeError(`The ${label} must be positive.`);
	return result;
}

function enumValue<const Value extends readonly string[]>(
	value: unknown,
	values: Value,
	label: string,
): Value[number] {
	if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
		throw new TypeError(`The ${label} is invalid.`);
	}
	return value as Value[number];
}

function byteView(value: ArrayBuffer | ArrayBufferView): Uint8Array {
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (!ArrayBuffer.isView(value)) throw new TypeError('Visual search derivative bytes are invalid.');
	return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}
