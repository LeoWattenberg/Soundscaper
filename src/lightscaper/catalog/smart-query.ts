/* SPDX-License-Identifier: AGPL-3.0-only */

import { LIGHTSCAPER_CATALOG_LIMITS as LIMITS, type PhotoDocumentV1, type PhotoSmartQueryV1 } from './types.ts';
import { array, field, id, integer, localTimestamp, oneOf, record, text } from './value-validation.ts';

export const PHOTO_FLAGS = Object.freeze(['unflagged', 'pick', 'reject'] as const);
export const PHOTO_COLOR_LABELS = Object.freeze(['none', 'red', 'yellow', 'green', 'blue', 'purple'] as const);

export function normalizePhotoSmartQueryV1(value: unknown): PhotoSmartQueryV1 {
	let nodes = 0;
	function visit(candidate: unknown, depth: number): PhotoSmartQueryV1 {
		if (depth > LIMITS.maximumQueryDepth) throw new RangeError('Photo smart query exceeds its depth budget.');
		nodes += 1;
		if (nodes > LIMITS.maximumQueryNodes) throw new RangeError('Photo smart query exceeds its node budget.');
		const input = record(candidate, 'photo smart query', ['kind', 'terms', 'term', 'minimum', 'maximum', 'value', 'id', 'contains', 'from', 'to'], ['kind']);
		const kind = oneOf(field(input, 'kind'), ['all', 'any', 'not', 'rating', 'flag', 'label', 'keyword', 'folder', 'file-name', 'capture-time'] as const, 'smart query kind');
		switch (kind) {
			case 'all':
			case 'any': {
				record(input, 'smart query group', ['kind', 'terms']);
				return Object.freeze({ kind, terms: Object.freeze(array(field(input, 'terms'), 'smart query terms', 1, LIMITS.maximumQueryNodes).map((term) => visit(term, depth + 1))) });
			}
			case 'not':
				record(input, 'smart query negation', ['kind', 'term']);
				return Object.freeze({ kind, term: visit(field(input, 'term'), depth + 1) });
			case 'rating': {
				record(input, 'smart query rating', ['kind', 'minimum', 'maximum']);
				const minimum = integer(field(input, 'minimum'), 0, 5, 'query rating minimum');
				const maximum = integer(field(input, 'maximum'), minimum, 5, 'query rating maximum');
				return Object.freeze({ kind, minimum, maximum });
			}
			case 'flag':
				record(input, 'smart query flag', ['kind', 'value']);
				return Object.freeze({ kind, value: oneOf(field(input, 'value'), PHOTO_FLAGS, 'query flag') });
			case 'label':
				record(input, 'smart query label', ['kind', 'value']);
				return Object.freeze({ kind, value: oneOf(field(input, 'value'), PHOTO_COLOR_LABELS, 'query label') });
			case 'keyword':
			case 'folder':
				record(input, 'smart query reference', ['kind', 'id']);
				return Object.freeze({ kind, id: id(field(input, 'id'), 'query reference ID') });
			case 'file-name':
				record(input, 'smart query filename', ['kind', 'contains']);
				return Object.freeze({ kind, contains: text(field(input, 'contains'), 'query filename', 256, 1) });
			case 'capture-time': {
				record(input, 'smart query capture time', ['kind', 'from', 'to']);
				const fromValue = field(input, 'from');
				const toValue = field(input, 'to');
				const from = fromValue === null ? null : localTimestamp(fromValue, 'query capture from');
				const to = toValue === null ? null : localTimestamp(toValue, 'query capture to');
				if (from === null && to === null || from !== null && to !== null && from >= to) throw new RangeError('Query capture interval is empty.');
				return Object.freeze({ kind, from, to });
			}
		}
	}
	return visit(value, 1);
}

/** Evaluation never interprets scripts, regexes, filesystem paths, or missing timezone offsets. */
export function matchesPhotoQueryV1(photo: PhotoDocumentV1, value: unknown): boolean {
	function visit(query: PhotoSmartQueryV1): boolean {
		switch (query.kind) {
			case 'all': return query.terms.every(visit);
			case 'any': return query.terms.some(visit);
			case 'not': return !visit(query.term);
			case 'rating': return photo.rating >= query.minimum && photo.rating <= query.maximum;
			case 'flag': return photo.flag === query.value;
			case 'label': return photo.colorLabel === query.value;
			case 'folder': return photo.folderId === query.id;
			case 'keyword': return photo.keywordIds.includes(query.id);
			case 'file-name': return photo.metadata.fileName.toLowerCase().includes(query.contains.toLowerCase());
			case 'capture-time': {
				const capture = photo.metadata.captureTime?.local;
				return capture !== undefined && (query.from === null || capture >= query.from) && (query.to === null || capture < query.to);
			}
		}
	}
	return visit(normalizePhotoSmartQueryV1(value));
}

export function validatePhotoQueryReferencesV1(query: PhotoSmartQueryV1, folders: ReadonlySet<string>, keywords: ReadonlySet<string>): void {
	switch (query.kind) {
		case 'all':
		case 'any':
			for (const term of query.terms) validatePhotoQueryReferencesV1(term, folders, keywords);
			break;
		case 'not': validatePhotoQueryReferencesV1(query.term, folders, keywords); break;
		case 'folder':
		case 'keyword':
			if (!(query.kind === 'folder' ? folders : keywords).has(query.id)) throw new ReferenceError('Smart query references a missing hierarchy node.');
			break;
	}
}
