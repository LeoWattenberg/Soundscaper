/* SPDX-License-Identifier: AGPL-3.0-only */

// Turning reviewed Qt messages into Soundscaper copy. Only the exact context,
// source and comment triples the reviewed mapping names are converted, and only
// from messages Qt marks as finished; a translation whose placeholders do not
// match the source, or that carries markup or an unreviewed transform, is
// excluded by name. Split out of audacity-qt-translations.mjs; no behaviour
// changes here.

import { AUDACITY_QT_MAPPING } from '../../src/common/i18n/audacity-qt-mapping.js';
import { compareCodeUnits } from './canonical-json.mjs';
import { normalizeQtLocale, qtIdentity } from './audacity-qt-catalog.mjs';
import {
	deepFreeze,
	fail,
	isFlatStringRecord,
	sortRecord,
} from './audacity-qt-values.mjs';

export const AUDACITY_TRANSLATION_ELIGIBILITY = 0.79;
export const ELLIPSIS_PATTERN = /\u2026|\.{3}/u;
const ELLIPSES_GLOBAL_PATTERN = /\u2026|\.{3}/gu;
const ALLOWED_TRANSFORMS = new Set(['stripEllipsis', 'stripMnemonic']);

export function validateAudacityQtMapping(mapping = AUDACITY_QT_MAPPING) {
	if (!Array.isArray(mapping) || mapping.length === 0) fail('QT_MAPPING_EMPTY', 'Audacity Qt mapping must not be empty.');
	const keys = new Set();
	const identities = new Set();
	for (const entry of mapping) {
		if (!entry || typeof entry !== 'object') fail('QT_MAPPING_SHAPE', 'Audacity Qt mapping entries must be objects.');
		if (!/^[A-Za-z][A-Za-z0-9_.-]*$/u.test(entry.key || '')) fail('QT_MAPPING_KEY', `Invalid catalog key ${entry.key}.`);
		if (keys.has(entry.key)) fail('QT_MAPPING_DUPLICATE_KEY', `Duplicate catalog key ${entry.key}.`);
		keys.add(entry.key);
		for (const field of ['context', 'source', 'comment']) {
			if (typeof entry[field] !== 'string' || (field !== 'comment' && !entry[field])) {
				fail('QT_MAPPING_IDENTITY', `Mapping ${entry.key} must define string ${field}.`);
			}
		}
		const identity = qtIdentity(entry.context, entry.source, entry.comment);
		if (identities.has(identity)) fail('QT_MAPPING_DUPLICATE_IDENTITY', `Duplicate Qt identity for ${entry.key}.`);
		identities.add(identity);
		const transforms = entry.transforms || [];
		if (!Array.isArray(transforms) || new Set(transforms).size !== transforms.length || transforms.some((item) => !ALLOWED_TRANSFORMS.has(item))) {
			fail('QT_MAPPING_TRANSFORM', `Mapping ${entry.key} has invalid transforms.`);
		}
		if (ELLIPSIS_PATTERN.test(entry.source) && !transforms.includes('stripEllipsis')) {
			fail('QT_MAPPING_ELLIPSIS', `Mapping ${entry.key} must explicitly strip its source ellipsis.`);
		}
		if (/Audacity/iu.test(entry.source) && entry.allowAudacityBrand !== true) {
			fail('QT_MAPPING_BRAND', `Mapping ${entry.key} must explicitly allow Audacity branding.`);
		}
		validatePlaceholderAdapter(entry);
	}
	return mapping;
}

export function convertQtCatalog(catalog, mapping = AUDACITY_QT_MAPPING, options = {}) {
	validateAudacityQtMapping(mapping);
	if (!catalog || !Array.isArray(catalog.messages)) fail('QT_CATALOG_SHAPE', 'Qt catalog is invalid.');
	const locale = normalizeQtLocale(options.locale || catalog.language);
	const index = new Map();
	for (const message of catalog.messages) {
		const identity = qtIdentity(message.context, message.source, message.comment || '');
		const matches = index.get(identity) || [];
		matches.push(message);
		index.set(identity, matches);
	}
	const messages = {};
	const skipped = [];
	for (const entry of mapping) {
		const matches = index.get(qtIdentity(entry.context, entry.source, entry.comment)) || [];
		if (matches.length === 0) {
			skipped.push({ key: entry.key, reason: 'missing' });
			continue;
		}
		if (matches.length !== 1) {
			skipped.push({ key: entry.key, reason: 'ambiguous' });
			continue;
		}
		const message = matches[0];
		const exclusion = excludedMessageReason(message);
		if (exclusion) {
			skipped.push({ key: entry.key, reason: exclusion });
			continue;
		}
		if (!samePlaceholderMultiset(entry.source, message.translation)) {
			skipped.push({ key: entry.key, reason: 'placeholder-mismatch' });
			continue;
		}
		let value = applyPlaceholderAdapter(message.translation, entry.placeholders || {});
		for (const transform of entry.transforms || []) {
			if (transform === 'stripEllipsis') value = stripEllipses(value);
		}
		// Imported UI values are always free of Qt presentation syntax, even when
		// a translator introduced it outside the mapped English source.
		value = stripQtMnemonic(stripEllipses(value)).normalize('NFC');
		if (!value.trim()) {
			skipped.push({ key: entry.key, reason: 'empty' });
			continue;
		}
		if (/Audacity/iu.test(value) && entry.allowAudacityBrand !== true) {
			skipped.push({ key: entry.key, reason: 'brand' });
			continue;
		}
		messages[entry.key] = value;
	}
	const sortedMessages = sortRecord(messages);
	const sortedSkipped = [...skipped].sort(compareAuditEntry);
	const mapped = Object.keys(sortedMessages).length;
	const total = mapping.length;
	return Object.freeze({
		locale,
		messages: Object.freeze(sortedMessages),
		audit: Object.freeze({
			mapped,
			total,
			coverage: total === 0 ? 0 : mapped / total,
			skipped: Object.freeze(sortedSkipped.map(Object.freeze)),
		}),
	});
}

export function auditQtMappingCandidates(englishCopy, sourceCatalog, mapping = AUDACITY_QT_MAPPING) {
	validateAudacityQtMapping(mapping);
	if (!isFlatStringRecord(englishCopy) || !sourceCatalog || !Array.isArray(sourceCatalog.messages)) {
		fail('QT_CANDIDATE_INPUT', 'Candidate audit requires a flat English catalog and parsed Qt source catalog.');
	}
	const selectedKeys = new Set(mapping.map((entry) => entry.key));
	const copyKeysByValue = new Map();
	for (const [key, value] of Object.entries(englishCopy)) {
		const normalized = normalizedCandidateText(value);
		const keys = copyKeysByValue.get(normalized) || [];
		keys.push(key);
		copyKeysByValue.set(normalized, keys);
	}
	const sourceByValue = new Map();
	for (const message of sourceCatalog.messages) {
		const normalized = normalizedCandidateText(message.source);
		const identities = sourceByValue.get(normalized) || new Map();
		const identity = qtIdentity(message.context, message.source, message.comment || '');
		const records = identities.get(identity) || [];
		records.push(message);
		identities.set(identity, records);
		sourceByValue.set(normalized, identities);
	}
	const ambiguous = [];
	const skipped = [];
	for (const [key, value] of Object.entries(englishCopy).sort(([left], [right]) => compareCodeUnits(left, right))) {
		if (selectedKeys.has(key)) continue;
		const normalized = normalizedCandidateText(value);
		const identities = sourceByValue.get(normalized);
		if (!identities) continue;
		const candidates = [...identities].map(([identity, records]) => {
			const [context, source, comment] = JSON.parse(identity);
			return { context, source, comment, occurrences: records.length };
		}).sort(compareCandidateIdentity);
		if ((copyKeysByValue.get(normalized) || []).length > 1) {
			skipped.push({ key, reason: 'catalog-value-reused', candidates });
			continue;
		}
		if (identities.size !== 1 || candidates[0].occurrences !== 1) {
			ambiguous.push({ key, reason: 'ambiguous-source', candidates });
			continue;
		}
		const source = candidates[0].source;
		let reason = 'not-reviewed';
		if (/Audacity/iu.test(source)) reason = 'brand-review-required';
		else if (extractPlaceholders(source).length || /\{[A-Za-z][A-Za-z0-9_]*\}/u.test(value)) reason = 'placeholder-adapter-required';
		skipped.push({ key, reason, candidates });
	}
	return deepFreeze({ ambiguous, skipped });
}

export function validateMappingAgainstSourceCatalog(sourceCatalog, mapping = AUDACITY_QT_MAPPING) {
	validateAudacityQtMapping(mapping);
	if (!sourceCatalog || !Array.isArray(sourceCatalog.messages)) fail('QT_SOURCE_CATALOG', 'Audacity English source catalog is missing.');
	const counts = new Map();
	for (const message of sourceCatalog.messages) {
		const identity = qtIdentity(message.context, message.source, message.comment || '');
		counts.set(identity, (counts.get(identity) || 0) + 1);
	}
	for (const entry of mapping) {
		const count = counts.get(qtIdentity(entry.context, entry.source, entry.comment)) || 0;
		if (count === 0) fail('QT_MAPPING_SOURCE_MISSING', `Mapped Audacity source is missing for ${entry.key}.`);
		if (count !== 1) fail('QT_MAPPING_SOURCE_AMBIGUOUS', `Mapped Audacity source is ambiguous for ${entry.key}.`);
	}
	return true;
}


export function stripEllipses(value) {
	return String(value)
		.replace(ELLIPSES_GLOBAL_PATTERN, '')
		.replace(/[ \t]+(?=\r?$)/gmu, '')
		.trim();
}

export function extractPlaceholders(value) {
	const placeholders = [];
	const text = String(value);
	const pattern = /%%|%L?\d+|%(?:\d+\$)?[-+ #0']*(?:\d+|\*)?(?:\.(?:\d+|\*))?(?:hh|h|ll|l|j|z|t|L)?[diuoxXfFeEgGaAcsp]/gu;
	for (const match of text.matchAll(pattern)) {
		if (match[0] !== '%%') placeholders.push(match[0]);
	}
	return placeholders;
}


export function emptyConversion(locale, mapping) {
	return Object.freeze({
		locale,
		messages: Object.freeze({}),
		audit: Object.freeze({
			mapped: 0,
			total: mapping.length,
			coverage: 0,
			skipped: Object.freeze(mapping.map((entry) => Object.freeze({ key: entry.key, reason: 'catalog-missing' }))),
		}),
	});
}

export function excludedMessageReason(message) {
	if (message.numerus) return 'numerus';
	if (message.unsupportedMarkup) return 'unsupported-markup';
	const type = String(message.translationType || '').toLowerCase();
	if (type === 'unfinished' || type === 'vanished' || type === 'obsolete' || type === 'fuzzy') return type;
	if (type && type !== 'finished') return 'inactive';
	if (!message.translation || !message.translation.trim()) return 'empty';
	return null;
}

export function validatePlaceholderAdapter(entry) {
	const sourcePlaceholders = [...new Set(extractPlaceholders(entry.source))].sort();
	const adapter = entry.placeholders || {};
	if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter)) fail('QT_MAPPING_PLACEHOLDER', `Mapping ${entry.key} has an invalid placeholder adapter.`);
	const adapterKeys = Object.keys(adapter).sort();
	if (sourcePlaceholders.length !== adapterKeys.length || sourcePlaceholders.some((value, index) => value !== adapterKeys[index])) {
		fail('QT_MAPPING_PLACEHOLDER', `Mapping ${entry.key} must adapt every source placeholder exactly once.`);
	}
	for (const target of Object.values(adapter)) {
		if (!/^\{[A-Za-z][A-Za-z0-9_]*\}$/u.test(target)) fail('QT_MAPPING_PLACEHOLDER', `Mapping ${entry.key} has an invalid named placeholder.`);
	}
}

export function samePlaceholderMultiset(source, translation) {
	const left = extractPlaceholders(source).sort();
	const right = extractPlaceholders(translation).sort();
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function applyPlaceholderAdapter(value, adapter) {
	return String(value).replace(/%%|%L?\d+|%(?:\d+\$)?[-+ #0']*(?:\d+|\*)?(?:\.(?:\d+|\*))?(?:hh|h|ll|l|j|z|t|L)?[diuoxXfFeEgGaAcsp]/gu, (token) => {
		if (token === '%%') return token;
		return adapter[token] || token;
	});
}

export function stripQtMnemonic(value) {
	const literalAmpersand = '\u0000SOUNDSCAPER_AMPERSAND\u0000';
	return String(value)
		.replace(/\(&[A-Za-z0-9]\)/gu, '')
		.replaceAll('&&', literalAmpersand)
		.replace(/&(?=.)/gu, '')
		.replaceAll(literalAmpersand, '&');
}


export function compareAuditEntry(left, right) {
	return compareCodeUnits(left.key, right.key) || compareCodeUnits(left.reason, right.reason);
}

export function compareCandidateIdentity(left, right) {
	return compareCodeUnits(left.context, right.context)
		|| compareCodeUnits(left.source, right.source) || compareCodeUnits(left.comment, right.comment);
}

export function normalizedCandidateText(value) {
	return stripEllipses(stripQtMnemonic(value)).normalize('NFC');
}

