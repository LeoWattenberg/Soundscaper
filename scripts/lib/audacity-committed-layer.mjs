/* SPDX-License-Identifier: AGPL-3.0-only */

// Merging Audacity's reviewed strings into the translation catalogs. One
// upstream artifact is verified and converted, and for every locale its
// reviewed strings become `audacity` entries of that locale's catalog under
// src/common/i18n/translations/, replacing machine entries and older
// Audacity entries but never a human one; Audacity entries the artifact no
// longer carries are removed. The notice and licence beside the catalogs
// name the exact source. The result is deterministic for a given artifact,
// mapping and English copy, so the weekly sync commits only real changes.

import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

import { AUDACITY_QT_MAPPING, AUDACITY_QT_MAPPING_VERSION } from '../../src/common/i18n/audacity-qt-mapping.js';
import { ENGLISH_COPY } from '../../src/common/i18n/catalogs.js';
import { LOCALE_BY_TAG } from '../../src/common/i18n/locales.js';
import { asBytes, readAudacityQtCatalogsFromZip } from './audacity-qt-catalog.mjs';
import {
	convertQtCatalog,
	validateAudacityQtMapping,
	validateMappingAgainstSourceCatalog,
} from './audacity-qt-conversion.mjs';
import { encodeCanonicalJson, fail, sha256 } from './audacity-qt-values.mjs';
import { compareCodeUnits } from './canonical-json.mjs';
import {
	TRANSLATION_CATALOG_DIRECTORY,
	listTranslationCatalogLocales,
	readTranslationCatalog,
	writeTranslationCatalog,
	writeTranslationCatalogIndex,
} from '../i18n-ai/catalog.mjs';

export const AUDACITY_LAYER_NOTICE_FILE = 'NOTICE.md';
export const AUDACITY_LAYER_LICENSE_FILE = 'LICENSE.txt';
export const AUDACITY_TRANSLATION_MODIFICATION_NOTICE = 'Soundscaper converts reviewed Audacity Qt TS messages to per-locale JSON catalogs, excludes unsafe or inapplicable entries, adapts reviewed placeholders and mnemonics, and removes ellipsis punctuation.';
const MAX_LICENSE_BYTES = 2 * 1024 * 1024;

/** Verify the upstream artifact and convert every locale that carries a reviewed string. */
export function buildAudacityLayer(options) {
	const mapping = options?.mapping || AUDACITY_QT_MAPPING;
	validateAudacityQtMapping(mapping);
	const mappingSha256 = sha256(encodeCanonicalJson(mapping));
	const source = validateLayerSource(options?.source);
	const archiveBytes = asBytes(options?.archiveBytes, 'SOURCE_ARCHIVE_TYPE');
	if (archiveBytes.byteLength !== source.expectedByteLength) fail('SOURCE_ARCHIVE_LENGTH', 'Audacity artifact byte length does not match verified metadata.');
	const archiveSha256 = sha256(archiveBytes);
	if (archiveSha256 !== source.expectedSha256) fail('SOURCE_ARCHIVE_SHA256', 'Audacity artifact SHA-256 does not match verified metadata.');
	const licenseBytes = asBytes(options?.licenseBytes, 'SOURCE_LICENSE_TYPE');
	if (licenseBytes.byteLength === 0 || licenseBytes.byteLength > MAX_LICENSE_BYTES) fail('SOURCE_LICENSE_SIZE', 'Audacity license has an invalid size.');
	const { catalogs } = readAudacityQtCatalogsFromZip(archiveBytes, options?.archiveOptions);
	validateMappingAgainstSourceCatalog(catalogs.get('en'), mapping);
	const provenance = Object.freeze({
		repository: source.repository,
		headSha: source.headSha,
		runId: source.runId,
		artifactId: source.artifactId,
		workflowUrl: source.workflowUrl,
		archiveName: source.archiveName,
		archiveSha256,
		archiveByteLength: archiveBytes.byteLength,
		licenseSpdx: 'GPL-3.0-only',
		upstreamProjectUrl: 'https://github.com/audacity/audacity',
		upstreamLicenseUrl: `https://github.com/audacity/audacity/blob/${source.headSha}/LICENSE.txt`,
		modificationNotice: AUDACITY_TRANSLATION_MODIFICATION_NOTICE,
		mappingVersion: AUDACITY_QT_MAPPING_VERSION,
		mappingSha256,
	});
	const messagesByLocale = new Map();
	const audit = {};
	const unknownLocales = [];
	for (const [locale, catalog] of [...catalogs].sort(([left], [right]) => compareCodeUnits(left, right))) {
		if (locale === 'en') continue;
		// Only a locale Soundscaper can describe (name, direction) can be served.
		if (!LOCALE_BY_TAG[locale]) {
			unknownLocales.push(locale);
			continue;
		}
		const result = convertQtCatalog(catalog, mapping, { locale });
		audit[locale] = { mapped: result.audit.mapped, total: result.audit.total, skipped: result.audit.skipped };
		// A reviewed string keeps its wording; only the whitespace around it goes.
		const messages = Object.fromEntries(Object.entries(result.messages)
			.map(([key, value]) => [key, value.trim()])
			.filter(([, value]) => value.length > 0));
		if (Object.keys(messages).length) messagesByLocale.set(locale, Object.freeze(messages));
	}
	return Object.freeze({ messagesByLocale, provenance, audit: Object.freeze(audit), unknownLocales: Object.freeze(unknownLocales), licenseBytes });
}

export function validateLayerSource(source) {
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

/**
 * Merge the converted strings into the catalogs: an `audacity` entry for
 * every reviewed string whose key the English copy still has, written over
 * machine and older Audacity entries but never over a human one; Audacity
 * entries the artifact no longer carries are dropped. Returns what changed.
 */
export function mergeAudacityMessages(catalog, locale, messages, provenance, englishCopy = ENGLISH_COPY) {
	const entries = { ...(catalog?.entries ?? {}) };
	const summary = { locale, written: 0, kept: 0, removed: 0, humanKept: 0 };
	for (const [key, entry] of Object.entries(entries)) {
		if (entry[0] === 'audacity' && !Object.hasOwn(messages, key)) {
			delete entries[key];
			summary.removed += 1;
		}
	}
	for (const [key, translation] of Object.entries(messages).sort(([left], [right]) => compareCodeUnits(left, right))) {
		if (!Object.hasOwn(englishCopy, key)) continue;
		const existing = entries[key];
		if (existing?.[0] === 'human') {
			summary.humanKept += 1;
			continue;
		}
		const next = ['audacity', englishCopy[key], translation];
		if (existing && existing[0] === next[0] && existing[1] === next[1] && existing[2] === next[2]) summary.kept += 1;
		else summary.written += 1;
		entries[key] = next;
	}
	return {
		catalog: { locale, provenance: { ...(catalog?.provenance ?? {}), audacity: provenance }, entries },
		summary,
	};
}

/** Write the layer into the catalogs, the index, the notice and the licence. */
export async function writeAudacityLayer(layer, directory = TRANSLATION_CATALOG_DIRECTORY, { englishCopy = ENGLISH_COPY } = {}) {
	const summaries = [];
	const touched = new Set(layer.messagesByLocale.keys());
	// Locales the artifact no longer covers lose their Audacity entries too.
	for (const locale of await listTranslationCatalogLocales(directory)) {
		if (!touched.has(locale)) {
			const catalog = await readTranslationCatalog(locale, directory);
			if (catalog && Object.values(catalog.entries).some(([origin]) => origin === 'audacity')) touched.add(locale);
		}
	}
	for (const locale of [...touched].sort(compareCodeUnits)) {
		const catalog = await readTranslationCatalog(locale, directory);
		const { catalog: merged, summary } = mergeAudacityMessages(catalog, locale, layer.messagesByLocale.get(locale) ?? {}, layer.provenance, englishCopy);
		await writeTranslationCatalog(merged, directory);
		summaries.push(summary);
	}
	const locales = await writeTranslationCatalogIndex(directory);
	await writeAtomically(join(directory, AUDACITY_LAYER_NOTICE_FILE), renderAudacityLayerNotice(layer.provenance, [...layer.messagesByLocale.keys()].sort(compareCodeUnits)));
	await writeAtomically(join(directory, AUDACITY_LAYER_LICENSE_FILE), Buffer.from(layer.licenseBytes));
	return { locales, summaries };
}

export function renderAudacityLayerNotice(provenance, locales) {
	return `# Audacity translations

The \`audacity\` entries of the JSON catalogs in this directory carry translations from the Audacity project, converted from the Qt TS catalogs Audacity publishes for its translators' reviewed work. They are used under the GNU General Public License version 3 (\`${provenance.licenseSpdx}\`), whose text is in \`LICENSE.txt\` beside this file, and combined with this AGPL-3.0-only application under section 13 of both licences. The Audacity-derived strings remain governed by the GPLv3; the \`machine\` and \`human\` entries beside them are this project's own.

- upstream project: <${provenance.upstreamProjectUrl}>
- upstream licence and notices: <${provenance.upstreamLicenseUrl}>
- source commit: \`${provenance.headSha}\`
- translation artifact: \`${provenance.archiveName}\` (artifact ${provenance.artifactId} of workflow run ${provenance.runId}, <${provenance.workflowUrl}>), SHA-256 \`${provenance.archiveSha256}\`, ${provenance.archiveByteLength} bytes
- reviewed key mapping: version ${provenance.mappingVersion}, SHA-256 \`${provenance.mappingSha256}\` (\`src/common/i18n/audacity-qt-mapping.js\`)

Modification notice: ${provenance.modificationNotice}

Locales with Audacity entries: ${locales.join(', ')}.

Written by \`scripts/audacity-qt-translations.mjs\`; do not edit the \`audacity\` entries by hand. The complete record of third-party material is in \`THIRD_PARTY_LICENSES.md\` at the repository root.
`;
}

async function writeAtomically(path, content) {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	await writeFile(temporary, content, { flag: 'wx' });
	try {
		await rename(temporary, path);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}
