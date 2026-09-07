/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Which languages the handbook is published in.
 *
 * The answer is the content tree itself: English lives at the root of
 * `handbook/src/content/docs`, and every committed route locale that has a
 * directory beside it is a language the handbook serves. Nothing has to be
 * registered anywhere for a new language to appear — translating its pages is
 * what publishes it, and deleting the directory is what withdraws it — so the
 * Astro configuration, the content check and the translator can never disagree
 * about which languages exist.
 *
 * Starlight fills a page a locale does not yet have with the English one, so a
 * language may be published while its translation is still being written. That
 * is the normal state: a locale is added the moment its first pages land.
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { COMMITTED_LOCALE_TAGS, LOCALE_BY_TAG } from '../../src/common/i18n/locales.js';

/** The English pages, which sit at the root of the content tree rather than in a directory. */
export const HANDBOOK_SOURCE_LOCALE = 'en';
export const HANDBOOK_CONTENT_DIRECTORY = fileURLToPath(new URL('../../handbook/src/content/docs/', import.meta.url));

/** Locale tags a translation directory may be named after: every committed route locale but English. */
const TRANSLATABLE_LOCALES = Object.freeze(COMMITTED_LOCALE_TAGS.filter((locale) => locale !== HANDBOOK_SOURCE_LOCALE));

/**
 * A locale's directory and route segment.
 *
 * Astro lowercases the slug it derives from a content path, and Starlight
 * matches a page to a language by that slug's first segment, so a directory
 * named `pt-BR` is read as an English page filed under `pt-br` rather than as
 * Portuguese. The segment is therefore the lowercased tag, while the canonical
 * tag stays the language the document declares.
 */
const LOCALE_BY_SEGMENT = new Map(TRANSLATABLE_LOCALES.map((locale) => [locale.toLowerCase(), locale]));

export function handbookLocaleSegment(locale) {
	return locale.toLowerCase();
}

/** The locale a directory or route segment names, or null when it names no language. */
export function handbookLocaleForSegment(segment) {
	return LOCALE_BY_SEGMENT.get(segment) ?? null;
}

/**
 * The locale a content file belongs to, from its path under the content root.
 *
 * A first segment that names a translation directory is that locale; anything
 * else is an English page, including a directory that merely looks like a
 * locale tag but is not one the editor serves.
 */
export function handbookLocaleForPath(relativePath) {
	const [first] = String(relativePath).split(/[/\\]/u);
	return LOCALE_BY_SEGMENT.get(first) ?? HANDBOOK_SOURCE_LOCALE;
}

/** The path a locale's pages live under, relative to the content root. English is the root itself. */
export function handbookLocaleDirectory(locale) {
	return locale === HANDBOOK_SOURCE_LOCALE ? '' : `${handbookLocaleSegment(locale)}/`;
}

/** The route prefix a locale's pages are served under, below the handbook's base path. */
export function handbookLocaleRoute(locale) {
	return locale === HANDBOOK_SOURCE_LOCALE ? '/' : `/${handbookLocaleSegment(locale)}/`;
}

/** The translation directories that exist, in the editor's own locale order. */
export function handbookTranslationLocales(directory = HANDBOOK_CONTENT_DIRECTORY) {
	let entries;
	try {
		entries = readdirSync(directory, { withFileTypes: true });
	} catch (error) {
		if (error?.code === 'ENOENT') return [];
		throw error;
	}
	const present = new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
	return TRANSLATABLE_LOCALES.filter((locale) => present.has(handbookLocaleSegment(locale)));
}

/** Every language the handbook publishes, English first, as descriptors the site can render. */
export function handbookLocales(directory = HANDBOOK_CONTENT_DIRECTORY) {
	return [HANDBOOK_SOURCE_LOCALE, ...handbookTranslationLocales(directory)].map((locale) => {
		const descriptor = LOCALE_BY_TAG[locale];
		if (!descriptor) throw new Error(`Unknown handbook locale: ${locale}`);
		return Object.freeze({
			locale,
			label: descriptor.nativeName,
			lang: locale,
			dir: descriptor.direction,
			segment: handbookLocaleSegment(locale),
			route: handbookLocaleRoute(locale),
		});
	});
}

/**
 * The `locales` map Starlight is configured with.
 *
 * English is the `root` entry, which is what puts its pages at the base path
 * with no language segment and makes them the fallback for every other
 * language. Every other key is a directory name, which Astro has already
 * lowercased by the time Starlight reads it, while `lang` keeps the canonical
 * tag so the document declares the language the editor knows it by.
 */
export function starlightLocaleConfig(directory = HANDBOOK_CONTENT_DIRECTORY) {
	const config = {};
	for (const { locale, label, lang, dir, segment } of handbookLocales(directory)) {
		const entry = { label, lang, dir };
		if (locale === HANDBOOK_SOURCE_LOCALE) config.root = entry;
		else config[segment] = entry;
	}
	return config;
}
