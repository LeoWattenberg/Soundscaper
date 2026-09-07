import { ENGLISH_COPY, GERMAN_COPY } from './catalogs.js';
import { localeLanguage, normalizeBcp47Locale } from './locale.js';
import { loadTranslationCatalog, sameNamedPlaceholders } from './translation-catalog.js';
import { isModuleLoadFailure } from '../offline/stale-build.ts';
import { reportStaleBuildCandidate } from '../offline/stale-build-runtime.ts';

const ELLIPSIS_PATTERN = /…|\.\.\./u;
const COPY_KEYS = new Set(Object.keys(ENGLISH_COPY));

export function normalizeLocale(candidate = 'en') {
	return normalizeBcp47Locale(candidate);
}

export function bundledCatalogForLocale(locale = 'en') {
	const normalizedLocale = normalizeLocale(locale);
	return localeLanguage(normalizedLocale) === 'de'
		? GERMAN_COPY
		: ENGLISH_COPY;
}

/**
 * Resolve copy before the editor controller is constructed: the bundled
 * catalogs, then the locale's committed translation catalog — machine
 * translations, Audacity's reviewed strings and hand-written entries in one
 * lazy chunk. A chunk that fails to load is reported through `onFallback`
 * (and to the stale-build prompt when a retired deploy took it away) and left
 * out; an existing controller is never updated in place.
 */
export async function resolveCatalog(locale, options = {}) {
	const normalizedLocale = normalizeLocale(locale);
	if (normalizedLocale === 'en') {
		return Object.freeze({ ...ENGLISH_COPY });
	}
	let translations = null;
	try {
		translations = await loadTranslationCatalog(normalizedLocale, { loaders: options.translationLoaders, englishCopy: ENGLISH_COPY });
	} catch (error) {
		if (isModuleLoadFailure(error)) (options.reportStaleBuildCandidate ?? reportStaleBuildCandidate)(error);
		options.onFallback?.(error);
	}
	return mergeCatalog(normalizedLocale, translations);
}

/**
 * Compose a catalog from its layers, lowest priority first: English, the
 * bundled German catalog for German locales, and the locale's translations.
 */
export function mergeCatalog(locale, translations = {}) {
	const bundled = bundledCatalogForLocale(locale);
	return Object.freeze({
		...ENGLISH_COPY,
		...(bundled === GERMAN_COPY ? GERMAN_COPY : {}),
		...validateMessages(translations || {}),
	});
}

function validateMessages(messages) {
	if (!isPlainObject(messages)) throw new Error('Translation messages must be an object.');
	const result = {};
	for (const [key, value] of Object.entries(messages)) {
		if (!COPY_KEYS.has(key)) throw new Error(`Translation catalog contains an unknown key: ${key}.`);
		if (typeof value !== 'string' || !value.trim()) throw new Error(`Translation value for ${key} must be a non-empty string.`);
		if (ELLIPSIS_PATTERN.test(value)) throw new Error(`Translation value for ${key} contains an ellipsis.`);
		if (!sameNamedPlaceholders(ENGLISH_COPY[key], value)) {
			throw new Error(`Translation value for ${key} changes its named placeholders.`);
		}
		result[key] = value;
	}
	return Object.freeze(result);
}

function isPlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
