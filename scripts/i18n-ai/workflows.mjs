/* SPDX-License-Identifier: AGPL-3.0-only */

// Translating one locale's pending keys and reporting a locale's state. A run
// translates only what the current English copy lacks — keys with no entry,
// keys whose recorded English has changed, and every key once the prompt has
// moved on — in sorted batches bounded by characters as well as by count,
// writes the catalog after every batch so an interrupted run resumes where it
// stopped, and caches every answer by the exact packet it came from. A batch
// the model cannot answer acceptably in three attempts, or not within the
// request timeout, is split until the one key that resists is skipped and
// named, so one string never blocks a locale.

import { InvalidModelOutputError, generateValidated } from '../docs-ai/generation.mjs';
import { readCache, writeCache } from '../docs-ai/cache.mjs';
import { sha256 } from '../docs-ai/provenance.mjs';
import { ENGLISH_COPY, GERMAN_COPY } from '../../src/common/i18n/catalogs.js';
import { compareCodeUnits } from '../lib/canonical-json.mjs';
import {
	TRANSLATION_CATALOG_DIRECTORY,
	assertMachineTranslatableLocale,
	assessTranslationCatalog,
	readTranslationCatalog,
	writeTranslationCatalog,
	writeTranslationCatalogIndex,
} from './catalog.mjs';
import {
	MACHINE_TRANSLATION_PROMPT_VERSION,
	MACHINE_TRANSLATION_SYSTEM_PROMPT,
	targetLanguageName,
	translationPacket,
	validateTranslationResponse,
} from './prompt.mjs';

export const DEFAULT_BATCH_SIZE = 30;
const MAXIMUM_BATCH_SIZE = 100;
/** Characters of key names and English a batch may carry; the answer echoes both. */
export const DEFAULT_BATCH_CHARACTERS = 1_500;
/**
 * Keys that are not prose: their English is code the editor executes, and a
 * translation could only break it. They stay English (or bundled German).
 */
export const MACHINE_TRANSLATION_EXCLUDED_KEYS = Object.freeze(['nyquistPromptDefault']);
/** The user's preferred translation model, and the one that covers the languages it does not. */
export const DEFAULT_TRANSLATION_MODEL = 'aya-expanse:32b';
export const FALLBACK_TRANSLATION_MODEL = 'qwen3.8:latest';
const AYA_EXPANSE_LANGUAGES = new Set([
	'ar', 'zh', 'cs', 'nl', 'en', 'fr', 'de', 'el', 'he', 'hi', 'id', 'it', 'ja', 'ko', 'fa', 'pl', 'pt', 'ro', 'ru', 'es', 'tr', 'uk', 'vi',
]);

/** The model a locale is translated with when none is named: Aya where it speaks the language. */
export function defaultModelForLocale(locale) {
	return AYA_EXPANSE_LANGUAGES.has(new Intl.Locale(locale).language) ? DEFAULT_TRANSLATION_MODEL : FALLBACK_TRANSLATION_MODEL;
}

export async function translateLocale(options) {
	const locale = assertMachineTranslatableLocale(options.locale);
	const englishCopy = options.englishCopy ?? ENGLISH_COPY;
	const germanCopy = options.germanCopy ?? GERMAN_COPY;
	const directory = options.directory ?? TRANSLATION_CATALOG_DIRECTORY;
	const batchSize = validateBatchSize(options.batchSize ?? DEFAULT_BATCH_SIZE);
	const batchCharacters = options.batchCharacters ?? DEFAULT_BATCH_CHARACTERS;
	const log = options.log ?? (() => {});
	const existing = await readTranslationCatalog(locale, directory);
	const excluded = new Set(options.excludedKeys ?? MACHINE_TRANSLATION_EXCLUDED_KEYS);
	const assessment = assessTranslationCatalog(existing, englishCopy, { promptVersion: MACHINE_TRANSLATION_PROMPT_VERSION, excludedKeys: excluded });
	const pending = assessment.pending.filter((key) => !options.keys || options.keys.includes(key));
	const summary = {
		locale,
		retained: Object.keys(assessment.current).length,
		orphaned: assessment.orphaned.length,
		pending: pending.length,
		translated: 0,
		skipped: [],
		requests: 0,
		cached: 0,
	};
	// Every entry that still belongs is kept as it is: current entries of any
	// origin, and stale or excluded human entries, which are a person's to
	// change. Stale automatic entries and orphans of deleted English keys go.
	const entries = {};
	for (const [key, entry] of Object.entries(existing?.entries ?? {})) {
		if (!Object.hasOwn(englishCopy, key)) continue;
		const human = entry[0] === 'human';
		if (excluded.has(key) && !human) continue;
		if (Object.hasOwn(assessment.current, key) || human) entries[key] = entry;
	}
	if (!pending.length) {
		if (existing && Object.keys(existing.entries).some((key) => !Object.hasOwn(entries, key))) {
			await writeTranslationCatalog({ locale, provenance: existing.provenance, entries }, directory);
		}
		await writeTranslationCatalogIndex(directory);
		return summary;
	}
	const modelIdentity = await options.client.identity();
	const machineProvenance = {
		model: modelIdentity.model,
		modelDigest: modelIdentity.digest,
		promptVersion: MACHINE_TRANSLATION_PROMPT_VERSION,
	};
	const provenance = { ...(existing?.provenance ?? {}), machine: machineProvenance };
	// A regeneration forced by a new prompt keeps the old provenance until its
	// last batch has landed, so an interrupted run still reads as outdated and
	// resumes instead of passing off two prompts' output as one.
	const interimProvenance = assessment.outdated && existing?.provenance?.machine ? existing.provenance : provenance;
	const context = {
		locale,
		targetLanguage: targetLanguageName(locale),
		glossary: options.glossary ?? [],
		englishCopy,
		germanCopy,
		client: options.client,
		modelIdentity,
		cacheDirectory: options.cacheDirectory,
		summary,
	};
	let handled = 0;
	for (const keys of batches(pending, englishCopy, batchSize, batchCharacters)) {
		const result = await translateBatch(context, keys);
		for (const [key, translation] of Object.entries(result.translations)) entries[key] = ['machine', englishCopy[key], translation];
		summary.translated += Object.keys(result.translations).length;
		summary.skipped.push(...result.skipped);
		handled += keys.length;
		await writeTranslationCatalog({ locale, provenance: handled === pending.length ? provenance : interimProvenance, entries }, directory);
		await writeTranslationCatalogIndex(directory);
		log(`${locale}: ${handled}/${pending.length} pending keys handled (${summary.translated} translated, ${summary.skipped.length} skipped)`);
	}
	return summary;
}

/** Sorted keys in batches of at most `size` keys and about `characters` characters of key and English. */
export function batches(keys, englishCopy, size, characters) {
	const result = [];
	let batch = [];
	let length = 0;
	for (const key of keys) {
		const cost = key.length + String(englishCopy[key] ?? '').length;
		if (batch.length && (batch.length >= size || length + cost > characters)) {
			result.push(batch);
			batch = [];
			length = 0;
		}
		batch.push(key);
		length += cost;
	}
	if (batch.length) result.push(batch);
	return result;
}

async function translateBatch(context, keys) {
	const messages = Object.fromEntries(keys.map((key) => [key, context.englishCopy[key]]));
	const reference = Object.fromEntries(keys
		.filter((key) => typeof context.germanCopy[key] === 'string' && context.germanCopy[key] !== context.englishCopy[key])
		.map((key) => [key, context.germanCopy[key]]));
	const prompt = translationPacket({
		targetLocale: context.locale,
		targetLanguage: context.targetLanguage,
		glossary: context.glossary,
		reference,
		messages,
	});
	const identity = {
		operation: 'i18n-machine-translate',
		modelDigest: context.modelIdentity.digest,
		promptVersion: MACHINE_TRANSLATION_PROMPT_VERSION,
		sourceSha256: sha256(prompt),
		targetLocale: context.locale,
	};
	const validate = (candidate) => validateTranslationResponse(candidate, { targetLocale: context.locale, messages });
	const cached = context.cacheDirectory ? await readCache(context.cacheDirectory, identity) : null;
	if (cached) {
		try {
			context.summary.cached += 1;
			return { translations: validate(cached), skipped: [] };
		} catch (error) {
			if (!(error instanceof InvalidModelOutputError)) throw error;
			// A cached answer written under an older validation rule is regenerated.
		}
	}
	try {
		const generated = await generateValidated({
			client: context.client,
			system: MACHINE_TRANSLATION_SYSTEM_PROMPT,
			prompt,
			validate,
		});
		context.summary.requests += generated.attempts;
		if (context.cacheDirectory) await writeCache(context.cacheDirectory, identity, generated.response);
		return { translations: generated.value, skipped: [] };
	} catch (error) {
		// Validation exhausted its attempts, or the request outran the timeout:
		// both mean this batch is too much for the model, so it is halved.
		// Any other failure is the endpoint's and stops the run.
		if (!(error instanceof InvalidModelOutputError) && !isTimeout(error)) throw error;
		// A single key that still outruns the timeout is not too much text; the
		// endpoint has stopped answering, and the run must stop with it.
		if (isTimeout(error) && keys.length === 1) throw error;
		context.summary.requests += error instanceof InvalidModelOutputError ? 3 : 1;
		if (keys.length === 1) return { translations: {}, skipped: [{ key: keys[0], reason: error.message }] };
		const middle = Math.ceil(keys.length / 2);
		const left = await translateBatch(context, keys.slice(0, middle));
		const right = await translateBatch(context, keys.slice(middle));
		return {
			translations: { ...left.translations, ...right.translations },
			skipped: [...left.skipped, ...right.skipped],
		};
	}
}

/**
 * The Audacity-reviewed strings for a locale, as glossary rows the packet
 * carries: the catalog's own `audacity` entries.
 */
export async function loadGlossary(options) {
	const locale = options.locale;
	const englishCopy = options.englishCopy ?? ENGLISH_COPY;
	const catalog = await readTranslationCatalog(locale, options.directory ?? TRANSLATION_CATALOG_DIRECTORY);
	if (!catalog) return [];
	return Object.entries(catalog.entries)
		.filter(([key, [origin, , translation]]) => origin === 'audacity' && Object.hasOwn(englishCopy, key) && translation !== englishCopy[key])
		.map(([key, [, , translation]]) => ({ key, english: englishCopy[key], translation }))
		.sort((left, right) => compareCodeUnits(left.key, right.key));
}

/** The state of each locale's catalog against the current English copy. */
export async function checkLocales(options) {
	const englishCopy = options.englishCopy ?? ENGLISH_COPY;
	const directory = options.directory ?? TRANSLATION_CATALOG_DIRECTORY;
	const reports = [];
	for (const locale of options.locales) {
		try {
			const catalog = await readTranslationCatalog(locale, directory);
			const assessment = assessTranslationCatalog(catalog, englishCopy, {
				promptVersion: MACHINE_TRANSLATION_PROMPT_VERSION,
				excludedKeys: options.excludedKeys ?? MACHINE_TRANSLATION_EXCLUDED_KEYS,
			});
			const origins = { machine: 0, audacity: 0, human: 0 };
			for (const origin of Object.values(assessment.origins)) origins[origin] += 1;
			reports.push({
				locale,
				present: catalog !== null,
				model: catalog?.provenance.machine?.model ?? null,
				current: Object.keys(assessment.current).length,
				origins,
				stale: assessment.stale.length,
				missing: assessment.missing.length,
				orphaned: assessment.orphaned.length,
				outdated: assessment.outdated,
				invalid: null,
			});
		} catch (error) {
			reports.push({ locale, present: true, model: null, current: 0, origins: { machine: 0, audacity: 0, human: 0 }, stale: 0, missing: 0, orphaned: 0, outdated: false, invalid: error.message });
		}
	}
	return reports;
}

function isTimeout(error) {
	return error?.name === 'TimeoutError' || error?.name === 'AbortError';
}

function validateBatchSize(value) {
	if (!Number.isSafeInteger(value) || value < 1 || value > MAXIMUM_BATCH_SIZE) {
		throw new Error(`Batch size must be an integer from 1 through ${MAXIMUM_BATCH_SIZE}.`);
	}
	return value;
}
