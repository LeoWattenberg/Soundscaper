/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The committed Audacity translation layer.
 *
 * `scripts/audacity-qt-translations.mjs commit` converts the reviewed strings
 * of one upstream Audacity translation artifact into one JSON catalog per
 * locale under `./audacity/`, with the upstream commit, licence and
 * modification notice recorded beside them. At runtime a locale's catalog is
 * lazy-imported like a machine catalog and laid over it, so wherever
 * Audacity's translators have a reviewed string, theirs is the one shown.
 *
 * Like the machine layer, this module imports no catalog of its own: callers
 * pass the English copy the strings are checked against.
 */

import { AUDACITY_CATALOG_LOADERS } from './audacity/index.js';
import { normalizeBcp47Locale } from './locale.js';
import { acceptableMachineTranslation } from './machine-catalog.js';

export const AUDACITY_CATALOG_SCHEMA_VERSION = 1;

/** The catalog locale that serves `locale`: its exact canonical tag, or null. */
export function audacityCatalogLocale(locale, loaders = AUDACITY_CATALOG_LOADERS) {
	const normalized = normalizeBcp47Locale(locale);
	return Object.hasOwn(loaders, normalized) ? normalized : null;
}

/**
 * Load Audacity's reviewed strings for `locale` that may be shown against
 * `englishCopy`, or null when no catalog serves the locale. Load failures
 * propagate; the caller decides what a missing chunk means.
 */
export async function loadAudacityCatalog(locale, options = {}) {
	const loaders = options.loaders || AUDACITY_CATALOG_LOADERS;
	const catalogLocale = audacityCatalogLocale(locale, loaders);
	if (!catalogLocale) return null;
	const module = await loaders[catalogLocale]();
	const catalog = module && typeof module === 'object' && 'default' in module ? module.default : module;
	return currentAudacityMessages(catalog, options.englishCopy, { locale: catalogLocale });
}

/**
 * The messages of `catalog` that may be shown against `englishCopy`: the key
 * still exists and the string keeps the English's placeholders and shape. A
 * key the English copy has since dropped is left out rather than refused, so
 * a week-old conversion keeps serving the strings that still apply.
 */
export function currentAudacityMessages(catalog, englishCopy, options = {}) {
	assertAudacityCatalogShape(catalog, options.locale);
	if (!englishCopy || typeof englishCopy !== 'object') throw new TypeError('Audacity catalog messages need an English reference.');
	const messages = {};
	for (const [key, value] of Object.entries(catalog.messages)) {
		if (!Object.hasOwn(englishCopy, key)) continue;
		if (!acceptableMachineTranslation(englishCopy[key], value)) continue;
		messages[key] = value;
	}
	return Object.freeze(messages);
}

function assertAudacityCatalogShape(catalog, locale) {
	if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) throw new Error('Audacity catalog must be an object.');
	if (catalog.schemaVersion !== AUDACITY_CATALOG_SCHEMA_VERSION) throw new Error('Unsupported Audacity catalog schema.');
	if (typeof catalog.locale !== 'string' || normalizeBcp47Locale(catalog.locale) !== catalog.locale) {
		throw new Error('Audacity catalog locale is not canonical.');
	}
	if (locale && catalog.locale !== locale) throw new Error(`Audacity catalog locale ${catalog.locale} does not match ${locale}.`);
	if (!catalog.messages || typeof catalog.messages !== 'object' || Array.isArray(catalog.messages)) {
		throw new Error('Audacity catalog messages must be an object.');
	}
}
