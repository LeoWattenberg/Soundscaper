/* SPDX-License-Identifier: AGPL-3.0-only */

import { PHOTO_METADATA_NUMBER_COLUMNS_V2, PHOTO_METADATA_QUERY_COLUMN_IDS_V2, PHOTO_METADATA_QUERY_COLUMNS_V2,
	PHOTO_METADATA_TEXT_COLUMNS_V2, PHOTO_METADATA_TIME_COLUMNS_V2, readPhotoMetadataQueryColumnV2 } from './photo-metadata-query-columns-v2.ts';
import { PHOTO_SMART_QUERY_LIMITS_V2 as LIMITS, type PhotoPredicateV2, type PhotoQueryReferencesV2,
	type PhotoQuerySubjectV2, type PhotoSmartQueryV2 } from './photo-smart-query-types-v2.ts';
import { normalizePhotoSmartQueryV1, PHOTO_COLOR_LABELS, PHOTO_FLAGS } from './smart-query.ts';
import { array, field, id, integer, localTimestamp, number, oneOf, record, text, utcTimestamp } from './value-validation.ts';

const KINDS = ['all', 'any', 'not', 'rating', 'flag', 'label', 'keyword', 'folder', 'file-name', 'capture-time',
	'text', 'number', 'time', 'presence'] as const;
const FIELDS = ['kind', 'terms', 'term', 'minimum', 'maximum', 'value', 'id', 'contains', 'from', 'to', 'column', 'operator'];

/** Detached closed protocol. The 512KiB ceiling includes worst-case JSON escaping of 255 text leaves. */
export function normalizePhotoSmartQueryV2(value: unknown): PhotoSmartQueryV2 {
	const wrapper = record(value, 'photo smart query V2', ['schemaVersion', 'kind', 'predicate']);
	if (field(wrapper, 'schemaVersion') !== 2) throw new RangeError('Unsupported or future photo smart query version.');
	if (field(wrapper, 'kind') !== 'photo-smart-query') throw new TypeError('Photo smart query V2 requires its own kind.');
	let nodes = 0;
	function visit(candidate: unknown, depth: number): PhotoPredicateV2 {
		if (depth > LIMITS.maximumDepth) throw new RangeError('Photo smart query V2 exceeds its depth budget.');
		if (++nodes > LIMITS.maximumNodes) throw new RangeError('Photo smart query V2 exceeds its node budget.');
		const input = record(candidate, 'photo predicate V2', FIELDS, ['kind']);
		const kind = oneOf(field(input, 'kind'), KINDS, 'photo predicate kind');
		switch (kind) {
			case 'all':
			case 'any':
				record(input, 'photo predicate group', ['kind', 'terms']);
				return Object.freeze({ kind, terms: Object.freeze(array(field(input, 'terms'), 'photo predicate terms', 1,
					LIMITS.maximumNodes).map((term) => visit(term, depth + 1))) });
			case 'not':
				record(input, 'photo predicate negation', ['kind', 'term']);
				return Object.freeze({ kind, term: visit(field(input, 'term'), depth + 1) });
			case 'rating': {
				record(input, 'photo predicate rating', ['kind', 'minimum', 'maximum']);
				const minimum = integer(field(input, 'minimum'), 0, 5, 'query rating minimum');
				return Object.freeze({ kind, minimum, maximum: integer(field(input, 'maximum'), minimum, 5, 'query rating maximum') });
			}
			case 'flag':
				record(input, 'photo predicate flag', ['kind', 'value']);
				return Object.freeze({ kind, value: oneOf(field(input, 'value'), PHOTO_FLAGS, 'query flag') });
			case 'label':
				record(input, 'photo predicate label', ['kind', 'value']);
				return Object.freeze({ kind, value: oneOf(field(input, 'value'), PHOTO_COLOR_LABELS, 'query label') });
			case 'keyword':
			case 'folder':
				record(input, 'photo predicate reference', ['kind', 'id']);
				return Object.freeze({ kind, id: id(field(input, 'id'), 'query reference ID') });
			case 'file-name':
				record(input, 'photo predicate filename', ['kind', 'contains']);
				return Object.freeze({ kind, contains: text(field(input, 'contains'), 'query filename', LIMITS.maximumTextUnits, 1) });
			case 'capture-time':
				record(input, 'photo predicate capture time', ['kind', 'from', 'to']);
				return Object.freeze({ kind, ...readInterval(field(input, 'from'), field(input, 'to'), localTimestamp) });
			case 'text': {
				record(input, 'photo predicate text', ['kind', 'column', 'operator', 'value']);
				const column = oneOf(field(input, 'column'), PHOTO_METADATA_TEXT_COLUMNS_V2, 'query text column');
				const operator = oneOf(field(input, 'operator'), ['contains', 'equals', 'starts-with'] as const, 'query text operator');
				return Object.freeze({ kind, column, operator, value: text(field(input, 'value'), 'query text value',
					LIMITS.maximumTextUnits, operator === 'equals' ? 0 : 1, PHOTO_METADATA_QUERY_COLUMNS_V2[column].multiline) });
			}
			case 'number': {
				record(input, 'photo predicate number', ['kind', 'column', 'minimum', 'maximum']);
				const column = oneOf(field(input, 'column'), PHOTO_METADATA_NUMBER_COLUMNS_V2, 'query number column');
				const definition = PHOTO_METADATA_QUERY_COLUMNS_V2[column];
				const admit = definition.integer ? integer : number;
				const low = field(input, 'minimum'), high = field(input, 'maximum');
				const minimum = low === null ? null : admit(low, definition.minimum, definition.maximum, 'query number minimum');
				const maximum = high === null ? null : admit(high, definition.minimum, definition.maximum, 'query number maximum');
				if (minimum === null && maximum === null || minimum !== null && maximum !== null && minimum > maximum) {
					throw new RangeError('Query number range is empty.');
				}
				return Object.freeze({ kind, column, minimum, maximum });
			}
			case 'time': {
				record(input, 'photo predicate time', ['kind', 'column', 'from', 'to']);
				const column = oneOf(field(input, 'column'), PHOTO_METADATA_TIME_COLUMNS_V2, 'query time column');
				const admit = PHOTO_METADATA_QUERY_COLUMNS_V2[column].clock === 'local' ? localTimestamp : utcTimestamp;
				return Object.freeze({ kind, column, ...readInterval(field(input, 'from'), field(input, 'to'), admit) });
			}
			case 'presence':
				record(input, 'photo predicate presence', ['kind', 'column', 'value']);
				return Object.freeze({ kind, column: oneOf(field(input, 'column'), PHOTO_METADATA_QUERY_COLUMN_IDS_V2, 'query presence column'),
					value: oneOf(field(input, 'value'), ['known', 'unknown'] as const, 'query presence value') });
		}
	}
	const query = Object.freeze({ schemaVersion: 2 as const, kind: 'photo-smart-query' as const, predicate: visit(field(wrapper, 'predicate'), 1) });
	if (new TextEncoder().encode(JSON.stringify(query)).byteLength > LIMITS.maximumBytes) {
		throw new RangeError('Photo smart query V2 exceeds its byte budget.');
	}
	return query;
}

function readInterval(low: unknown, high: unknown, admit: (value: unknown, label: string) => string): Readonly<{ from: string | null; to: string | null }> {
	const from = low === null ? null : admit(low, 'query time from'), to = high === null ? null : admit(high, 'query time to');
	if (from === null && to === null || from !== null && to !== null && from >= to) throw new RangeError('Query time interval is empty.');
	return { from, to };
}

export function serializePhotoSmartQueryV2(value: unknown): string {
	return JSON.stringify(normalizePhotoSmartQueryV2(value));
}

/** The old parser remains authoritative for old input; migration is explicit rather than implicit admission. */
export function migratePhotoSmartQueryV1ToV2(value: unknown): PhotoSmartQueryV2 {
	return normalizePhotoSmartQueryV2({ schemaVersion: 2, kind: 'photo-smart-query', predicate: normalizePhotoSmartQueryV1(value) });
}

export function validatePhotoQueryReferencesV2(value: unknown, folders: ReadonlySet<string>, keywords: ReadonlySet<string>): void {
	validateReferences(normalizePhotoSmartQueryV2(value).predicate, { folders, keywords });
}

function validateReferences(predicate: PhotoPredicateV2, references: PhotoQueryReferencesV2): void {
	switch (predicate.kind) {
		case 'all':
		case 'any':
			for (const term of predicate.terms) validateReferences(term, references);
			break;
		case 'not': validateReferences(predicate.term, references); break;
		case 'keyword':
		case 'folder':
			if (!(predicate.kind === 'folder' ? references.folders : references.keywords).has(predicate.id)) {
				throw new ReferenceError('Photo smart query V2 references a missing hierarchy node.');
			}
			break;
	}
}

/** Compile once before scanning. Every reference is validated before any Boolean short circuit or subject access. */
export function compilePhotoSmartQueryV2(value: unknown, references: PhotoQueryReferencesV2): (photo: PhotoQuerySubjectV2) => boolean {
	const query = normalizePhotoSmartQueryV2(value);
	validateReferences(query.predicate, references);
	return compilePredicate(query.predicate);
}

function compilePredicate(query: PhotoPredicateV2): (photo: PhotoQuerySubjectV2) => boolean {
	switch (query.kind) {
		case 'all': {
			const terms = query.terms.map(compilePredicate);
			return (photo) => terms.every((term) => term(photo));
		}
		case 'any': {
			const terms = query.terms.map(compilePredicate);
			return (photo) => terms.some((term) => term(photo));
		}
		case 'not': {
			const term = compilePredicate(query.term);
			return (photo) => !term(photo);
		}
		case 'rating': return (photo) => photo.rating >= query.minimum && photo.rating <= query.maximum;
		case 'flag': return (photo) => photo.flag === query.value;
		case 'label': return (photo) => photo.colorLabel === query.value;
		case 'folder': return (photo) => photo.folderId === query.id;
		case 'keyword': return (photo) => photo.keywordIds.includes(query.id);
		case 'file-name': {
			const needle = query.contains.toLowerCase();
			return (photo) => photo.metadata.fileName.toLowerCase().includes(needle);
		}
		case 'capture-time': return (photo) => matchesInterval(photo.metadata.captureTime?.local ?? null, query);
		case 'text': {
			const needle = query.value.toLowerCase();
			return (photo) => {
				const value = readPhotoMetadataQueryColumnV2(photo, query.column);
				if (typeof value !== 'string') return false;
				const folded = value.toLowerCase();
				return query.operator === 'equals' ? folded === needle : query.operator === 'contains' ? folded.includes(needle) : folded.startsWith(needle);
			};
		}
		case 'number': return (photo) => {
			const value = readPhotoMetadataQueryColumnV2(photo, query.column);
			return typeof value === 'number' && (query.minimum === null || value >= query.minimum) && (query.maximum === null || value <= query.maximum);
		};
		case 'time': return (photo) => {
			const value = readPhotoMetadataQueryColumnV2(photo, query.column);
			return typeof value === 'string' && matchesInterval(value, query);
		};
		// Authored empty strings are known. Comparisons against nullable unknown values stay false.
		case 'presence': return (photo) => (readPhotoMetadataQueryColumnV2(photo, query.column) !== null) === (query.value === 'known');
	}
}

function matchesInterval(value: string | null, query: Readonly<{ from: string | null; to: string | null }>): boolean {
	return value !== null && (query.from === null || value >= query.from) && (query.to === null || value < query.to);
}
