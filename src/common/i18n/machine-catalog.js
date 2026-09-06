/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The machine-translated catalog layer.
 *
 * `scripts/i18n-ai.mjs` writes one JSON catalog per locale under `./machine/`
 * by translating the English copy with a locally run model. Every entry keeps
 * the English it was translated from, and an entry is shown only while that
 * English is still the current English: editing a string in the English copy
 * retires its machine translations on its own, without a model run, until the
 * catalog is regenerated. A stale or malformed entry falls through to whatever
 * sits below it, never to the old translation.
 *
 * At runtime these strings sit above the bundled catalogs and below Audacity's
 * reviewed packs, so a key Audacity has translated always shows Audacity's
 * wording. A catalog serves exactly its own locale tag, as Audacity's packs
 * do, so both layers always cover the same locale.
 *
 * This module deliberately imports no catalog: the site shell reads it in the
 * initial graph and passes the small site copy as its English reference, and
 * the editor runtime passes the complete English catalog.
 */

import { normalizeBcp47Locale } from './locale.js';
import { MACHINE_CATALOG_LOADERS } from './machine/index.js';

export const MACHINE_CATALOG_SCHEMA_VERSION = 1;

const ELLIPSIS_PATTERN = /…|\.\.\./u;
const NAMED_PLACEHOLDER_PATTERN = /\{[A-Za-z][A-Za-z0-9_]*\}/gu;
// Tokens a translation has to carry through unchanged: `*track*`-style
// identifiers and file extensions such as `.aup4`.
const PROTECTED_TOKEN_PATTERN = /\*[A-Za-z][A-Za-z0-9_-]*\*|(?<![A-Za-z0-9])\.[a-z][a-z0-9]{1,5}\b/gu;

/** The catalog locale that serves `locale`: its exact canonical tag, or null. */
export function machineCatalogLocale(locale, loaders = MACHINE_CATALOG_LOADERS) {
	const normalized = normalizeBcp47Locale(locale);
	return Object.hasOwn(loaders, normalized) ? normalized : null;
}

/**
 * Load the machine translations for `locale` that are current against
 * `englishCopy`, or null when no catalog serves the locale. Load failures
 * propagate; the caller decides what a missing chunk means.
 */
export async function loadMachineCatalog(locale, options = {}) {
	const loaders = options.loaders || MACHINE_CATALOG_LOADERS;
	const catalogLocale = machineCatalogLocale(locale, loaders);
	if (!catalogLocale) return null;
	const module = await loaders[catalogLocale]();
	const catalog = module && typeof module === 'object' && 'default' in module ? module.default : module;
	return currentMachineEntries(catalog, options.englishCopy, { locale: catalogLocale });
}

/**
 * The entries of `catalog` that may be shown against `englishCopy`: the key
 * still exists, the recorded English source is the current English, and the
 * translation is acceptable for that source. Anything else is left out.
 */
export function currentMachineEntries(catalog, englishCopy, options = {}) {
	assertMachineCatalogShape(catalog, options.locale);
	if (!englishCopy || typeof englishCopy !== 'object') throw new TypeError('Machine catalog entries need an English reference.');
	const entries = {};
	for (const [key, entry] of Object.entries(catalog.entries)) {
		if (!Object.hasOwn(englishCopy, key) || !Array.isArray(entry)) continue;
		const [source, translation] = entry;
		if (source !== englishCopy[key] || !acceptableMachineTranslation(source, translation)) continue;
		entries[key] = translation;
	}
	return Object.freeze(entries);
}

/**
 * Whether `translation` may stand in for `source`: the rules Audacity packs
 * are held to, plus the shape a string has to keep to stay usable — its line
 * count, and the identifiers and file extensions it names.
 */
export function acceptableMachineTranslation(source, translation) {
	if (typeof source !== 'string' || typeof translation !== 'string') return false;
	if (!translation.trim() || translation !== translation.trim()) return false;
	if (ELLIPSIS_PATTERN.test(translation)) return false;
	if (translation.includes('<docs-ai-token')) return false;
	if (lineCount(source) !== lineCount(translation)) return false;
	if (!sameNamedPlaceholders(source, translation)) return false;
	return protectedTokens(source).every((token) => translation.includes(token));
}

export function namedPlaceholders(value) {
	return [...String(value).matchAll(NAMED_PLACEHOLDER_PATTERN)].map(([placeholder]) => placeholder).sort();
}

export function sameNamedPlaceholders(source, translation) {
	const left = namedPlaceholders(source);
	const right = namedPlaceholders(translation);
	return left.length === right.length && left.every((placeholder, index) => placeholder === right[index]);
}

export function protectedTokens(value) {
	return [...new Set([...String(value).matchAll(PROTECTED_TOKEN_PATTERN)].map(([token]) => token))];
}

function lineCount(value) {
	return value.split('\n').length;
}

function assertMachineCatalogShape(catalog, locale) {
	if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) throw new Error('Machine catalog must be an object.');
	if (catalog.schemaVersion !== MACHINE_CATALOG_SCHEMA_VERSION) throw new Error('Unsupported machine catalog schema.');
	if (typeof catalog.locale !== 'string' || normalizeBcp47Locale(catalog.locale) !== catalog.locale) {
		throw new Error('Machine catalog locale is not canonical.');
	}
	if (locale && catalog.locale !== locale) throw new Error(`Machine catalog locale ${catalog.locale} does not match ${locale}.`);
	if (!catalog.entries || typeof catalog.entries !== 'object' || Array.isArray(catalog.entries)) {
		throw new Error('Machine catalog entries must be an object.');
	}
}
