/* SPDX-License-Identifier: AGPL-3.0-only */

// The committed Audacity translation layer: Audacity's reviewed Qt TS messages
// for the reviewed catalog keys, converted once per upstream artifact into one
// JSON catalog per locale under src/common/i18n/audacity/, beside a generated
// loader index, the upstream licence and a notice naming the exact source. The
// runtime lazy-imports a locale's catalog the way it imports the machine
// catalogs and lays it over them, so every reviewed string is shown wherever
// Audacity has one. The files are deterministic for a given artifact and
// mapping, so the weekly sync can regenerate them and commit only real changes.

import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AUDACITY_QT_MAPPING, AUDACITY_QT_MAPPING_VERSION } from '../../src/common/i18n/audacity-qt-mapping.js';
import { LOCALE_BY_TAG } from '../../src/common/i18n/locales.js';
import { asBytes, readAudacityQtCatalogsFromZip } from './audacity-qt-catalog.mjs';
import {
	convertQtCatalog,
	validateAudacityQtMapping,
	validateMappingAgainstSourceCatalog,
} from './audacity-qt-conversion.mjs';
import { encodeCanonicalJson, fail, sha256 } from './audacity-qt-values.mjs';
import { compareCodeUnits } from './canonical-json.mjs';

export const AUDACITY_LAYER_SCHEMA_VERSION = 1;
export const AUDACITY_LAYER_DIRECTORY = fileURLToPath(new URL('../../src/common/i18n/audacity/', import.meta.url));
export const AUDACITY_LAYER_INDEX_FILE = 'index.js';
export const AUDACITY_LAYER_NOTICE_FILE = 'NOTICE.md';
export const AUDACITY_LAYER_LICENSE_FILE = 'LICENSE.txt';
export const AUDACITY_TRANSLATION_MODIFICATION_NOTICE = 'Soundscaper converts reviewed Audacity Qt TS messages to per-locale JSON catalogs, excludes unsafe or inapplicable entries, adapts reviewed placeholders and mnemonics, and removes ellipsis punctuation.';
const MAX_LICENSE_BYTES = 2 * 1024 * 1024;
const PROVENANCE_FIELDS = Object.freeze([
	'repository', 'headSha', 'runId', 'artifactId', 'workflowUrl', 'archiveName', 'archiveSha256', 'archiveByteLength',
	'licenseSpdx', 'upstreamProjectUrl', 'upstreamLicenseUrl', 'modificationNotice', 'mappingVersion', 'mappingSha256',
]);

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
	const layerCatalogs = new Map();
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
		if (!Object.keys(messages).length) continue;
		layerCatalogs.set(locale, Object.freeze({
			schemaVersion: AUDACITY_LAYER_SCHEMA_VERSION,
			locale,
			provenance,
			messages,
		}));
	}
	return Object.freeze({ catalogs: layerCatalogs, provenance, audit: Object.freeze(audit), unknownLocales: Object.freeze(unknownLocales), licenseBytes });
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

/** Structural validity of one committed catalog file. */
export function assertAudacityCatalogFile(catalog, locale) {
	if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) fail('LAYER_SHAPE', `Audacity catalog ${locale} must be an object.`);
	if (catalog.schemaVersion !== AUDACITY_LAYER_SCHEMA_VERSION) fail('LAYER_SCHEMA', `Audacity catalog ${locale} has an unsupported schema.`);
	if (catalog.locale !== locale || !LOCALE_BY_TAG[locale]) fail('LAYER_LOCALE', `Audacity catalog ${locale} declares locale ${catalog.locale}.`);
	if (!catalog.provenance || typeof catalog.provenance !== 'object') fail('LAYER_PROVENANCE', `Audacity catalog ${locale} has no provenance.`);
	for (const field of PROVENANCE_FIELDS) {
		if (catalog.provenance[field] === undefined || catalog.provenance[field] === null || catalog.provenance[field] === '') {
			fail('LAYER_PROVENANCE', `Audacity catalog ${locale} provenance is missing ${field}.`);
		}
	}
	if (catalog.provenance.licenseSpdx !== 'GPL-3.0-only') fail('LAYER_LICENSE', `Audacity catalog ${locale} must record the GPL-3.0-only licence.`);
	if (!catalog.messages || typeof catalog.messages !== 'object' || Array.isArray(catalog.messages)) fail('LAYER_MESSAGES', `Audacity catalog ${locale} messages must be an object.`);
	const keys = Object.keys(catalog.messages);
	if (!keys.length) fail('LAYER_EMPTY', `Audacity catalog ${locale} carries no messages.`);
	const sorted = [...keys].sort(compareCodeUnits);
	if (keys.some((key, index) => key !== sorted[index])) fail('LAYER_ORDER', `Audacity catalog ${locale} messages are not sorted.`);
	for (const [key, value] of Object.entries(catalog.messages)) {
		if (typeof value !== 'string' || !value.trim() || value !== value.trim()) fail('LAYER_VALUE', `Audacity catalog ${locale} message ${key} is not a trimmed non-empty string.`);
		if (/…|\.\.\./u.test(value)) fail('LAYER_ELLIPSIS', `Audacity catalog ${locale} message ${key} contains an ellipsis.`);
	}
	return catalog;
}

/** One message per line, keys in code-unit order, provenance on one line. */
export function serializeAudacityCatalog(catalog) {
	const keys = Object.keys(catalog.messages).sort(compareCodeUnits);
	const provenance = Object.fromEntries(PROVENANCE_FIELDS.map((field) => [field, catalog.provenance[field]]));
	return `{\n\t"schemaVersion": ${AUDACITY_LAYER_SCHEMA_VERSION},\n\t"locale": ${JSON.stringify(catalog.locale)},\n\t"provenance": ${JSON.stringify(provenance)},\n\t"messages": {\n${keys.map((key) => `\t\t${JSON.stringify(key)}: ${JSON.stringify(catalog.messages[key])}`).join(',\n')}\n\t}\n}\n`;
}

export function renderAudacityLayerIndex(locales) {
	const list = locales.map((locale) => `\t'${locale}',`).join('\n');
	const loaders = locales.map((locale) => `\t${propertyKey(locale)}: () => import('./${locale}.json'),`).join('\n');
	return [
		'/* SPDX-License-Identifier: AGPL-3.0-only */',
		'',
		'// Generated by scripts/audacity-qt-translations.mjs from the catalogs beside',
		"// this file; do not edit by hand. Each loader is a lazy JSON chunk of Audacity's",
		'// reviewed strings for one locale, laid over the machine catalog at runtime.',
		'// The imports carry no type attribute on purpose: Vite bundles a JSON module',
		'// into a JavaScript chunk, which the browser would refuse under a JSON attribute.',
		'',
		locales.length ? `export const AUDACITY_CATALOG_LOCALES = Object.freeze([\n${list}\n]);` : 'export const AUDACITY_CATALOG_LOCALES = Object.freeze([]);',
		'',
		locales.length ? `export const AUDACITY_CATALOG_LOADERS = Object.freeze({\n${loaders}\n});` : 'export const AUDACITY_CATALOG_LOADERS = Object.freeze({});',
		'',
	].join('\n');
}

export function renderAudacityLayerNotice(provenance, locales) {
	return `# Audacity translations

The JSON catalogs in this directory carry translations from the Audacity project, converted from the Qt TS catalogs Audacity publishes for its translators' reviewed work. They are used under the GNU General Public License version 3 (\`${provenance.licenseSpdx}\`), whose text is in \`LICENSE.txt\` beside this file, and combined with this AGPL-3.0-only application under section 13 of both licences. The Audacity-derived strings remain governed by the GPLv3.

- upstream project: <${provenance.upstreamProjectUrl}>
- upstream licence and notices: <${provenance.upstreamLicenseUrl}>
- source commit: \`${provenance.headSha}\`
- translation artifact: \`${provenance.archiveName}\` (artifact ${provenance.artifactId} of workflow run ${provenance.runId}, <${provenance.workflowUrl}>), SHA-256 \`${provenance.archiveSha256}\`, ${provenance.archiveByteLength} bytes
- reviewed key mapping: version ${provenance.mappingVersion}, SHA-256 \`${provenance.mappingSha256}\` (\`src/common/i18n/audacity-qt-mapping.js\`)

Modification notice: ${provenance.modificationNotice}

Locales carried: ${locales.join(', ')}.

Generated by \`scripts/audacity-qt-translations.mjs\`; do not edit these files by hand. The complete record of third-party material is in \`THIRD_PARTY_LICENSES.md\` at the repository root.
`;
}

export async function listAudacityLayerLocales(directory = AUDACITY_LAYER_DIRECTORY) {
	let names;
	try {
		names = await readdir(directory);
	} catch (error) {
		if (error?.code === 'ENOENT') return [];
		throw error;
	}
	return names.filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -'.json'.length)).sort(compareCodeUnits);
}

export async function readAudacityCatalog(locale, directory = AUDACITY_LAYER_DIRECTORY) {
	if (!LOCALE_BY_TAG[locale]) fail('LAYER_LOCALE', `Unknown locale for an Audacity catalog: ${locale}`);
	let raw;
	try {
		raw = await readFile(join(directory, `${locale}.json`), 'utf8');
	} catch (error) {
		if (error?.code === 'ENOENT') return null;
		throw error;
	}
	let catalog;
	try {
		catalog = JSON.parse(raw);
	} catch (error) {
		throw new Error(`Audacity catalog ${locale} is not valid JSON.`, { cause: error });
	}
	return assertAudacityCatalogFile(catalog, locale);
}

/** Write the layer: every catalog, the index, the notice and the licence; retire files no longer produced. */
export async function writeAudacityLayer(layer, directory = AUDACITY_LAYER_DIRECTORY) {
	const locales = [...layer.catalogs.keys()].sort(compareCodeUnits);
	for (const locale of locales) assertAudacityCatalogFile(layer.catalogs.get(locale), locale);
	await mkdir(directory, { recursive: true });
	for (const previous of await listAudacityLayerLocales(directory)) {
		if (!layer.catalogs.has(previous)) await rm(join(directory, `${previous}.json`), { force: true });
	}
	for (const locale of locales) await writeAtomically(join(directory, `${locale}.json`), serializeAudacityCatalog(layer.catalogs.get(locale)));
	await writeAtomically(join(directory, AUDACITY_LAYER_INDEX_FILE), renderAudacityLayerIndex(locales));
	await writeAtomically(join(directory, AUDACITY_LAYER_NOTICE_FILE), renderAudacityLayerNotice(layer.provenance, locales));
	await writeAtomically(join(directory, AUDACITY_LAYER_LICENSE_FILE), Buffer.from(layer.licenseBytes));
	return locales;
}

function propertyKey(locale) {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(locale) ? locale : `'${locale}'`;
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
