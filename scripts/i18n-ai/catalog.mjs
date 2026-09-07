/* SPDX-License-Identifier: AGPL-3.0-only */

// The translation catalog files on disk: where they live, how they are read,
// assessed against the current English copy, serialised so diffs stay
// reviewable, and written atomically. One file per locale holds every origin
// of string — machine, audacity, human — and the runtime predicate that
// decides whether an entry may be shown lives beside the runtime in
// src/common/i18n/translation-catalog.js and is reused here unchanged, so no
// writer can commit an entry the editor would then refuse.

import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LOCALE_BY_TAG } from '../../src/common/i18n/locales.js';
import { normalizeBcp47Locale } from '../../src/common/i18n/locale.js';
import {
	AUTOMATIC_ORIGINS,
	TRANSLATION_CATALOG_SCHEMA_VERSION,
	TRANSLATION_ORIGINS,
	acceptableTranslation,
} from '../../src/common/i18n/translation-catalog.js';
import { compareCodeUnits } from '../lib/canonical-json.mjs';

export const TRANSLATION_CATALOG_DIRECTORY = fileURLToPath(new URL('../../src/common/i18n/translations/', import.meta.url));
export const TRANSLATION_CATALOG_INDEX_FILE = 'index.js';
export { AUTOMATIC_ORIGINS, TRANSLATION_ORIGINS };

/** Locales the bundled human catalogs already cover completely, or that are English. */
const HUMAN_CATALOG_LANGUAGES = new Set(['en', 'de']);
const MACHINE_PROVENANCE_FIELDS = Object.freeze(['model', 'modelDigest', 'promptVersion']);
const AUDACITY_PROVENANCE_FIELDS = Object.freeze([
	'repository', 'headSha', 'runId', 'artifactId', 'workflowUrl', 'archiveName', 'archiveSha256', 'archiveByteLength',
	'licenseSpdx', 'upstreamProjectUrl', 'upstreamLicenseUrl', 'modificationNotice', 'mappingVersion', 'mappingSha256',
]);

export function translationCatalogPath(locale, directory = TRANSLATION_CATALOG_DIRECTORY) {
	return join(directory, `${assertTranslationCatalogLocale(locale)}.json`);
}

/** A locale a catalog may serve: known to Audacity's locale set and canonical. */
export function assertTranslationCatalogLocale(locale) {
	const canonical = normalizeBcp47Locale(locale);
	if (canonical !== locale || !LOCALE_BY_TAG[locale]) {
		throw new Error(`Unknown or non-canonical locale for a translation catalog: ${locale}`);
	}
	return locale;
}

/** A locale the machine translator may translate into: not served by a bundled human catalog. */
export function assertMachineTranslatableLocale(locale) {
	assertTranslationCatalogLocale(locale);
	if (HUMAN_CATALOG_LANGUAGES.has(new Intl.Locale(locale).language)) {
		throw new Error(`Locale ${locale} is served by a bundled human catalog and takes no machine translation.`);
	}
	return locale;
}

export async function listTranslationCatalogLocales(directory = TRANSLATION_CATALOG_DIRECTORY) {
	let names;
	try {
		names = await readdir(directory);
	} catch (error) {
		if (error?.code === 'ENOENT') return [];
		throw error;
	}
	return names
		.filter((name) => name.endsWith('.json'))
		.map((name) => name.slice(0, -'.json'.length))
		.sort(compareCodeUnits);
}

export async function readTranslationCatalog(locale, directory = TRANSLATION_CATALOG_DIRECTORY) {
	let raw;
	try {
		raw = await readFile(translationCatalogPath(locale, directory), 'utf8');
	} catch (error) {
		if (error?.code === 'ENOENT') return null;
		throw error;
	}
	let catalog;
	try {
		catalog = JSON.parse(raw);
	} catch (error) {
		throw new Error(`Translation catalog ${locale} is not valid JSON.`, { cause: error });
	}
	assertTranslationCatalogFile(catalog, locale);
	return catalog;
}

/** Structural validity of a catalog file, independent of the current English copy. */
export function assertTranslationCatalogFile(catalog, locale) {
	if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) throw new Error(`Translation catalog ${locale} must be an object.`);
	if (catalog.schemaVersion !== TRANSLATION_CATALOG_SCHEMA_VERSION) throw new Error(`Translation catalog ${locale} has an unsupported schema.`);
	if (catalog.locale !== locale) throw new Error(`Translation catalog ${locale} declares locale ${catalog.locale}.`);
	assertTranslationCatalogLocale(locale);
	if (!catalog.provenance || typeof catalog.provenance !== 'object' || Array.isArray(catalog.provenance)) {
		throw new Error(`Translation catalog ${locale} has no provenance.`);
	}
	if (!catalog.entries || typeof catalog.entries !== 'object' || Array.isArray(catalog.entries)) {
		throw new Error(`Translation catalog ${locale} entries must be an object.`);
	}
	const keys = Object.keys(catalog.entries);
	if (!keys.length) throw new Error(`Translation catalog ${locale} carries no entries.`);
	const sorted = [...keys].sort(compareCodeUnits);
	if (keys.some((key, index) => key !== sorted[index])) throw new Error(`Translation catalog ${locale} entries are not sorted.`);
	const present = new Set();
	for (const [key, entry] of Object.entries(catalog.entries)) {
		if (!Array.isArray(entry) || entry.length !== 3 || !TRANSLATION_ORIGINS.includes(entry[0]) || typeof entry[1] !== 'string' || typeof entry[2] !== 'string') {
			throw new Error(`Translation catalog ${locale} entry ${key} must be an [origin, source, translation] triple.`);
		}
		if (!acceptableTranslation(entry[1], entry[2])) {
			throw new Error(`Translation catalog ${locale} entry ${key} is not an acceptable translation of its source.`);
		}
		present.add(entry[0]);
	}
	if (present.has('machine')) assertFields(catalog.provenance.machine, MACHINE_PROVENANCE_FIELDS, `${locale} machine provenance`);
	if (present.has('audacity')) {
		assertFields(catalog.provenance.audacity, AUDACITY_PROVENANCE_FIELDS, `${locale} Audacity provenance`);
		if (catalog.provenance.audacity.licenseSpdx !== 'GPL-3.0-only') throw new Error(`Translation catalog ${locale} must record Audacity's GPL-3.0-only licence.`);
	}
	for (const origin of Object.keys(catalog.provenance)) {
		if (!AUTOMATIC_ORIGINS.includes(origin)) throw new Error(`Translation catalog ${locale} carries provenance for an unknown origin ${origin}.`);
		if (!present.has(origin)) throw new Error(`Translation catalog ${locale} carries ${origin} provenance without ${origin} entries.`);
	}
	return catalog;
}

function assertFields(record, fields, label) {
	if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error(`Translation catalog ${label} is missing.`);
	for (const field of fields) {
		if (record[field] === undefined || record[field] === null || record[field] === '') throw new Error(`Translation catalog ${label} is missing ${field}.`);
	}
}

/**
 * Sort a catalog's entries against the English copy they are meant to serve.
 * `current` may be shown; `stale` were written for an English string that has
 * since changed; `orphaned` no longer have an English key; `missing` are
 * English keys the catalog does not carry. Every list says which origin an
 * entry has, and `pending` is what the machine translator owes: missing keys
 * and stale automatic entries, never a human one. Keys in
 * `options.excludedKeys` are never translated, so they are neither missing nor
 * pending; a catalog whose machine entries predate `options.promptVersion`
 * owes every automatic entry again.
 */
export function assessTranslationCatalog(catalog, englishCopy, options = {}) {
	const entries = catalog?.entries ?? {};
	const excluded = new Set(options.excludedKeys ?? []);
	const outdated = Boolean(catalog?.provenance?.machine) && typeof options.promptVersion === 'string'
		&& catalog.provenance.machine.promptVersion !== options.promptVersion;
	const current = {};
	const origins = {};
	const stale = [];
	const orphaned = [];
	for (const [key, entry] of Object.entries(entries)) {
		const [origin, source, translation] = entry;
		if (!Object.hasOwn(englishCopy, key)) orphaned.push(key);
		else if (source !== englishCopy[key]) stale.push(key);
		else {
			current[key] = translation;
			origins[key] = origin;
		}
	}
	const missing = Object.keys(englishCopy).filter((key) => !excluded.has(key) && !Object.hasOwn(entries, key)).sort(compareCodeUnits);
	const automatic = (key) => AUTOMATIC_ORIGINS.includes(entries[key]?.[0]);
	const pending = outdated
		? Object.keys(englishCopy).filter((key) => !excluded.has(key) && (!Object.hasOwn(entries, key) || automatic(key)))
		: [...stale.filter(automatic), ...missing];
	return Object.freeze({
		current: Object.freeze(current),
		origins: Object.freeze(origins),
		stale: Object.freeze(stale.sort(compareCodeUnits)),
		orphaned: Object.freeze(orphaned.sort(compareCodeUnits)),
		missing: Object.freeze(missing),
		outdated,
		pending: Object.freeze(pending.sort(compareCodeUnits)),
	});
}

/** One entry per line, keys in code-unit order, each provenance record on one line. */
export function serializeTranslationCatalog({ locale, provenance = {}, entries }) {
	const keys = Object.keys(entries).sort(compareCodeUnits);
	const lines = keys.map((key) => `\t\t${JSON.stringify(key)}: ${JSON.stringify([entries[key][0], entries[key][1], entries[key][2]])}`);
	const provenanceLines = AUTOMATIC_ORIGINS
		.filter((origin) => provenance[origin])
		.map((origin) => `\t\t${JSON.stringify(origin)}: ${JSON.stringify(pickFields(provenance[origin], origin === 'machine' ? MACHINE_PROVENANCE_FIELDS : AUDACITY_PROVENANCE_FIELDS))}`);
	return [
		'{',
		`\t"schemaVersion": ${TRANSLATION_CATALOG_SCHEMA_VERSION},`,
		`\t"locale": ${JSON.stringify(locale)},`,
		`\t"provenance": {${provenanceLines.length ? `\n${provenanceLines.join(',\n')}\n\t` : ''}},`,
		'\t"entries": {',
		lines.join(',\n'),
		'\t}',
		'}',
		'',
	].join('\n');
}

function pickFields(record, fields) {
	return Object.fromEntries(fields.map((field) => [field, record[field]]));
}

/**
 * Write a catalog. Provenance is kept only for origins the entries still
 * carry, and a catalog with no entries left is removed rather than written.
 */
export async function writeTranslationCatalog(catalog, directory = TRANSLATION_CATALOG_DIRECTORY) {
	const entries = sortedEntries(catalog.entries);
	const present = new Set(Object.values(entries).map(([origin]) => origin));
	const provenance = Object.fromEntries(Object.entries(catalog.provenance ?? {}).filter(([origin]) => present.has(origin)));
	const path = translationCatalogPath(catalog.locale, directory);
	if (!Object.keys(entries).length) {
		await rm(path, { force: true });
		return path;
	}
	const document = { schemaVersion: TRANSLATION_CATALOG_SCHEMA_VERSION, locale: catalog.locale, provenance, entries };
	assertTranslationCatalogFile(document, catalog.locale);
	await writeAtomically(path, serializeTranslationCatalog(document));
	return path;
}

/** Regenerate the loader index from the catalog files present. */
export async function writeTranslationCatalogIndex(directory = TRANSLATION_CATALOG_DIRECTORY) {
	const locales = await listTranslationCatalogLocales(directory);
	for (const locale of locales) assertTranslationCatalogLocale(locale);
	await writeAtomically(join(directory, TRANSLATION_CATALOG_INDEX_FILE), renderTranslationCatalogIndex(locales));
	return locales;
}

export function renderTranslationCatalogIndex(locales) {
	const list = locales.map((locale) => `\t'${locale}',`).join('\n');
	const loaders = locales.map((locale) => `\t${propertyKey(locale)}: () => import('./${locale}.json'),`).join('\n');
	return [
		'/* SPDX-License-Identifier: AGPL-3.0-only */',
		'',
		'// Generated from the catalogs beside this file by scripts/i18n-ai.mjs and',
		'// scripts/audacity-qt-translations.mjs; do not edit by hand. Each loader is',
		"// a lazy JSON chunk of one locale's translations, whatever their origin, so a",
		'// locale costs nothing until it is opened. The imports carry no type',
		'// attribute on purpose: Vite bundles a JSON module into a JavaScript chunk,',
		'// which the browser would refuse under a JSON attribute. Node reads these',
		"// files through scripts/i18n-ai/catalog.mjs; the test runner's tsx loader",
		'// resolves the attribute-free imports.',
		'',
		locales.length ? `export const TRANSLATION_CATALOG_LOCALES = Object.freeze([\n${list}\n]);` : 'export const TRANSLATION_CATALOG_LOCALES = Object.freeze([]);',
		'',
		locales.length ? `export const TRANSLATION_CATALOG_LOADERS = Object.freeze({\n${loaders}\n});` : 'export const TRANSLATION_CATALOG_LOADERS = Object.freeze({});',
		'',
	].join('\n');
}

function propertyKey(locale) {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(locale) ? locale : `'${locale}'`;
}

function sortedEntries(entries) {
	return Object.fromEntries(Object.keys(entries).sort(compareCodeUnits).map((key) => [key, entries[key]]));
}

async function writeAtomically(path, text) {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	await writeFile(temporary, text, { flag: 'wx' });
	try {
		await rename(temporary, path);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}
