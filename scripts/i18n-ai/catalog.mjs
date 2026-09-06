/* SPDX-License-Identifier: AGPL-3.0-only */

// The machine catalog files on disk: where they live, how they are read,
// assessed against the current English copy, serialised so diffs stay
// reviewable, and written atomically. The runtime predicate that decides
// whether an entry may be shown lives beside the runtime in
// src/common/i18n/machine-catalog.js and is reused here unchanged, so the
// generator can never write an entry the editor would then refuse.

import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LOCALE_BY_TAG } from '../../src/common/i18n/locales.js';
import { normalizeBcp47Locale } from '../../src/common/i18n/locale.js';
import {
	MACHINE_CATALOG_SCHEMA_VERSION,
	acceptableMachineTranslation,
} from '../../src/common/i18n/machine-catalog.js';
import { compareCodeUnits } from '../lib/canonical-json.mjs';

export const MACHINE_CATALOG_DIRECTORY = fileURLToPath(new URL('../../src/common/i18n/machine/', import.meta.url));
export const MACHINE_CATALOG_INDEX_FILE = 'index.js';

/** Locales the bundled human catalogs already cover completely, or that are English. */
const HUMAN_CATALOG_LANGUAGES = new Set(['en', 'de']);

export function machineCatalogPath(locale, directory = MACHINE_CATALOG_DIRECTORY) {
	return join(directory, `${assertMachineCatalogLocale(locale)}.json`);
}

/** A locale the generator will translate into: known to Audacity's locale set and not humanly covered. */
export function assertMachineCatalogLocale(locale) {
	const canonical = normalizeBcp47Locale(locale);
	if (canonical !== locale || !LOCALE_BY_TAG[locale]) {
		throw new Error(`Unknown or non-canonical locale for a machine catalog: ${locale}`);
	}
	if (HUMAN_CATALOG_LANGUAGES.has(new Intl.Locale(locale).language)) {
		throw new Error(`Locale ${locale} is served by a bundled human catalog and takes no machine catalog.`);
	}
	return locale;
}

export async function listMachineCatalogLocales(directory = MACHINE_CATALOG_DIRECTORY) {
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

export async function readMachineCatalog(locale, directory = MACHINE_CATALOG_DIRECTORY) {
	let raw;
	try {
		raw = await readFile(machineCatalogPath(locale, directory), 'utf8');
	} catch (error) {
		if (error?.code === 'ENOENT') return null;
		throw error;
	}
	let catalog;
	try {
		catalog = JSON.parse(raw);
	} catch (error) {
		throw new Error(`Machine catalog ${locale} is not valid JSON.`, { cause: error });
	}
	assertMachineCatalogFile(catalog, locale);
	return catalog;
}

/** Structural validity of a catalog file, independent of the current English copy. */
export function assertMachineCatalogFile(catalog, locale) {
	if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) throw new Error(`Machine catalog ${locale} must be an object.`);
	if (catalog.schemaVersion !== MACHINE_CATALOG_SCHEMA_VERSION) throw new Error(`Machine catalog ${locale} has an unsupported schema.`);
	if (catalog.locale !== locale) throw new Error(`Machine catalog ${locale} declares locale ${catalog.locale}.`);
	assertMachineCatalogLocale(locale);
	assertProvenance(catalog.provenance, locale);
	if (!catalog.entries || typeof catalog.entries !== 'object' || Array.isArray(catalog.entries)) {
		throw new Error(`Machine catalog ${locale} entries must be an object.`);
	}
	const keys = Object.keys(catalog.entries);
	const sorted = [...keys].sort(compareCodeUnits);
	if (keys.some((key, index) => key !== sorted[index])) throw new Error(`Machine catalog ${locale} entries are not sorted.`);
	for (const [key, entry] of Object.entries(catalog.entries)) {
		if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || typeof entry[1] !== 'string') {
			throw new Error(`Machine catalog ${locale} entry ${key} must be a [source, translation] pair of strings.`);
		}
		if (!acceptableMachineTranslation(entry[0], entry[1])) {
			throw new Error(`Machine catalog ${locale} entry ${key} is not an acceptable translation of its source.`);
		}
	}
	return catalog;
}

function assertProvenance(provenance, locale) {
	if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) throw new Error(`Machine catalog ${locale} has no provenance.`);
	for (const field of ['model', 'modelDigest', 'promptVersion']) {
		if (typeof provenance[field] !== 'string' || !provenance[field]) throw new Error(`Machine catalog ${locale} provenance is missing ${field}.`);
	}
}

/**
 * Sort a catalog's entries against the English copy they are meant to serve.
 * `current` may be shown; `stale` were translated from an English string that
 * has since changed; `orphaned` no longer have an English key; `missing` are
 * English keys the catalog does not carry. Pending work is stale plus missing.
 * Keys in `options.excludedKeys` are never translated, so they are neither
 * missing nor pending, and translate and check agree on what is left to do.
 */
export function assessMachineCatalog(catalog, englishCopy, options = {}) {
	const entries = catalog?.entries ?? {};
	const excluded = new Set(options.excludedKeys ?? []);
	// A catalog written under an earlier prompt is shown as it is, but every
	// entry is regenerated: a tightened prompt must reach the committed files.
	const outdated = Boolean(catalog) && typeof options.promptVersion === 'string'
		&& catalog.provenance?.promptVersion !== options.promptVersion;
	const current = {};
	const stale = [];
	const orphaned = [];
	for (const [key, entry] of Object.entries(entries)) {
		if (!Object.hasOwn(englishCopy, key)) orphaned.push(key);
		else if (entry[0] !== englishCopy[key]) stale.push(key);
		else current[key] = entry[1];
	}
	const missing = Object.keys(englishCopy).filter((key) => !excluded.has(key) && !Object.hasOwn(entries, key)).sort(compareCodeUnits);
	const pending = (outdated ? Object.keys(englishCopy).filter((key) => !excluded.has(key)) : [...stale, ...missing]);
	return Object.freeze({
		current: Object.freeze(current),
		stale: Object.freeze(stale.sort(compareCodeUnits)),
		orphaned: Object.freeze(orphaned.sort(compareCodeUnits)),
		missing: Object.freeze(missing),
		outdated,
		pending: Object.freeze(pending.sort(compareCodeUnits)),
	});
}

/** One entry per line, keys in code-unit order, so a regeneration diffs by string. */
export function serializeMachineCatalog({ locale, provenance, entries }) {
	const keys = Object.keys(entries).sort(compareCodeUnits);
	const lines = keys.map((key) => `\t\t${JSON.stringify(key)}: ${JSON.stringify([entries[key][0], entries[key][1]])}`);
	const header = [
		`\t"schemaVersion": ${MACHINE_CATALOG_SCHEMA_VERSION}`,
		`\t"locale": ${JSON.stringify(locale)}`,
		`\t"provenance": ${JSON.stringify({ model: provenance.model, modelDigest: provenance.modelDigest, promptVersion: provenance.promptVersion })}`,
	];
	return `{\n${header.join(',\n')},\n\t"entries": {\n${lines.join(',\n')}\n\t}\n}\n`;
}

export async function writeMachineCatalog({ locale, provenance, entries }, directory = MACHINE_CATALOG_DIRECTORY) {
	const document = {
		schemaVersion: MACHINE_CATALOG_SCHEMA_VERSION,
		locale,
		provenance: { model: provenance?.model, modelDigest: provenance?.modelDigest, promptVersion: provenance?.promptVersion },
		entries: sortedEntries(entries),
	};
	assertMachineCatalogFile(document, locale);
	const path = machineCatalogPath(locale, directory);
	await writeAtomically(path, serializeMachineCatalog(document));
	return path;
}

export async function removeMachineCatalog(locale, directory = MACHINE_CATALOG_DIRECTORY) {
	await rm(machineCatalogPath(locale, directory), { force: true });
}

/** Regenerate the loader index from the catalog files present. */
export async function writeMachineCatalogIndex(directory = MACHINE_CATALOG_DIRECTORY) {
	const locales = await listMachineCatalogLocales(directory);
	for (const locale of locales) assertMachineCatalogLocale(locale);
	await writeAtomically(join(directory, MACHINE_CATALOG_INDEX_FILE), renderMachineCatalogIndex(locales));
	return locales;
}

export function renderMachineCatalogIndex(locales) {
	const list = locales.map((locale) => `\t${JSON.stringify(locale).replaceAll('"', "'")},`).join('\n');
	const loaders = locales
		.map((locale) => `\t${propertyKey(locale)}: () => import(${JSON.stringify(`./${locale}.json`).replaceAll('"', "'")}),`)
		.join('\n');
	return [
		'/* SPDX-License-Identifier: AGPL-3.0-only */',
		'',
		'// Generated by scripts/i18n-ai.mjs from the catalogs beside this file; do not',
		'// edit by hand. Each loader is a lazy JSON chunk so a locale\'s machine',
		'// translations cost nothing until that locale is opened. The imports carry',
		'// no type attribute on purpose: Vite bundles a JSON module into a JavaScript',
		'// chunk, which the browser would refuse under a JSON attribute. Node reads',
		'// these files through scripts/i18n-ai/catalog.mjs; the test runner\'s tsx',
		'// loader resolves the attribute-free imports.',
		'',
		locales.length ? `export const MACHINE_CATALOG_LOCALES = Object.freeze([\n${list}\n]);` : 'export const MACHINE_CATALOG_LOCALES = Object.freeze([]);',
		'',
		locales.length ? `export const MACHINE_CATALOG_LOADERS = Object.freeze({\n${loaders}\n});` : 'export const MACHINE_CATALOG_LOADERS = Object.freeze({});',
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
