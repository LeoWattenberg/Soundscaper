import { ENGLISH_COPY, GERMAN_COPY } from './catalogs.js';
import { localeLanguage, normalizeBcp47Locale } from './locale.js';
import { loadAudacityCatalog } from './audacity-catalog.js';
import { loadMachineCatalog, sameNamedPlaceholders } from './machine-catalog.js';
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
 * Resolve copy before the editor controller is constructed, from the layers
 * that serve the locale: the bundled catalogs, the machine translations this
 * repository generates, and Audacity's reviewed strings, both committed and
 * lazy-imported. The two lazy layers load together and fail apart, so a
 * missing chunk of one still yields the other. A layer that fails is
 * reported through `onFallback` and left out; an existing controller is
 * never updated in place.
 */
export async function resolveCatalog(locale, options = {}) {
	const normalizedLocale = normalizeLocale(locale);
	if (normalizedLocale === 'en') {
		return Object.freeze({ ...ENGLISH_COPY });
	}
	const [machine, messages] = await Promise.all([
		resolveMachineMessages(normalizedLocale, options),
		resolveAudacityMessages(normalizedLocale, options),
	]);
	return mergeCatalog(normalizedLocale, messages, { machine });
}

/**
 * Compose a catalog from its layers, lowest priority first: English, the
 * bundled German catalog for German locales, the machine translations, and
 * Audacity's reviewed messages, which override any key they carry.
 */
export function mergeCatalog(locale, messages = {}, layers = {}) {
	const bundled = bundledCatalogForLocale(locale);
	const validatedMessages = validateMessages(messages || {});
	return Object.freeze({
		...ENGLISH_COPY,
		...(bundled === GERMAN_COPY ? GERMAN_COPY : {}),
		...(layers.machine || {}),
		...validatedMessages,
	});
}

async function resolveMachineMessages(locale, options) {
	// The bundled German catalog is complete; nothing machine-made belongs under it.
	if (bundledCatalogForLocale(locale) === GERMAN_COPY) return null;
	return resolveLazyLayer(options, () => loadMachineCatalog(locale, { loaders: options.machineLoaders, englishCopy: ENGLISH_COPY }));
}

async function resolveAudacityMessages(locale, options) {
	return resolveLazyLayer(options, () => loadAudacityCatalog(locale, { loaders: options.audacityLoaders, englishCopy: ENGLISH_COPY }));
}

async function resolveLazyLayer(options, load) {
	try {
		return await load();
	} catch (error) {
		// A chunk a retired deploy took away is the stale-build prompt's case;
		// the layer falls away either way.
		if (isModuleLoadFailure(error)) (options.reportStaleBuildCandidate ?? reportStaleBuildCandidate)(error);
		options.onFallback?.(error);
		return null;
	}
}

function validateMessages(messages) {
	if (!isPlainObject(messages)) throw new Error('Translation messages must be an object.');
	const result = {};
	for (const [key, value] of Object.entries(messages)) {
		if (!COPY_KEYS.has(key)) throw new Error(`Translation pack contains an unknown key: ${key}.`);
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
