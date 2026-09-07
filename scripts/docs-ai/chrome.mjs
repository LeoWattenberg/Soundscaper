/* SPDX-License-Identifier: AGPL-3.0-only */

// Translating the handbook's navigation copy.
//
// A page's sidebar entry is its own frontmatter title and translates with the
// page. What is left is the copy the site is configured with — the site title
// and the sidebar headings — which `scripts/lib/handbook-chrome.mjs` owns and
// this writes one catalog of per language. The strings are short and few, so
// they go in one closed packet per run rather than a request per label, and
// the answer is held to the same rules a page is: the requested keys and
// nothing else, no invented punctuation, and prose that is actually in the
// language it was asked for.

import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

import {
	HANDBOOK_CHROME_COPY,
	HANDBOOK_CHROME_DIRECTORY,
	HANDBOOK_CHROME_PROMPT_VERSION,
	assertChromeCatalog,
	assessChromeCatalog,
	chromeCatalogPath,
	readChromeCatalog,
} from '../lib/handbook-chrome.mjs';
import { asInvalidModelOutput, generateValidated } from './generation.mjs';
import { readCache, writeCache } from './cache.mjs';
import { assertDocumentationLocale, assertLocale, targetLanguageName } from './locale.mjs';
import { sha256 } from './provenance.mjs';

export const CHROME_SYSTEM_PROMPT = `You translate the navigation of the Soundscaper handbook, the documentation of a browser-based multitrack audio and video editor in the tradition of Audacity, from English into the requested language.
The request is a closed packet. Translate every entry of "labels" and nothing else. Return JSON with exactly two fields: "locale", the requested target locale, and "translations", an object with exactly the same keys as "labels" whose values are the translated labels.
Rules:
- These are navigation headings. Keep them short, in the register documentation navigation uses in the target language, and follow that language's conventions for capitalisation.
- Keep the product names Soundscaper, Framescaper, Audacity, Nyquist and StaffPad, and technical names such as Nyquist plug-ins, unless the target language has an established translation for them.
- Never add an ellipsis, a full stop, or any explanation. A label that is only a product name stays exactly as it is.`;

/** Names a translation must not change: the products and technologies the handbook documents. */
const PROTECTED_NAMES = Object.freeze(['Soundscaper', 'Framescaper', 'Audacity', 'Nyquist', 'StaffPad']);
/** Labels per request; the whole navigation is a few dozen short strings. */
export const DEFAULT_CHROME_BATCH_SIZE = 12;
const MAXIMUM_LABEL_GROWTH = 3;

export function chromePacket({ targetLocale, targetLanguage, labels }) {
	return JSON.stringify({ sourceLocale: 'en', targetLocale, targetLanguage, labels });
}

export function validateChromeResponse(response, { targetLocale, labels }) {
	try {
		if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error('The response must be a JSON object.');
		if (response.locale !== targetLocale) throw new Error(`The response locale must be "${targetLocale}".`);
		const translations = response.translations;
		if (!translations || typeof translations !== 'object' || Array.isArray(translations)) {
			throw new Error('The response must carry a "translations" object.');
		}
		const expected = Object.keys(labels);
		const missing = expected.filter((key) => !Object.hasOwn(translations, key));
		if (missing.length) throw new Error(`Missing translations for: ${missing.slice(0, 5).join(', ')}.`);
		const unexpected = Object.keys(translations).filter((key) => !Object.hasOwn(labels, key));
		if (unexpected.length) throw new Error(`Unexpected keys: ${unexpected.slice(0, 5).join(', ')}.`);
		const result = {};
		for (const key of expected) {
			const source = labels[key];
			const value = translations[key];
			if (typeof value !== 'string') throw new Error(`"${key}" must be a string.`);
			const label = value.replace(/\s*(?:…|\.\.\.)\s*$/u, '').trim();
			if (!label) throw new Error(`"${key}" must not be empty.`);
			if (label.includes('\n')) throw new Error(`"${key}" must stay on one line.`);
			if (PROTECTED_NAMES.includes(source) && label !== source) throw new Error(`"${key}" must stay "${source}".`);
			for (const name of PROTECTED_NAMES) {
				if (source.includes(name) && !label.includes(name)) throw new Error(`"${key}" must keep ${name} unchanged.`);
			}
			if (label.length > Math.max(source.length * MAXIMUM_LABEL_GROWTH, source.length + 40)) {
				throw new Error(`"${key}" is far longer than its English.`);
			}
			result[key] = label;
		}
		assertLocale(Object.values(result).join('. '), targetLocale);
		return result;
	} catch (error) {
		throw asInvalidModelOutput(error);
	}
}

/** One catalog file per language, keys sorted so a diff stays reviewable. */
export function serializeChromeCatalog({ locale, provenance, entries }) {
	const keys = Object.keys(entries).sort();
	const lines = keys.map((key) => `\t\t${JSON.stringify(key)}: ${JSON.stringify(entries[key])}`);
	return [
		'{',
		`\t"locale": ${JSON.stringify(locale)},`,
		`\t"provenance": ${JSON.stringify(provenance)},`,
		'\t"entries": {',
		lines.join(',\n'),
		'\t}',
		'}',
		'',
	].join('\n');
}

export async function writeChromeCatalog(catalog, directory = HANDBOOK_CHROME_DIRECTORY) {
	const path = chromeCatalogPath(catalog.locale, directory);
	if (!Object.keys(catalog.entries).length) {
		await rm(path, { force: true });
		return path;
	}
	assertChromeCatalog(catalog, catalog.locale);
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	await writeFile(temporary, serializeChromeCatalog(catalog), { flag: 'wx' });
	try {
		await rename(temporary, path);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
	return path;
}

/** Translate whatever one language's navigation catalog is missing or has fallen behind on. */
export async function translateChrome(options) {
	const locale = assertDocumentationLocale(options.locale);
	const directory = options.directory ?? HANDBOOK_CHROME_DIRECTORY;
	const existing = readChromeCatalog(locale, directory);
	const assessment = assessChromeCatalog(existing);
	const summary = {
		locale,
		labels: Object.keys(HANDBOOK_CHROME_COPY).length,
		current: assessment.current.length,
		translated: 0,
		orphaned: assessment.orphaned,
		skipped: [],
	};
	// An orphaned entry is dropped even when nothing else is owed, so a heading
	// that has been removed stops being carried in every language.
	const entries = Object.fromEntries(assessment.current.map((key) => [key, existing.entries[key]]));
	if (!assessment.pending.length) {
		if (assessment.orphaned.length) await writeChromeCatalog({ ...existing, entries }, directory);
		return summary;
	}
	const identity = await options.client.identity();
	const size = options.batchSize ?? DEFAULT_CHROME_BATCH_SIZE;
	for (let index = 0; index < assessment.pending.length; index += size) {
		const keys = assessment.pending.slice(index, index + size);
		try {
			const translations = await translateLabels({ ...options, locale, keys, identity });
			for (const [key, translation] of Object.entries(translations)) entries[key] = [HANDBOOK_CHROME_COPY[key], translation];
			summary.translated += keys.length;
		} catch (error) {
			// A batch the model cannot answer leaves those headings in English
			// rather than stopping the language.
			summary.skipped.push({ keys, reason: error.message });
		}
		await writeChromeCatalog({
			locale,
			provenance: { model: identity.model, modelDigest: identity.digest, promptVersion: HANDBOOK_CHROME_PROMPT_VERSION },
			entries,
		}, directory);
	}
	return summary;
}

async function translateLabels({ locale, keys, identity, client, cacheDirectory }) {
	const labels = Object.fromEntries(keys.map((key) => [key, HANDBOOK_CHROME_COPY[key]]));
	const prompt = chromePacket({ targetLocale: locale, targetLanguage: targetLanguageName(locale), labels });
	const cacheIdentity = {
		operation: 'handbook-chrome',
		modelDigest: identity.digest,
		promptVersion: HANDBOOK_CHROME_PROMPT_VERSION,
		sourceSha256: sha256(prompt),
		targetLocale: locale,
	};
	const validate = (candidate) => validateChromeResponse(candidate, { targetLocale: locale, labels });
	const cached = cacheDirectory ? await readCache(cacheDirectory, cacheIdentity) : null;
	if (cached) {
		try {
			return validate(cached);
		} catch (error) {
			if (!(error instanceof Error)) throw error;
			// A cached answer written under an older rule is generated again.
		}
	}
	const generated = await generateValidated({ client, system: CHROME_SYSTEM_PROMPT, prompt, validate });
	if (cacheDirectory) await writeCache(cacheDirectory, cacheIdentity, generated.response);
	return generated.value;
}
