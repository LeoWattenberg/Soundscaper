/* SPDX-License-Identifier: AGPL-3.0-only */

// Assembling a publishable translation release from one Audacity artifact. Each
// locale becomes a pack only if enough reviewed messages converted; locales that
// no longer qualify keep the pack the previous release published, so a release
// never regresses a locale that was already live. Every file is written with its
// digest and byte length, and the pointer describes the set as a whole. Split
// out of audacity-qt-translations.mjs; no behaviour changes here.

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
	AUDACITY_QT_MAPPING,
	AUDACITY_QT_MAPPING_VERSION,
} from '../../src/common/i18n/audacity-qt-mapping.js';
import { ENGLISH_COPY } from '../../src/common/i18n/catalogs.js';
import { compareCodeUnits } from './canonical-json.mjs';
import { LOCALE_BY_TAG } from '../../src/common/i18n/locales.js';
import {
	asBytes,
	baseLanguage,
	normalizeQtLocale,
	readAudacityQtCatalogsFromZip,
} from './audacity-qt-catalog.mjs';
import {
	AUDACITY_TRANSLATION_ELIGIBILITY,
	ELLIPSIS_PATTERN,
	auditQtMappingCandidates,
	convertQtCatalog,
	emptyConversion,
	validateAudacityQtMapping,
	validateMappingAgainstSourceCatalog,
} from './audacity-qt-conversion.mjs';
import {
	deepFreeze,
	encodeCanonicalJson,
	fail,
	isFlatStringRecord,
	sha256,
	sortRecord,
} from './audacity-qt-values.mjs';

export const TRANSLATION_PACK_SCHEMA_VERSION = 1;
export const TRANSLATION_RELEASE_SCHEMA_VERSION = 1;
export const AUDACITY_TRANSLATION_MODIFICATION_NOTICE = 'Soundscaper converts reviewed Audacity Qt TS messages to per-locale JSON packs, excludes unsafe or inapplicable entries, adapts reviewed placeholders and mnemonics, and removes ellipsis punctuation.';
const MAX_LICENSE_BYTES = 2 * 1024 * 1024;
const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ps', 'ur']);

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
	for (const [locale, result] of [...conversionByLocale].sort(([left], [right]) => compareCodeUnits(left, right))) {
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
	for (const [relativePath, bytes] of [...release.files].sort(([left], [right]) => compareCodeUnits(left, right))) {
		const destination = safeOutputPath(outputDirectory, relativePath);
		await mkdir(path.dirname(destination), { recursive: true });
		await writeFile(destination, bytes, { flag: 'wx' });
	}
	return release;
}


export async function loadPreviousRelease(root) {
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

export function retainPreviousLocales({ currentMappingVersion, currentMappingSha256, files, localeAudit, localeDescriptors, mappingKeys, mappingTotal, previousRelease }) {
	if (!previousRelease) return;
	if (
		previousRelease.latest?.mappingVersion !== currentMappingVersion
		|| previousRelease.latest?.mappingSha256 !== currentMappingSha256
	) return;
	const previousLocales = previousRelease.latest?.locales;
	if (!previousLocales || typeof previousLocales !== 'object' || !(previousRelease.packs instanceof Map)) {
		fail('PREVIOUS_RELEASE_SHAPE', 'Previous release must provide latest metadata and referenced pack bytes.');
	}
	for (const [rawLocale, previous] of Object.entries(previousLocales).sort(([left], [right]) => compareCodeUnits(left, right))) {
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


export function validateReleaseSource(source) {
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

export function validateConversionMetadata(conversion) {
	if (!conversion || !/^[a-f0-9]{40}$/u.test(conversion.toolRevision || '')) fail('CONVERSION_REVISION', 'Conversion tool revision must be a Git commit SHA.');
	const date = new Date(conversion.convertedAt);
	if (!conversion.convertedAt || Number.isNaN(date.getTime()) || date.toISOString() !== conversion.convertedAt) {
		fail('CONVERSION_DATE', 'Conversion date must be a canonical ISO-8601 timestamp.');
	}
	return conversion;
}

export function validatePackPath(packPath, expectedSha256) {
	if (!/^[a-f0-9]{64}$/u.test(expectedSha256 || '') || packPath !== `packs/${expectedSha256}.json`) {
		fail('PREVIOUS_PACK_PATH', 'Previous locale pack path is not content-addressed.');
	}
}


export async function ensureEmptyOutputDirectory(directory) {
	try {
		const metadata = await stat(directory);
		if (!metadata.isDirectory()) fail('OUTPUT_DIRECTORY', 'Translation output path is not a directory.');
		if ((await readdir(directory)).length !== 0) fail('OUTPUT_NOT_EMPTY', 'Translation output directory must be empty.');
	} catch (error) {
		if (error?.code !== 'ENOENT') throw error;
		await mkdir(directory, { recursive: true });
	}
}

export function safeOutputPath(root, relativePath) {
	if (typeof relativePath !== 'string' || path.isAbsolute(relativePath) || relativePath.includes('\\')) fail('OUTPUT_PATH', 'Unsafe translation output path.');
	const resolved = path.resolve(root, relativePath);
	const prefix = `${path.resolve(root)}${path.sep}`;
	if (!resolved.startsWith(prefix)) fail('OUTPUT_PATH', 'Translation output path escapes its root.');
	return resolved;
}

export function fileDescriptor(filePath, bytes) {
	return { path: filePath, sha256: sha256(bytes), byteLength: bytes.byteLength };
}

export function normalizedPointerLocale(descriptor) {
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

export function localeDirection(locale) {
	return RTL_LANGUAGES.has(baseLanguage(locale)) ? 'rtl' : 'ltr';
}

