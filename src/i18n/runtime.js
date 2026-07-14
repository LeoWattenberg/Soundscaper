import { ENGLISH_COPY, GERMAN_COPY } from './catalogs.js';
import { localeLanguage, normalizeBcp47Locale } from './locale.js';

export const TRANSLATION_SCHEMA_VERSION = 1;
export const DEFAULT_TRANSLATIONS_BASE_URL = (
	import.meta.env?.PUBLIC_TRANSLATIONS_BASE_URL
	|| 'https://translations.soundscaper.org/runtime/translations/audacity/4/'
);

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_PACK_BYTES = 2 * 1024 * 1024;
const SHA256_PATTERN = /^(?:sha256:)?([a-f\d]{64})$/i;
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

export async function loadTranslationManifest(options = {}) {
	const baseUrl = normalizeBaseUrl(options.baseUrl || DEFAULT_TRANSLATIONS_BASE_URL);
	return withRequestTimeout(options, async (signal) => {
		const response = await fetchTranslation(new URL('latest.json', baseUrl), {
			fetchImpl: options.fetchImpl,
			signal,
			cache: 'no-store',
		});
		const manifest = await parseJsonResponse(response, MAX_MANIFEST_BYTES, 'translation manifest');
		return validateManifest(manifest, baseUrl);
	});
}

export async function loadTranslationPack(locale, descriptor, options = {}) {
	const normalizedLocale = normalizeLocale(locale);
	const baseUrl = normalizeBaseUrl(options.baseUrl || DEFAULT_TRANSLATIONS_BASE_URL);
	const validatedDescriptor = validateDescriptor(normalizedLocale, descriptor, baseUrl);
	return withRequestTimeout(options, async (signal) => {
		const response = await fetchTranslation(validatedDescriptor.url, {
			fetchImpl: options.fetchImpl,
			signal,
			cache: 'force-cache',
		});
		if (!response.ok) throw new Error(`Translation pack request failed (${response.status}).`);
		const bytes = await readBoundedResponse(response, Math.min(MAX_PACK_BYTES, validatedDescriptor.byteLength || MAX_PACK_BYTES), 'Translation pack');
		if (validatedDescriptor.byteLength != null && bytes.byteLength !== validatedDescriptor.byteLength) {
			throw new Error('Translation pack byte length does not match its manifest.');
		}
		const actualSha256 = await sha256Hex(bytes, options.cryptoImpl);
		if (actualSha256 !== validatedDescriptor.sha256) throw new Error('Translation pack digest does not match its manifest.');
		let pack;
		try {
			pack = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
		} catch {
			throw new Error('Translation pack is not valid UTF-8 JSON.');
		}
		return validatePack(pack, normalizedLocale);
	});
}

/**
 * Resolve copy before the editor controller is constructed. A failed or
 * unavailable remote catalog deliberately returns the complete bundled copy;
 * an existing controller is never updated in place.
 */
export async function resolveCatalog(locale, options = {}) {
	const normalizedLocale = normalizeLocale(locale);
	const bundled = bundledCatalogForLocale(normalizedLocale);
	if (normalizedLocale === 'en') {
		return Object.freeze({ ...ENGLISH_COPY });
	}
	try {
		const manifest = options.manifest || await loadTranslationManifest(options);
		const descriptor = manifest.locales[normalizedLocale];
		if (!descriptor?.eligible) return Object.freeze({ ...bundled });
		const messages = await loadTranslationPack(normalizedLocale, descriptor, options);
		return mergeCatalog(normalizedLocale, messages);
	} catch (error) {
		options.onFallback?.(error);
		return Object.freeze({ ...bundled });
	}
}

export function mergeCatalog(locale, messages = {}) {
	const bundled = bundledCatalogForLocale(locale);
	const validatedMessages = validateMessages(messages);
	return Object.freeze({ ...ENGLISH_COPY, ...(bundled === GERMAN_COPY ? GERMAN_COPY : {}), ...validatedMessages });
}

function validateManifest(manifest, baseUrl) {
	if (!isPlainObject(manifest)) throw new Error('Translation manifest must be an object.');
	if (manifest.schemaVersion !== TRANSLATION_SCHEMA_VERSION) throw new Error('Unsupported translation manifest schema.');
	if (!isPlainObject(manifest.locales)) throw new Error('Translation manifest locales must be an object.');
	const locales = {};
	for (const [candidate, descriptor] of Object.entries(manifest.locales)) {
		const locale = normalizeLocale(candidate);
		if (locale !== candidate) throw new Error(`Translation manifest locale is not canonical: ${candidate}.`);
		locales[locale] = Object.freeze(validateDescriptor(locale, descriptor, baseUrl));
	}
	return Object.freeze({ ...manifest, locales: Object.freeze(locales) });
}

function validateDescriptor(locale, descriptor, baseUrl) {
	if (!isPlainObject(descriptor)) throw new Error(`Translation descriptor for ${locale} must be an object.`);
	const match = String(descriptor.sha256 || '').match(SHA256_PATTERN);
	if (!match) throw new Error(`Translation descriptor for ${locale} has an invalid digest.`);
	if (descriptor.byteLength != null && (!Number.isSafeInteger(descriptor.byteLength) || descriptor.byteLength < 1 || descriptor.byteLength > MAX_PACK_BYTES)) {
		throw new Error(`Translation descriptor for ${locale} has an invalid byte length.`);
	}
	if (typeof descriptor.path !== 'string' || !descriptor.path.startsWith('packs/')) {
		throw new Error(`Translation descriptor for ${locale} has an invalid path.`);
	}
	const url = new URL(descriptor.path, baseUrl);
	if (url.origin !== baseUrl.origin || !url.pathname.startsWith(baseUrl.pathname)) {
		throw new Error(`Translation descriptor for ${locale} leaves the translation origin.`);
	}
	return {
		...descriptor,
		eligible: descriptor.eligible === true,
		sha256: match[1].toLowerCase(),
		byteLength: descriptor.byteLength ?? null,
		url,
	};
}

function validatePack(pack, locale) {
	if (!isPlainObject(pack) || pack.schemaVersion !== TRANSLATION_SCHEMA_VERSION) {
		throw new Error('Unsupported translation pack schema.');
	}
	if (normalizeLocale(pack.locale) !== locale || pack.locale !== locale) {
		throw new Error('Translation pack locale does not match its request.');
	}
	return validateMessages(pack.messages);
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

async function fetchTranslation(url, options = {}) {
	const fetchImpl = options.fetchImpl || globalThis.fetch;
	if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable.');
	return fetchImpl(url, { method: 'GET', cache: options.cache, signal: options.signal });
}

async function withRequestTimeout(options, operation) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(new DOMException('Translation request timed out.', 'TimeoutError')), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	const abort = () => controller.abort(options.signal?.reason);
	if (options.signal?.aborted) abort();
	else options.signal?.addEventListener('abort', abort, { once: true });
	try {
		return await operation(controller.signal);
	} finally {
		clearTimeout(timeout);
		options.signal?.removeEventListener('abort', abort);
	}
}

async function parseJsonResponse(response, maximumBytes, label) {
	if (!response.ok) throw new Error(`${label} request failed (${response.status}).`);
	const bytes = await readBoundedResponse(response, maximumBytes, label);
	try {
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	} catch {
		throw new Error(`${label} is not valid UTF-8 JSON.`);
	}
}

async function readBoundedResponse(response, maximumBytes, label) {
	const declaredLength = Number(response.headers.get('content-length'));
	if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new Error(`${label} is too large.`);
	if (!response.body?.getReader) {
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (!bytes.byteLength || bytes.byteLength > maximumBytes) throw new Error(`${label} has an invalid size.`);
		return bytes;
	}
	const reader = response.body.getReader();
	const chunks = [];
	let byteLength = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			byteLength += value.byteLength;
			if (byteLength > maximumBytes) throw new Error(`${label} is too large.`);
			chunks.push(value);
		}
	} catch (error) {
		await reader.cancel(error).catch(() => {});
		throw error;
	}
	if (!byteLength) throw new Error(`${label} has an invalid size.`);
	const bytes = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

async function sha256Hex(bytes, cryptoImpl = globalThis.crypto) {
	if (!cryptoImpl?.subtle) throw new Error('Web Crypto is unavailable.');
	const digest = new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', bytes));
	return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
}

function normalizeBaseUrl(candidate) {
	const url = new URL(String(candidate));
	url.pathname = `${url.pathname.replace(/\/+$/u, '')}/`;
	url.search = '';
	url.hash = '';
	return url;
}

function isPlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function sameNamedPlaceholders(source, translation) {
	const collect = (value) => [...String(value).matchAll(/\{[A-Za-z][A-Za-z0-9_]*\}/gu)].map(([placeholder]) => placeholder).sort();
	const left = collect(source);
	const right = collect(translation);
	return left.length === right.length && left.every((placeholder, index) => placeholder === right[index]);
}
