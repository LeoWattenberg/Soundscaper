/* SPDX-License-Identifier: AGPL-3.0-only */

// Translating the handbook, one language at a time.
//
// The English pages under `handbook/src/content/docs` are the source, and a
// language is a directory of the same tree beside them. A run translates only
// what that language is missing or has fallen behind on, writes each page as it
// finishes so an interrupted run resumes where it stopped, and reports a page
// the model could not answer acceptably instead of stopping the language for
// it — a handbook of a hundred pages must not be held up by one.
//
// Nothing here decides which languages exist: `scripts/lib/handbook-locales.mjs`
// reads that from the directories present, so the first page written for a
// language is what publishes it.

import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import {
	HANDBOOK_CONTENT_DIRECTORY,
	HANDBOOK_SOURCE_LOCALE,
	handbookLocaleDirectory,
	handbookLocaleForPath,
	handbookTranslationLocales,
} from '../lib/handbook-locales.mjs';
import { assertDocumentationLocale } from './locale.mjs';
import { checkTranslation, translateDocument } from './workflows.mjs';

/** A page's state in one language, in the order a run acts on it. */
export const TRANSLATION_STATES = Object.freeze(['missing', 'stale', 'invalid', 'current']);

/** Every English page, as paths relative to the content root, in a stable order. */
export async function listHandbookPages(root = HANDBOOK_CONTENT_DIRECTORY) {
	const pages = [];
	const walk = async (directory, prefix) => {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				if (!prefix && handbookLocaleForPath(path) !== HANDBOOK_SOURCE_LOCALE) continue;
				await walk(join(directory, entry.name), path);
			} else if (entry.isFile() && entry.name.endsWith('.md')) {
				pages.push(path);
			}
		}
	};
	await walk(root, '');
	return pages.sort();
}

/** The translations a language carries that no English page answers to any more. */
export async function listOrphanedTranslations(locale, root = HANDBOOK_CONTENT_DIRECTORY) {
	const directory = join(root, handbookLocaleDirectory(locale));
	let translated;
	try {
		translated = await listHandbookPages(directory);
	} catch (error) {
		if (error?.code === 'ENOENT') return [];
		throw error;
	}
	const english = new Set(await listHandbookPages(root));
	return translated.filter((page) => !english.has(page));
}

/**
 * What one page owes a language.
 *
 * A translation whose structure no longer matches its source is `invalid` and
 * is written again: it is either the output of a rule the checker has since
 * tightened, or a page somebody edited by hand into something the source no
 * longer says.
 */
export async function translationState({ sourcePath, targetPath }) {
	try {
		const result = await checkTranslation({ sourcePath, targetPath });
		if (result.status === 'current') return { status: 'current' };
		return { status: result.status === 'missing-target' ? 'missing' : 'stale', reason: result.status };
	} catch (error) {
		return { status: 'invalid', reason: error.message };
	}
}

function pagePaths(root, locale, page) {
	return {
		sourcePath: join(root, ...page.split('/')),
		targetPath: join(root, handbookLocaleDirectory(locale), ...page.split('/')),
	};
}

/** Translate everything one language is missing or has fallen behind on. */
export async function translateHandbook(options) {
	const locale = assertDocumentationLocale(options.locale);
	if (locale === HANDBOOK_SOURCE_LOCALE) throw new Error('The English pages are the source and are not translated.');
	const root = options.root ?? HANDBOOK_CONTENT_DIRECTORY;
	const log = options.log ?? (() => {});
	const pages = (await listHandbookPages(root)).filter((page) => !options.pages || options.pages.includes(page));
	const summary = {
		locale,
		pages: pages.length,
		current: 0,
		translated: 0,
		skipped: [],
		orphaned: await listOrphanedTranslations(locale, root),
	};
	let handled = 0;
	for (const page of pages) {
		const paths = pagePaths(root, locale, page);
		handled += 1;
		const state = await translationState(paths);
		if (state.status === 'current') {
			summary.current += 1;
			continue;
		}
		try {
			await translateDocument({
				...paths,
				targetLocale: locale,
				client: options.client,
				cacheDirectory: options.cacheDirectory,
				maxChunkChars: options.maxChunkChars,
			});
			summary.translated += 1;
		} catch (error) {
			// One page the model cannot answer acceptably is one page, not a
			// language: it is named and the run carries on to the next.
			summary.skipped.push({ page, reason: error.message });
		}
		log(`${locale}: ${handled}/${pages.length} pages handled (${summary.translated} translated, ${summary.skipped.length} skipped)`);
	}
	return summary;
}

/** What each language owes, without contacting a model or writing anything. */
export async function checkHandbook(options = {}) {
	const root = options.root ?? HANDBOOK_CONTENT_DIRECTORY;
	const locales = options.locales ?? handbookTranslationLocales(root);
	const pages = await listHandbookPages(root);
	const reports = [];
	for (const locale of locales) {
		assertDocumentationLocale(locale);
		const counts = { current: 0, stale: 0, missing: 0, invalid: 0 };
		const invalid = [];
		for (const page of pages) {
			const state = await translationState(pagePaths(root, locale, page));
			counts[state.status] += 1;
			if (state.status === 'invalid') invalid.push({ page, reason: state.reason });
		}
		reports.push({
			locale,
			pages: pages.length,
			...counts,
			invalidPages: invalid,
			orphaned: await listOrphanedTranslations(locale, root),
		});
	}
	return reports;
}

/** Remove the translations a language carries for English pages that no longer exist. */
export async function pruneOrphanedTranslations(locale, root = HANDBOOK_CONTENT_DIRECTORY) {
	const orphaned = await listOrphanedTranslations(locale, root);
	for (const page of orphaned) {
		await rm(join(root, handbookLocaleDirectory(locale), ...page.split('/')), { force: true });
	}
	await pruneEmptyDirectories(join(root, handbookLocaleDirectory(locale)));
	return orphaned;
}

async function pruneEmptyDirectories(directory) {
	let entries;
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (error?.code === 'ENOENT') return true;
		throw error;
	}
	let empty = true;
	for (const entry of entries) {
		if (entry.isDirectory() && await pruneEmptyDirectories(join(directory, entry.name))) continue;
		empty = false;
	}
	if (empty) await rm(directory, { recursive: true, force: true });
	return empty;
}
