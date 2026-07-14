#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { SaxesParser } from 'saxes';

import {
	AUDACITY_QT_MAPPING,
	AUDACITY_QT_MAPPING_VERSION,
} from '../src/i18n/audacity-qt-mapping.js';
import { ENGLISH_COPY } from '../src/i18n/catalogs.js';
import { AUDACITY_TO_BCP47, LOCALE_BY_TAG } from '../src/i18n/locales.js';
import {
	DEFAULT_TRANSLATION_ARCHIVE_LIMITS,
	TranslationArtifactError,
	inspectVerifiedZip,
} from './lib/verified-zip.mjs';

export { DEFAULT_TRANSLATION_ARCHIVE_LIMITS, TranslationArtifactError, inspectVerifiedZip };

export const TRANSLATION_PACK_SCHEMA_VERSION = 1;
export const TRANSLATION_RELEASE_SCHEMA_VERSION = 1;
export const AUDACITY_TRANSLATION_ELIGIBILITY = 0.79;
export const AUDACITY_TRANSLATION_MODIFICATION_NOTICE = 'Soundscaper converts reviewed Audacity Qt TS messages to per-locale JSON packs, excludes unsafe or inapplicable entries, adapts reviewed placeholders and mnemonics, and removes ellipsis punctuation.';

const MAX_QT_CATALOGS = 128;
const MAX_QT_MESSAGES = 50_000;
const MAX_LICENSE_BYTES = 2 * 1024 * 1024;
const ELLIPSIS_PATTERN = /\u2026|\.{3}/u;
const ELLIPSES_GLOBAL_PATTERN = /\u2026|\.{3}/gu;
const QT_CATALOG_NAME = /^audacity_([A-Za-z0-9][A-Za-z0-9_@-]*)\.ts$/u;
const ALLOWED_TRANSFORMS = new Set(['stripEllipsis', 'stripMnemonic']);
const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ps', 'ur']);

export function parseQtTs(input, options = {}) {
	const fileName = options.fileName || '<Qt TS>';
	const xml = decodeUtf8(input, fileName);
	let root = null;
	let doctypeSeen = false;
	let currentContext = null;
	let currentMessage = null;
	let capture = null;
	let messageCount = 0;
	let contextCount = 0;
	const stack = [];
	const messages = [];
	const parser = new SaxesParser({ fileName, xmlns: false });

	parser.on('doctype', (doctype) => {
		if (doctypeSeen || String(doctype).trim() !== 'TS') {
			fail('QT_TS_DOCTYPE', `${fileName} must contain only the standard <!DOCTYPE TS> declaration.`);
		}
		doctypeSeen = true;
	});
	parser.on('processinginstruction', ({ target }) => {
		fail('QT_TS_PROCESSING_INSTRUCTION', `${fileName} contains unsupported processing instruction ${target}.`);
	});
	parser.on('opentag', (node) => {
		stack.push(node.name);
		const depth = stack.length;
		if (depth === 1) {
			if (node.name !== 'TS' || root) fail('QT_TS_ROOT', `${fileName} must have one TS root element.`);
			root = {
				version: attribute(node, 'version'),
				language: attribute(node, 'language'),
			};
			return;
		}
		if (depth === 2 && node.name === 'context') {
			if (currentContext) fail('QT_TS_CONTEXT_NESTING', `${fileName} contains nested contexts.`);
			contextCount += 1;
			if (contextCount > MAX_QT_MESSAGES) fail('QT_TS_CONTEXT_LIMIT', `${fileName} has too many contexts.`);
			currentContext = { name: null };
			return;
		}
		if (depth === 3 && currentContext && node.name === 'name') {
			startCapture('contextName', depth);
			return;
		}
		if (depth === 3 && currentContext && node.name === 'message') {
			if (currentMessage) fail('QT_TS_MESSAGE_NESTING', `${fileName} contains nested messages.`);
			messageCount += 1;
			if (messageCount > (options.maxMessages || MAX_QT_MESSAGES)) {
				fail('QT_TS_MESSAGE_LIMIT', `${fileName} has too many messages.`);
			}
			currentMessage = {
				comment: null,
				context: currentContext.name,
				numerus: attribute(node, 'numerus').toLowerCase() === 'yes',
				source: null,
				translation: null,
				translationType: '',
				unsupportedMarkup: false,
			};
			return;
		}
		if (depth === 4 && currentMessage) {
			if (node.name === 'source') startCapture('source', depth);
			else if (node.name === 'comment') startCapture('comment', depth);
			else if (node.name === 'translation') {
				currentMessage.translationType = attribute(node, 'type');
				if (attribute(node, 'variants').toLowerCase() === 'yes') currentMessage.unsupportedMarkup = true;
				startCapture('translation', depth);
			}
			return;
		}
		if (currentMessage && (node.name === 'numerusform' || node.name === 'lengthvariant')) {
			if (node.name === 'numerusform') currentMessage.numerus = true;
			currentMessage.unsupportedMarkup = true;
		}
		if (capture && depth > capture.depth) currentMessage.unsupportedMarkup = true;
	});
	parser.on('text', appendCapturedText);
	parser.on('cdata', appendCapturedText);
	parser.on('closetag', (node) => {
		const depth = stack.length;
		if (capture && capture.depth === depth && capture.element === node.name) finishCapture();
		if (depth === 3 && node.name === 'message' && currentMessage) {
			if (currentMessage.context == null || currentMessage.source == null || currentMessage.translation == null) {
				fail('QT_TS_MESSAGE_SHAPE', `${fileName} contains a message without context, source, or translation.`);
			}
			messages.push(Object.freeze({ ...currentMessage, comment: currentMessage.comment || '' }));
			currentMessage = null;
		}
		if (depth === 2 && node.name === 'context' && currentContext) {
			if (!currentContext.name) fail('QT_TS_CONTEXT_NAME', `${fileName} contains an unnamed context.`);
			currentContext = null;
		}
		if (stack.pop() !== node.name) fail('QT_TS_NESTING', `${fileName} contains mismatched elements.`);
	});

	try {
		parser.write(xml).close();
	} catch (error) {
		if (error instanceof TranslationArtifactError) throw error;
		throw new TranslationArtifactError('QT_TS_XML', `${fileName} is not well-formed XML: ${error.message}`);
	}
	if (!root || root.version !== '2.1' || !root.language || !doctypeSeen) {
		fail('QT_TS_SCHEMA', `${fileName} must be a Qt TS 2.1 catalog with a language and standard doctype.`);
	}
	return Object.freeze({
		version: root.version,
		language: root.language,
		messages: Object.freeze(messages),
	});

	function startCapture(kind, depth) {
		if (capture) fail('QT_TS_TEXT_NESTING', `${fileName} contains nested translatable text elements.`);
		capture = { kind, depth, element: stack.at(-1), chunks: [] };
	}

	function appendCapturedText(text) {
		if (capture) capture.chunks.push(text);
	}

	function finishCapture() {
		const value = capture.chunks.join('');
		if (capture.kind === 'contextName') {
			if (currentContext.name != null) fail('QT_TS_CONTEXT_NAME', `${fileName} repeats a context name.`);
			currentContext.name = value;
		} else {
			if (currentMessage[capture.kind] != null) {
				fail('QT_TS_MESSAGE_SHAPE', `${fileName} repeats message ${capture.kind}.`);
			}
			currentMessage[capture.kind] = value;
		}
		capture = null;
	}
}

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
			if (transform === 'stripMnemonic') value = stripQtMnemonic(value);
			if (transform === 'stripEllipsis') value = stripEllipses(value);
		}
		// Imported UI values are always ellipsis-free, even when a translator
		// introduced punctuation not present in the mapped English source.
		value = stripEllipses(value).normalize('NFC');
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
	for (const [key, value] of Object.entries(englishCopy).sort(([left], [right]) => left.localeCompare(right))) {
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

export function readAudacityQtCatalogsFromZip(archiveBytes, options = {}) {
	const archive = inspectVerifiedZip(archiveBytes, options);
	const tsEntries = archive.entries.filter((entry) => entry.name.endsWith('.ts'));
	if (tsEntries.length === 0 || tsEntries.length > (options.maxCatalogs || MAX_QT_CATALOGS)) {
		fail('QT_CATALOG_COUNT', 'Audacity artifact has an invalid number of Qt TS catalogs.');
	}
	const catalogs = new Map();
	for (const entry of tsEntries) {
		const match = QT_CATALOG_NAME.exec(entry.name);
		if (!match || entry.name.includes('/')) fail('QT_CATALOG_NAME', `Unexpected Qt TS catalog path ${entry.name}.`);
		const fileLocale = normalizeQtLocale(match[1]);
		const locale = AUDACITY_TO_BCP47[match[1]] || fileLocale;
		if (catalogs.has(locale)) fail('QT_CATALOG_LOCALE_DUPLICATE', `Duplicate normalized Qt locale ${locale}.`);
		const catalog = parseQtTs(archive.readEntry(entry.name), { fileName: entry.name });
		const declaredLocale = normalizeQtLocale(catalog.language);
		if (baseLanguage(locale) !== baseLanguage(declaredLocale)) {
			fail('QT_CATALOG_LANGUAGE', `${entry.name} declares unrelated locale ${catalog.language}.`);
		}
		const fileTokenHasRegionOrScript = /[_-]/u.test(match[1]);
		if (fileTokenHasRegionOrScript && !match[1].includes('@') && fileLocale !== declaredLocale) {
			fail('QT_CATALOG_LANGUAGE', `${entry.name} declares mismatched locale ${catalog.language}.`);
		}
		catalogs.set(locale, Object.freeze({ ...catalog, archivePath: entry.name, locale }));
	}
	return Object.freeze({ archive, catalogs });
}

export function buildAudacityTranslationRelease(options) {
	const mapping = options?.mapping || AUDACITY_QT_MAPPING;
	validateAudacityQtMapping(mapping);
	const mappingSha256 = sha256(encodeCanonicalJson(mapping));
	const source = validateReleaseSource(options?.source);
	const archiveBytes = asBytes(options?.archiveBytes, 'SOURCE_ARCHIVE_TYPE');
	if (archiveBytes.byteLength !== source.expectedByteLength) fail('SOURCE_ARCHIVE_LENGTH', 'Audacity artifact byte length does not match verified metadata.');
	const archiveSha256 = sha256(archiveBytes);
	if (archiveSha256 !== source.expectedSha256) fail('SOURCE_ARCHIVE_SHA256', 'Audacity artifact SHA-256 does not match verified metadata.');
	const licenseBytes = asBytes(options?.licenseBytes, 'SOURCE_LICENSE_TYPE');
	if (licenseBytes.byteLength === 0 || licenseBytes.byteLength > MAX_LICENSE_BYTES) fail('SOURCE_LICENSE_SIZE', 'Audacity license has an invalid size.');
	const conversion = validateConversionMetadata(options?.conversion);
	const exposedLocales = new Set((options.exposedLocales || ['en', 'de']).map(normalizeQtLocale));
	const { archive, catalogs } = readAudacityQtCatalogsFromZip(archiveBytes, options.archiveOptions);
	validateMappingAgainstSourceCatalog(catalogs.get('en'), mapping);
	const conversionByLocale = new Map();
	for (const [locale, catalog] of catalogs) conversionByLocale.set(locale, convertQtCatalog(catalog, mapping, { locale }));
	for (const locale of ['en', 'de']) {
		if (!conversionByLocale.has(locale)) conversionByLocale.set(locale, emptyConversion(locale, mapping));
	}

	const files = new Map();
	const localeDescriptors = {};
	const localeAudit = {};
	for (const [locale, result] of [...conversionByLocale].sort(([left], [right]) => left.localeCompare(right))) {
		const pack = {
			schemaVersion: TRANSLATION_PACK_SCHEMA_VERSION,
			locale,
			messages: result.messages,
		};
		const packBytes = encodeCanonicalJson(pack);
		const packSha256 = sha256(packBytes);
		const packPath = `packs/${packSha256}.json`;
		files.set(packPath, packBytes);
		const eligible = locale === 'en' || locale === 'de' || result.audit.coverage >= AUDACITY_TRANSLATION_ELIGIBILITY;
		const localeMetadata = LOCALE_BY_TAG[locale];
		localeDescriptors[locale] = {
			name: localeMetadata?.nativeName || locale,
			direction: localeMetadata?.direction || localeDirection(locale),
			eligible,
			coverage: result.audit.coverage,
			mapped: result.audit.mapped,
			total: result.audit.total,
			path: packPath,
			sha256: packSha256,
			byteLength: packBytes.byteLength,
		};
		localeAudit[locale] = {
			...result.audit,
			eligible,
			retained: false,
		};
	}

	retainPreviousLocales({
		currentMappingVersion: AUDACITY_QT_MAPPING_VERSION,
		currentMappingSha256: mappingSha256,
		files,
		localeAudit,
		localeDescriptors,
		mappingKeys: new Set(mapping.map((entry) => entry.key)),
		mappingTotal: mapping.length,
		previousRelease: options.previousRelease,
	});
	const locales = sortRecord(localeDescriptors);
	const referencedPacks = new Set(Object.values(locales).map((descriptor) => descriptor.path));
	for (const filePath of files.keys()) {
		if (filePath.startsWith('packs/') && !referencedPacks.has(filePath)) files.delete(filePath);
	}
	const eligibleLocales = Object.keys(locales).filter((locale) => locales[locale].eligible);
	const pendingLocales = eligibleLocales.filter((locale) => !exposedLocales.has(locale));
	const retainedLocales = eligibleLocales.filter((locale) => locales[locale].retained === true);
	const normalizedContentSha256 = sha256(encodeCanonicalJson({
		mappingVersion: AUDACITY_QT_MAPPING_VERSION,
		mappingSha256,
		locales: Object.fromEntries(Object.entries(locales).map(([locale, descriptor]) => [
			locale,
			normalizedPointerLocale(descriptor),
		])),
		pendingLocales,
	}));
	const releasePrefix = `releases/${source.artifactId}`;
	const sourceArchivePath = `${releasePrefix}/source/${source.archiveName}`;
	const sourceLicensePath = `${releasePrefix}/source/LICENSE.txt`;
	const auditPath = `${releasePrefix}/audit.json`;
	files.set(sourceArchivePath, archiveBytes);
	files.set(sourceLicensePath, licenseBytes);
	const audit = {
		schemaVersion: TRANSLATION_RELEASE_SCHEMA_VERSION,
		mapping: {
			version: AUDACITY_QT_MAPPING_VERSION,
			sha256: mappingSha256,
			total: mapping.length,
		},
		archive: {
			sha256: archiveSha256,
			byteLength: archiveBytes.byteLength,
			entryCount: archive.entries.length,
			catalogCount: catalogs.size,
		},
		eligibilityThreshold: AUDACITY_TRANSLATION_ELIGIBILITY,
		mappingCandidates: catalogs.has('en')
			? auditQtMappingCandidates(ENGLISH_COPY, catalogs.get('en'), mapping)
			: { ambiguous: [], skipped: [], sourceCatalogMissing: true },
		locales: sortRecord(localeAudit),
		eligibleLocales,
		pendingLocales,
		retainedLocales,
	};
	const auditBytes = encodeCanonicalJson(audit);
	files.set(auditPath, auditBytes);
	const manifest = {
		schemaVersion: TRANSLATION_RELEASE_SCHEMA_VERSION,
		artifactId: source.artifactId,
		provenance: {
			licenseSpdx: 'GPL-3.0-only',
			upstreamProjectUrl: 'https://github.com/audacity/audacity',
			upstreamLicenseUrl: `https://github.com/audacity/audacity/blob/${source.headSha}/LICENSE.txt`,
			soundscaperProjectUrl: 'https://github.com/LeoWattenberg/Soundscaper',
			modificationNotice: AUDACITY_TRANSLATION_MODIFICATION_NOTICE,
		},
		source: {
			repository: source.repository,
			workflowUrl: source.workflowUrl,
			runId: source.runId,
			headSha: source.headSha,
			archive: fileDescriptor(sourceArchivePath, archiveBytes),
			license: fileDescriptor(sourceLicensePath, licenseBytes),
		},
		conversion: {
			mappingVersion: AUDACITY_QT_MAPPING_VERSION,
			mappingSha256,
			toolRevision: conversion.toolRevision,
			convertedAt: conversion.convertedAt,
		},
		audit: fileDescriptor(auditPath, auditBytes),
		eligibilityThreshold: AUDACITY_TRANSLATION_ELIGIBILITY,
		locales,
		eligibleLocales,
		pendingLocales,
		retainedLocales,
		normalizedContentSha256,
	};
	const manifestPath = `${releasePrefix}/manifest.json`;
	files.set(manifestPath, encodeCanonicalJson(manifest));
	return Object.freeze({
		files,
		manifest: deepFreeze(manifest),
		audit: deepFreeze(audit),
		manifestPath,
	});
}

export async function prepareAudacityTranslationRelease(options) {
	const outputDirectory = path.resolve(options.outputDirectory);
	await ensureEmptyOutputDirectory(outputDirectory);
	const release = buildAudacityTranslationRelease(options);
	for (const [relativePath, bytes] of [...release.files].sort(([left], [right]) => left.localeCompare(right))) {
		const destination = safeOutputPath(outputDirectory, relativePath);
		await mkdir(path.dirname(destination), { recursive: true });
		await writeFile(destination, bytes, { flag: 'wx' });
	}
	return release;
}

export function normalizeQtLocale(input) {
	if (typeof input !== 'string' || !input || !/^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*(?:@[A-Za-z0-9]+)?$/u.test(input)) {
		fail('QT_LOCALE', `Invalid Qt locale ${JSON.stringify(input)}.`);
	}
	const [base, rawModifier] = input.split('@');
	let parts = base.replaceAll('_', '-').split('-');
	if (rawModifier) {
		const modifier = rawModifier.toLowerCase();
		if (modifier === 'latin') parts.splice(1, 0, 'Latn');
		else if (/^[a-z0-9]{5,8}$/u.test(modifier)) parts.push(modifier);
		else fail('QT_LOCALE_MODIFIER', `Qt locale modifier ${rawModifier} is not BCP-47 compatible.`);
	}
	try {
		return new Intl.Locale(parts.join('-')).toString();
	} catch {
		fail('QT_LOCALE', `Qt locale ${input} cannot be normalized to BCP-47.`);
	}
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

export function encodeCanonicalJson(value) {
	return Buffer.from(`${JSON.stringify(sortJsonValue(value))}\n`, 'utf8');
}

async function runCli(argv) {
	const [command, ...rest] = argv;
	if (command !== 'prepare') throw usageError();
	const flags = parseFlags(rest);
	const required = [
		'archive',
		'output',
		'artifact-id',
		'source-run-id',
		'source-head-sha',
		'source-workflow-url',
		'source-sha256',
		'source-byte-length',
		'source-license',
		'tool-revision',
		'converted-at',
	];
	for (const flag of required) if (!flags[flag]) throw usageError(`Missing --${flag}.`);
	const archivePath = path.resolve(flags.archive);
	const licensePath = path.resolve(flags['source-license']);
	const previousRelease = flags['previous-root'] ? await loadPreviousRelease(path.resolve(flags['previous-root'])) : undefined;
	const release = await prepareAudacityTranslationRelease({
		archiveBytes: await readFile(archivePath),
		licenseBytes: await readFile(licensePath),
		outputDirectory: flags.output,
		exposedLocales: flags['exposed-locales'] ? flags['exposed-locales'].split(',').filter(Boolean) : ['en', 'de'],
		previousRelease,
		source: {
			artifactId: Number(flags['artifact-id']),
			archiveName: path.basename(archivePath),
			expectedSha256: flags['source-sha256'],
			expectedByteLength: Number(flags['source-byte-length']),
			repository: 'audacity/audacity',
			runId: Number(flags['source-run-id']),
			headSha: flags['source-head-sha'],
			workflowUrl: flags['source-workflow-url'],
		},
		conversion: {
			toolRevision: flags['tool-revision'],
			convertedAt: flags['converted-at'],
		},
	});
	process.stdout.write(encodeCanonicalJson({
		manifestPath: release.manifestPath,
		normalizedContentSha256: release.manifest.normalizedContentSha256,
		eligibleLocales: release.manifest.eligibleLocales,
		pendingLocales: release.manifest.pendingLocales,
		retainedLocales: release.manifest.retainedLocales,
	}));
}

async function loadPreviousRelease(root) {
	const latestPath = path.join(root, 'latest.json');
	const latest = JSON.parse(await readFile(latestPath, 'utf8'));
	if (latest?.schemaVersion !== TRANSLATION_RELEASE_SCHEMA_VERSION || !latest.locales || typeof latest.locales !== 'object') {
		fail('PREVIOUS_RELEASE_SCHEMA', 'Previous latest.json has an unsupported schema.');
	}
	const packs = new Map();
	for (const descriptor of Object.values(latest.locales)) {
		if (!descriptor?.eligible) continue;
		validatePackPath(descriptor.path, descriptor.sha256);
		packs.set(descriptor.path, await readFile(safeOutputPath(root, descriptor.path)));
	}
	return { latest, packs };
}

function retainPreviousLocales({ currentMappingVersion, currentMappingSha256, files, localeAudit, localeDescriptors, mappingKeys, mappingTotal, previousRelease }) {
	if (!previousRelease) return;
	if (
		previousRelease.latest?.mappingVersion !== currentMappingVersion
		|| previousRelease.latest?.mappingSha256 !== currentMappingSha256
	) return;
	const previousLocales = previousRelease.latest?.locales;
	if (!previousLocales || typeof previousLocales !== 'object' || !(previousRelease.packs instanceof Map)) {
		fail('PREVIOUS_RELEASE_SHAPE', 'Previous release must provide latest metadata and referenced pack bytes.');
	}
	for (const [rawLocale, previous] of Object.entries(previousLocales).sort(([left], [right]) => left.localeCompare(right))) {
		if (!previous?.eligible) continue;
		const locale = normalizeQtLocale(rawLocale);
		const current = localeDescriptors[locale];
		const currentCoverage = current?.coverage ?? 0;
		const previousCoverage = Number(previous.coverage);
		if (!Number.isFinite(previousCoverage) || previousCoverage < 0 || previousCoverage > 1) {
			fail('PREVIOUS_RELEASE_COVERAGE', `Previous locale ${locale} has invalid coverage.`);
		}
		validatePackPath(previous.path, previous.sha256);
		const bytes = asBytes(previousRelease.packs.get(previous.path), 'PREVIOUS_PACK_MISSING');
		if (bytes.byteLength !== previous.byteLength || sha256(bytes) !== previous.sha256) {
			fail('PREVIOUS_PACK_DIGEST', `Previous locale pack ${locale} failed digest verification.`);
		}
		let pack;
		try {
			pack = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
		} catch {
			fail('PREVIOUS_PACK_JSON', `Previous locale pack ${locale} is invalid JSON.`);
		}
		if (pack?.schemaVersion !== TRANSLATION_PACK_SCHEMA_VERSION || normalizeQtLocale(pack.locale) !== locale || !isFlatStringRecord(pack.messages)) {
			fail('PREVIOUS_PACK_SCHEMA', `Previous locale pack ${locale} has an invalid schema.`);
		}
		if (Object.values(pack.messages).some((value) => ELLIPSIS_PATTERN.test(value))) {
			fail('PREVIOUS_PACK_ELLIPSIS', `Previous locale pack ${locale} contains ellipsis punctuation.`);
		}
		const retainedKeys = Object.keys(pack.messages);
		if (retainedKeys.some((key) => !mappingKeys.has(key))) continue;
		const retainedMapped = retainedKeys.length;
		const retainedCoverage = retainedMapped / mappingTotal;
		if (retainedCoverage < AUDACITY_TRANSLATION_ELIGIBILITY || currentCoverage >= retainedCoverage) continue;
		files.set(previous.path, Buffer.from(bytes));
		localeDescriptors[locale] = {
			name: typeof previous.name === 'string' ? previous.name : locale,
			direction: previous.direction === 'rtl' ? 'rtl' : 'ltr',
			eligible: true,
			coverage: retainedCoverage,
			mapped: retainedMapped,
			total: mappingTotal,
			path: previous.path,
			sha256: previous.sha256,
			byteLength: previous.byteLength,
			retained: true,
		};
		localeAudit[locale] = {
			...(localeAudit[locale] || { mapped: 0, total: mappingTotal, coverage: 0, skipped: [] }),
			eligible: true,
			retained: true,
			retainedCoverage,
		};
	}
}

function emptyConversion(locale, mapping) {
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

function excludedMessageReason(message) {
	if (message.numerus) return 'numerus';
	if (message.unsupportedMarkup) return 'unsupported-markup';
	const type = String(message.translationType || '').toLowerCase();
	if (type === 'unfinished' || type === 'vanished' || type === 'obsolete' || type === 'fuzzy') return type;
	if (type && type !== 'finished') return 'inactive';
	if (!message.translation || !message.translation.trim()) return 'empty';
	return null;
}

function validatePlaceholderAdapter(entry) {
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

function samePlaceholderMultiset(source, translation) {
	const left = extractPlaceholders(source).sort();
	const right = extractPlaceholders(translation).sort();
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function applyPlaceholderAdapter(value, adapter) {
	return String(value).replace(/%%|%L?\d+|%(?:\d+\$)?[-+ #0']*(?:\d+|\*)?(?:\.(?:\d+|\*))?(?:hh|h|ll|l|j|z|t|L)?[diuoxXfFeEgGaAcsp]/gu, (token) => {
		if (token === '%%') return token;
		return adapter[token] || token;
	});
}

function stripQtMnemonic(value) {
	const literalAmpersand = '\u0000SOUNDSCAPER_AMPERSAND\u0000';
	return String(value)
		.replace(/\(&[A-Za-z0-9]\)/gu, '')
		.replaceAll('&&', literalAmpersand)
		.replace(/&(?=.)/gu, '')
		.replaceAll(literalAmpersand, '&');
}

function validateReleaseSource(source) {
	if (!source || typeof source !== 'object') fail('SOURCE_METADATA', 'Verified Audacity source metadata is required.');
	if (!Number.isSafeInteger(source.artifactId) || source.artifactId <= 0) fail('SOURCE_ARTIFACT_ID', 'Audacity artifact ID is invalid.');
	if (!/^Audacity_locale_[A-Za-z0-9._-]+\.zip$/u.test(source.archiveName || '')) fail('SOURCE_ARCHIVE_NAME', 'Audacity artifact archive name is unexpected.');
	if (!/^[a-f0-9]{64}$/u.test(source.expectedSha256 || '')) fail('SOURCE_ARCHIVE_SHA256', 'Audacity artifact SHA-256 metadata is invalid.');
	if (!Number.isSafeInteger(source.expectedByteLength) || source.expectedByteLength <= 0) fail('SOURCE_ARCHIVE_LENGTH', 'Audacity artifact byte-length metadata is invalid.');
	if (source.repository !== 'audacity/audacity') fail('SOURCE_REPOSITORY', 'Translation source must be audacity/audacity.');
	if (!Number.isSafeInteger(source.runId) || source.runId <= 0) fail('SOURCE_RUN_ID', 'Audacity workflow run ID is invalid.');
	if (!/^[a-f0-9]{40}$/u.test(source.headSha || '')) fail('SOURCE_HEAD_SHA', 'Audacity source commit is invalid.');
	let workflowUrl;
	try {
		workflowUrl = new URL(source.workflowUrl);
	} catch {
		fail('SOURCE_WORKFLOW_URL', 'Audacity workflow URL is invalid.');
	}
	if (workflowUrl.protocol !== 'https:' || workflowUrl.hostname !== 'github.com') fail('SOURCE_WORKFLOW_URL', 'Audacity workflow URL must be on https://github.com/.');
	return { ...source };
}

function validateConversionMetadata(conversion) {
	if (!conversion || !/^[a-f0-9]{40}$/u.test(conversion.toolRevision || '')) fail('CONVERSION_REVISION', 'Conversion tool revision must be a Git commit SHA.');
	const date = new Date(conversion.convertedAt);
	if (!conversion.convertedAt || Number.isNaN(date.getTime()) || date.toISOString() !== conversion.convertedAt) {
		fail('CONVERSION_DATE', 'Conversion date must be a canonical ISO-8601 timestamp.');
	}
	return conversion;
}

function validatePackPath(packPath, expectedSha256) {
	if (!/^[a-f0-9]{64}$/u.test(expectedSha256 || '') || packPath !== `packs/${expectedSha256}.json`) {
		fail('PREVIOUS_PACK_PATH', 'Previous locale pack path is not content-addressed.');
	}
}

function parseFlags(args) {
	const flags = {};
	for (let index = 0; index < args.length; index += 2) {
		const flag = args[index];
		const value = args[index + 1];
		if (!flag?.startsWith('--') || value == null || value.startsWith('--')) throw usageError(`Invalid argument ${flag || ''}.`);
		const name = flag.slice(2);
		if (flags[name] != null) throw usageError(`Duplicate --${name}.`);
		flags[name] = value;
	}
	return flags;
}

function usageError(detail = '') {
	return new TranslationArtifactError(
		'CLI_USAGE',
		`${detail ? `${detail}\n` : ''}Usage: node scripts/audacity-qt-translations.mjs prepare --archive <zip> --output <dir> --artifact-id <id> --source-run-id <id> --source-head-sha <sha> --source-workflow-url <url> --source-sha256 <sha> --source-byte-length <bytes> --source-license <file> --tool-revision <sha> --converted-at <ISO timestamp> [--previous-root <dir>] [--exposed-locales en,de]`,
	);
}

async function ensureEmptyOutputDirectory(directory) {
	try {
		const metadata = await stat(directory);
		if (!metadata.isDirectory()) fail('OUTPUT_DIRECTORY', 'Translation output path is not a directory.');
		if ((await readdir(directory)).length !== 0) fail('OUTPUT_NOT_EMPTY', 'Translation output directory must be empty.');
	} catch (error) {
		if (error?.code !== 'ENOENT') throw error;
		await mkdir(directory, { recursive: true });
	}
}

function safeOutputPath(root, relativePath) {
	if (typeof relativePath !== 'string' || path.isAbsolute(relativePath) || relativePath.includes('\\')) fail('OUTPUT_PATH', 'Unsafe translation output path.');
	const resolved = path.resolve(root, relativePath);
	const prefix = `${path.resolve(root)}${path.sep}`;
	if (!resolved.startsWith(prefix)) fail('OUTPUT_PATH', 'Translation output path escapes its root.');
	return resolved;
}

function fileDescriptor(filePath, bytes) {
	return { path: filePath, sha256: sha256(bytes), byteLength: bytes.byteLength };
}

function normalizedPointerLocale(descriptor) {
	return {
		name: descriptor.name,
		direction: descriptor.direction,
		eligible: descriptor.eligible,
		coverage: descriptor.coverage,
		mapped: descriptor.mapped,
		total: descriptor.total,
		path: descriptor.path,
		sha256: descriptor.sha256,
		byteLength: descriptor.byteLength,
	};
}

function localeDirection(locale) {
	return RTL_LANGUAGES.has(baseLanguage(locale)) ? 'rtl' : 'ltr';
}

function baseLanguage(locale) {
	return new Intl.Locale(locale).language;
}

function qtIdentity(context, source, comment) {
	return JSON.stringify([context, source, comment]);
}

function compareAuditEntry(left, right) {
	return left.key.localeCompare(right.key) || left.reason.localeCompare(right.reason);
}

function compareCandidateIdentity(left, right) {
	return left.context.localeCompare(right.context)
		|| left.source.localeCompare(right.source)
		|| left.comment.localeCompare(right.comment);
}

function normalizedCandidateText(value) {
	return stripEllipses(stripQtMnemonic(value)).normalize('NFC');
}

function attribute(node, name) {
	const value = node.attributes?.[name];
	return typeof value === 'string' ? value : '';
}

function decodeUtf8(input, fileName) {
	if (typeof input === 'string') return input;
	const bytes = asBytes(input, 'QT_TS_INPUT');
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		fail('QT_TS_ENCODING', `${fileName} is not valid UTF-8.`);
	}
}

function asBytes(input, code) {
	if (Buffer.isBuffer(input)) return input;
	if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
	if (input instanceof ArrayBuffer) return Buffer.from(input);
	fail(code, 'Expected byte input.');
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function sortRecord(record) {
	return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

function sortJsonValue(value) {
	if (Array.isArray(value)) return value.map(sortJsonValue);
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, child]) => [key, sortJsonValue(child)]));
	}
	if (typeof value === 'number' && !Number.isFinite(value)) fail('JSON_NUMBER', 'Canonical JSON cannot contain non-finite numbers.');
	return value;
}

function isFlatStringRecord(value) {
	return value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every((item) => typeof item === 'string');
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}

function fail(code, message) {
	throw new TranslationArtifactError(code, message);
}

function isMainModule() {
	if (!process.argv[1]) return false;
	return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
	runCli(process.argv.slice(2)).catch((error) => {
		const code = error?.code || 'TRANSLATION_PREPARE_FAILED';
		process.stderr.write(`${code}: ${error?.message || error}\n`);
		process.exitCode = 1;
	});
}
