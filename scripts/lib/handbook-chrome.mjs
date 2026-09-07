/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The handbook's own navigation copy, in every language it is published in.
 *
 * A page's sidebar entry is its frontmatter title, so translating the pages
 * translates most of the navigation on its own. What is left is the copy the
 * site is configured with rather than written in: the site title, the sidebar
 * group headings, and the reference entries that are listed by hand to keep
 * their order. Starlight takes one string for the site description rather than
 * one per language, so that stays English in the configuration; the
 * description a reader sees is the page's own frontmatter, which translates
 * with the page. Those live here once, so the Astro configuration reads the same
 * strings the translator writes catalogs for and neither can drift from the
 * other.
 *
 * A catalog is read synchronously because an Astro configuration is evaluated
 * synchronously, and an entry whose recorded English no longer matches is
 * ignored rather than shown: a heading that has been rewritten falls back to
 * English until `node scripts/docs-ai.mjs handbook` writes it again.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SOUNDSCAPER_GUIDE_GROUPS } from '../../handbook/guides/soundscaper.mjs';
import { HANDBOOK_SOURCE_LOCALE, handbookLocaleForSegment, handbookLocaleSegment } from './handbook-locales.mjs';

export const HANDBOOK_CHROME_DIRECTORY = fileURLToPath(new URL('../../handbook/i18n/', import.meta.url));
export const HANDBOOK_CHROME_PROMPT_VERSION = 'docs-chrome-v1';

/** The reference pages the sidebar lists by hand, in the order it lists them. */
const REFERENCE_ENTRIES = Object.freeze({
	overview: 'Overview',
	commands: 'Commands and shortcuts',
	formats: 'Export formats',
	'product-capabilities': 'Product capabilities',
	'audio-effects': 'Audio effects',
	'video-effects': 'Video effects',
	'nyquist-plugins': 'Nyquist plug-ins',
	'macro-programs': 'Macro programs',
	'local-assistance': 'Local assistance',
	workspaces: 'Workspaces and panels',
	'project-files': 'Project and label files',
	languages: 'Languages',
	platforms: 'Platforms and packages',
});

/** Every string the site is configured with rather than written in, by key. */
export const HANDBOOK_CHROME_COPY = Object.freeze({
	'site.title': 'Soundscaper Handbook',
	'sidebar.start': 'Start here',
	'sidebar.soundscaper': 'Soundscaper',
	'sidebar.tutorials': 'Tutorials',
	'sidebar.guides': 'How-to guides',
	'sidebar.guides.all': 'All guides',
	'sidebar.framescaper': 'Framescaper',
	'sidebar.projects-and-data': 'Projects and data',
	'sidebar.help': 'Help',
	'sidebar.reference': 'Reference',
	...Object.fromEntries(SOUNDSCAPER_GUIDE_GROUPS.map((group) => [`sidebar.guides.${group.slug}`, group.title])),
	...Object.fromEntries(Object.entries(REFERENCE_ENTRIES).map(([slug, label]) => [`sidebar.reference.${slug}`, label])),
});

export const HANDBOOK_CHROME_KEYS = Object.freeze(Object.keys(HANDBOOK_CHROME_COPY).sort());

export function chromeCatalogPath(locale, directory = HANDBOOK_CHROME_DIRECTORY) {
	return join(directory, `${handbookLocaleSegment(locale)}.json`);
}

/** One language's catalog, or null when it has none. Throws on a file that is not one. */
export function readChromeCatalog(locale, directory = HANDBOOK_CHROME_DIRECTORY) {
	let raw;
	try {
		raw = readFileSync(chromeCatalogPath(locale, directory), 'utf8');
	} catch (error) {
		if (error?.code === 'ENOENT') return null;
		throw error;
	}
	let catalog;
	try {
		catalog = JSON.parse(raw);
	} catch (error) {
		throw new Error(`Handbook navigation catalog ${locale} is not valid JSON.`, { cause: error });
	}
	assertChromeCatalog(catalog, locale);
	return catalog;
}

export function assertChromeCatalog(catalog, locale) {
	if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) throw new Error(`Handbook navigation catalog ${locale} must be an object.`);
	if (catalog.locale !== locale) throw new Error(`Handbook navigation catalog ${locale} declares locale ${String(catalog.locale)}.`);
	if (!catalog.entries || typeof catalog.entries !== 'object' || Array.isArray(catalog.entries)) {
		throw new Error(`Handbook navigation catalog ${locale} entries must be an object.`);
	}
	for (const [key, entry] of Object.entries(catalog.entries)) {
		if (!Array.isArray(entry) || entry.length !== 2 || entry.some((value) => typeof value !== 'string' || !value)) {
			throw new Error(`Handbook navigation catalog ${locale} entry ${key} must be a [source, translation] pair of strings.`);
		}
	}
	return catalog;
}

/**
 * The languages that have a navigation catalog.
 *
 * A catalog stands on its own: the navigation of a language may be written
 * before its first page is, and a language whose pages have all been withdrawn
 * still answers with its own headings until its catalog is removed too.
 */
export function chromeCatalogLocales(directory = HANDBOOK_CHROME_DIRECTORY) {
	let names;
	try {
		names = readdirSync(directory).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -'.json'.length));
	} catch (error) {
		if (error?.code === 'ENOENT') return [];
		throw error;
	}
	return names.map((name) => handbookLocaleForSegment(name)).filter(Boolean).sort();
}

/**
 * What a language's catalog owes against the current English copy: `pending`
 * is what a run has to write, and an entry for copy that no longer exists is
 * `orphaned` and is dropped when the catalog is written again.
 */
export function assessChromeCatalog(catalog) {
	const entries = catalog?.entries ?? {};
	const current = [];
	const stale = [];
	const missing = [];
	for (const key of HANDBOOK_CHROME_KEYS) {
		const entry = entries[key];
		if (!entry) missing.push(key);
		else if (entry[0] !== HANDBOOK_CHROME_COPY[key]) stale.push(key);
		else current.push(key);
	}
	const orphaned = Object.keys(entries).filter((key) => !Object.hasOwn(HANDBOOK_CHROME_COPY, key)).sort();
	return Object.freeze({
		current: Object.freeze(current),
		stale: Object.freeze(stale),
		missing: Object.freeze(missing),
		orphaned: Object.freeze(orphaned),
		pending: Object.freeze([...missing, ...stale].sort()),
	});
}

/**
 * What each language calls one piece of navigation copy, keyed by the language
 * tag Starlight looks these up by rather than by the directory a language
 * lives in.
 *
 * An entry written for English that has since been rewritten is left out, so
 * the language shows the current English rather than a translation of copy
 * that no longer exists.
 */
export function chromeTranslations(key, directory = HANDBOOK_CHROME_DIRECTORY) {
	const source = HANDBOOK_CHROME_COPY[key];
	if (source === undefined) throw new Error(`Unknown handbook navigation key: ${key}`);
	const translations = {};
	for (const locale of chromeCatalogLocales(directory)) {
		const entry = readChromeCatalog(locale, directory)?.entries[key];
		if (entry && entry[0] === source) translations[locale] = entry[1];
	}
	return translations;
}

/** A sidebar entry's label, with the languages that have one of their own. */
export function chromeLabel(key, directory = HANDBOOK_CHROME_DIRECTORY) {
	const translations = chromeTranslations(key, directory);
	const label = HANDBOOK_CHROME_COPY[key];
	return Object.keys(translations).length ? { label, translations } : { label };
}

/** A site-level string as the record Starlight reads: one entry per language tag. */
export function chromeRecord(key, directory = HANDBOOK_CHROME_DIRECTORY) {
	return { [HANDBOOK_SOURCE_LOCALE]: HANDBOOK_CHROME_COPY[key], ...chromeTranslations(key, directory) };
}
