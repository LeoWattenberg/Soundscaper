/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The committed translation catalogs: one JSON file per locale under
 * `./translations/`, every entry tagged with where it came from.
 *
 *   ["machine",  "<English at translation time>", "<translation>"]
 *   ["audacity", "<English at sync time>",        "<reviewed string>"]
 *   ["human",    "<English when written>",        "<hand-written string>"]
 *
 * The tag says who may overwrite the entry: the weekly Audacity sync and the
 * machine translator replace `machine` and `audacity` entries, and never
 * touch a `human` one. The recorded English says whether the entry still
 * applies: an entry of any origin is shown only while its English is the
 * current English, so editing copy retires its translations on its own until
 * the sync or the translator writes them again. At runtime a catalog is
 * lazy-imported and laid over the bundled English (and German) copy.
 *
 * This module deliberately imports no catalog: the site shell reads it in the
 * initial graph and passes the small site copy as its English reference, and
 * the editor runtime passes the complete English catalog.
 */

import { normalizeBcp47Locale } from './locale.js';
import { TRANSLATION_CATALOG_LOADERS } from './translations/index.js';

export const TRANSLATION_CATALOG_SCHEMA_VERSION = 2;
export const TRANSLATION_ORIGINS = Object.freeze(['machine', 'audacity', 'human']);
/** Origins an automatic writer may replace; a human entry is never one of them. */
export const AUTOMATIC_ORIGINS = Object.freeze(['machine', 'audacity']);

const ELLIPSIS_PATTERN = /…|\.\.\./u;
const NAMED_PLACEHOLDER_PATTERN = /\{[A-Za-z][A-Za-z0-9_]*\}/gu;
// Tokens a translation has to carry through unchanged: `*track*`-style
// identifiers and file extensions such as `.aup4`.
const PROTECTED_TOKEN_PATTERN = /\*[A-Za-z][A-Za-z0-9_-]*\*|(?<![A-Za-z0-9])\.[a-z][a-z0-9]{1,5}\b/gu;

/** The catalog locale that serves `locale`: its exact canonical tag, or null. */
export function translationCatalogLocale(locale, loaders = TRANSLATION_CATALOG_LOADERS) {
	const normalized = normalizeBcp47Locale(locale);
	return Object.hasOwn(loaders, normalized) ? normalized : null;
}

/**
 * Load the strings for `locale` that are current against `englishCopy`, or
 * null when no catalog serves the locale. Load failures propagate; the caller
 * decides what a missing chunk means.
 */
export async function loadTranslationCatalog(locale, options = {}) {
	const loaders = options.loaders || TRANSLATION_CATALOG_LOADERS;
	const catalogLocale = translationCatalogLocale(locale, loaders);
	if (!catalogLocale) return null;
	const module = await loaders[catalogLocale]();
	const catalog = module && typeof module === 'object' && 'default' in module ? module.default : module;
	return currentTranslations(catalog, options.englishCopy, { locale: catalogLocale });
}

/**
 * The entries of `catalog` that may be shown against `englishCopy`: the key
 * still exists, the recorded English is the current English, and the string
 * is acceptable for it. Anything else is left out. `options.origins` narrows
 * the result to some origins, which the site copy and the tests use.
 */
export function currentTranslations(catalog, englishCopy, options = {}) {
	assertTranslationCatalogShape(catalog, options.locale);
	if (!englishCopy || typeof englishCopy !== 'object') throw new TypeError('Translation catalog entries need an English reference.');
	const origins = options.origins ? new Set(options.origins) : null;
	const entries = {};
	for (const [key, entry] of Object.entries(catalog.entries)) {
		if (!Object.hasOwn(englishCopy, key) || !Array.isArray(entry)) continue;
		const [origin, source, translation] = entry;
		if (!TRANSLATION_ORIGINS.includes(origin) || (origins && !origins.has(origin))) continue;
		if (source !== englishCopy[key] || !acceptableTranslation(source, translation)) continue;
		entries[key] = translation;
	}
	return Object.freeze(entries);
}

/**
 * Whether `translation` may stand in for `source`: a trimmed non-empty string
 * without ellipses that keeps the English's named placeholders, line count,
 * identifiers and file extensions.
 */
export function acceptableTranslation(source, translation) {
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

function assertTranslationCatalogShape(catalog, locale) {
	if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) throw new Error('Translation catalog must be an object.');
	if (catalog.schemaVersion !== TRANSLATION_CATALOG_SCHEMA_VERSION) throw new Error('Unsupported translation catalog schema.');
	if (typeof catalog.locale !== 'string' || normalizeBcp47Locale(catalog.locale) !== catalog.locale) {
		throw new Error('Translation catalog locale is not canonical.');
	}
	if (locale && catalog.locale !== locale) throw new Error(`Translation catalog locale ${catalog.locale} does not match ${locale}.`);
	if (!catalog.entries || typeof catalog.entries !== 'object' || Array.isArray(catalog.entries)) {
		throw new Error('Translation catalog entries must be an object.');
	}
}
