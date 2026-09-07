/* SPDX-License-Identifier: AGPL-3.0-only */

// Translating with answers produced elsewhere. `packets` writes the closed
// packets a run would send for a locale's pending keys, one JSON file per
// batch, so another translator — a person, a hosted model, an agent — can
// answer them; `--answers` replays those answers through the same validation,
// retry-by-splitting and provenance as a live model, so the catalog that
// results is held to exactly what the local model's is.

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { InvalidModelOutputError } from '../docs-ai/generation.mjs';
import { ENGLISH_COPY, GERMAN_COPY } from '../../src/common/i18n/catalogs.js';
import {
	TRANSLATION_CATALOG_DIRECTORY,
	assertMachineTranslatableLocale,
	assessTranslationCatalog,
	readTranslationCatalog,
} from './catalog.mjs';
import { MACHINE_TRANSLATION_PROMPT_VERSION, targetLanguageName, translationPacket } from './prompt.mjs';
import {
	DEFAULT_BATCH_CHARACTERS,
	DEFAULT_BATCH_SIZE,
	MACHINE_TRANSLATION_EXCLUDED_KEYS,
	batches,
} from './workflows.mjs';

/** Write one packet file per batch of a locale's pending keys; returns what was written. */
export async function writeTranslationPackets(options) {
	const locale = assertMachineTranslatableLocale(options.locale);
	const englishCopy = options.englishCopy ?? ENGLISH_COPY;
	const germanCopy = options.germanCopy ?? GERMAN_COPY;
	const excluded = new Set(options.excludedKeys ?? MACHINE_TRANSLATION_EXCLUDED_KEYS);
	const existing = await readTranslationCatalog(locale, options.directory ?? TRANSLATION_CATALOG_DIRECTORY);
	const assessment = assessTranslationCatalog(existing, englishCopy, { promptVersion: MACHINE_TRANSLATION_PROMPT_VERSION, excludedKeys: excluded });
	const pending = assessment.pending.filter((key) => !options.keys || options.keys.includes(key));
	const outputDirectory = join(options.outputDirectory, locale);
	await mkdir(outputDirectory, { recursive: true });
	const files = [];
	const targetLanguage = targetLanguageName(locale);
	const grouped = batches(pending, englishCopy, options.batchSize ?? DEFAULT_BATCH_SIZE, options.batchCharacters ?? DEFAULT_BATCH_CHARACTERS);
	for (const [index, keys] of grouped.entries()) {
		const messages = Object.fromEntries(keys.map((key) => [key, englishCopy[key]]));
		const reference = Object.fromEntries(keys
			.filter((key) => typeof germanCopy[key] === 'string' && germanCopy[key] !== englishCopy[key])
			.map((key) => [key, germanCopy[key]]));
		const packet = translationPacket({ targetLocale: locale, targetLanguage, glossary: options.glossary ?? [], reference, messages });
		const file = join(outputDirectory, `${String(index + 1).padStart(3, '0')}.json`);
		await writeFile(file, `${packet}\n`);
		files.push(file);
	}
	return { locale, pending: pending.length, batches: grouped.length, files };
}

/**
 * Every answer under `<directory>/<locale>/`, merged in file-name order so a
 * later file corrects an earlier one. A file is either the packet answer
 * shape, `{ locale, translations }`, or a bare key-to-text object.
 */
export async function readAnswers(directory, locale) {
	const answersDirectory = join(directory, locale);
	let names;
	try {
		names = (await readdir(answersDirectory)).filter((name) => name.endsWith('.json')).sort();
	} catch (error) {
		if (error?.code === 'ENOENT') return new Map();
		throw error;
	}
	const answers = new Map();
	for (const name of names) {
		const file = join(answersDirectory, name);
		let parsed;
		try {
			parsed = JSON.parse(await readFile(file, 'utf8'));
		} catch (error) {
			throw new Error(`Answer file is not valid JSON: ${file}`, { cause: error });
		}
		const translations = parsed && typeof parsed === 'object' && parsed.translations && typeof parsed.translations === 'object'
			? parsed.translations
			: parsed;
		if (!translations || typeof translations !== 'object' || Array.isArray(translations)) throw new Error(`Answer file has no translations object: ${file}`);
		if (parsed.locale !== undefined && parsed.locale !== locale) throw new Error(`Answer file ${file} is for locale ${parsed.locale}, not ${locale}.`);
		for (const [key, value] of Object.entries(translations)) answers.set(key, value);
	}
	return answers;
}

/**
 * A client that answers every packet from a fixed set of answers. A batch is
 * answered with whatever keys it has, so the run's validation names the keys
 * that are missing or wrong and its halving isolates them the way it would
 * with a live model; the identity names the translator for the provenance.
 */
export function createAnswersClient({ locale, answers, model = 'external' }) {
	const digest = `sha256:${createHash('sha256').update(JSON.stringify([...answers].sort())).digest('hex')}`;
	return {
		async identity() {
			return { model, digest };
		},
		async generateJson({ prompt }) {
			const packet = JSON.parse(prompt.split('\n\nPrevious response failed validation:')[0]);
			const translations = {};
			for (const key of Object.keys(packet.messages ?? {})) {
				if (answers.has(key)) translations[key] = answers.get(key);
			}
			if (!Object.keys(translations).length) throw new InvalidModelOutputError(`No answer for ${Object.keys(packet.messages ?? {}).join(', ')}.`);
			return { locale, translations };
		},
	};
}
