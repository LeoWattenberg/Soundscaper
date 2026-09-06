/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import { createOllamaClient } from '../docs-ai/ollama.mjs';
import { COMMITTED_LOCALE_TAGS } from '../../src/common/i18n/locales.js';
import { assertMachineCatalogLocale, listMachineCatalogLocales } from './catalog.mjs';
import {
	DEFAULT_BATCH_SIZE,
	checkLocales,
	defaultModelForLocale,
	loadGlossary,
	translateLocale,
} from './workflows.mjs';

const HELP = `Usage:
  node scripts/i18n-ai.mjs translate (--locale fr[,es] | --all) [--model MODEL] [--batch-size ${DEFAULT_BATCH_SIZE}] [--glossary SNAPSHOT_DIR | --no-glossary] [--keys key1,key2]
  node scripts/i18n-ai.mjs check [--locale fr[,es]] [--strict]

translate writes src/common/i18n/machine/<locale>.json for every key the current English copy has and the
catalog lacks or holds a stale translation of, then regenerates the loader index. check reports each catalog
against the current English copy; --strict fails when anything is stale, missing, orphaned or invalid.`;

export function parseCliArguments(argv) {
	const [command, ...rest] = argv;
	if (!['translate', 'check'].includes(command)) throw new Error(HELP);
	const options = { command, all: false, strict: false, glossary: 'published' };
	for (let index = 0; index < rest.length; index += 1) {
		const argument = rest[index];
		if (argument === '--all') { options.all = true; continue; }
		if (argument === '--strict') { options.strict = true; continue; }
		if (argument === '--no-glossary') { options.glossary = 'none'; continue; }
		if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}\n\n${HELP}`);
		const value = rest[index + 1];
		if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
		index += 1;
		if (argument === '--locale') options.locales = value.split(',').map((locale) => locale.trim()).filter(Boolean);
		else if (argument === '--model') options.model = value;
		else if (argument === '--batch-size') options.batchSize = Number(value);
		else if (argument === '--glossary') options.glossary = value;
		else if (argument === '--keys') options.keys = value.split(',').map((key) => key.trim()).filter(Boolean);
		else if (argument === '--cache-dir') options.cacheDirectory = value;
		else throw new Error(`Unknown option ${argument}.\n\n${HELP}`);
	}
	if (options.command === 'translate' && !options.all && !options.locales?.length) {
		throw new Error(`translate needs --locale or --all.\n\n${HELP}`);
	}
	if (options.all && options.locales) throw new Error('--all and --locale cannot be combined.');
	return options;
}

/** The committed route locales a machine catalog may serve. */
export function machineTranslatableLocales(locales = COMMITTED_LOCALE_TAGS) {
	return locales.filter((locale) => {
		try {
			assertMachineCatalogLocale(locale);
			return true;
		} catch {
			return false;
		}
	});
}

export async function runCli(argv, io = {}) {
	const env = io.env ?? process.env;
	const stdout = io.stdout ?? process.stdout;
	const stderr = io.stderr ?? process.stderr;
	const options = parseCliArguments(argv);
	if (options.command === 'check') {
		const locales = options.locales ?? await listMachineCatalogLocales(io.directory);
		const reports = await checkLocales({ locales, directory: io.directory });
		let failed = false;
		for (const report of reports) {
			if (report.invalid) {
				failed = true;
				stdout.write(`${report.locale}: invalid — ${report.invalid}\n`);
				continue;
			}
			if (!report.present) {
				failed = true;
				stdout.write(`${report.locale}: no machine catalog\n`);
				continue;
			}
			const pending = report.stale + report.missing + report.orphaned + (report.outdated ? 1 : 0);
			if (options.strict && pending > 0) failed = true;
			stdout.write(`${report.locale}: ${report.current} current, ${report.stale} stale, ${report.missing} missing, ${report.orphaned} orphaned${report.outdated ? ', prompt outdated' : ''} (${report.model})\n`);
		}
		if (failed) process.exitCode = 1;
		return reports;
	}

	const locales = options.all ? machineTranslatableLocales() : options.locales.map(assertMachineCatalogLocale);
	const cacheDirectory = resolve(options.cacheDirectory ?? env.DOCS_AI_CACHE_DIR ?? '.docs-ai-cache');
	const summaries = [];
	for (const locale of locales) {
		const model = options.model ?? env.OLLAMA_I18N_MODEL ?? defaultModelForLocale(locale);
		const client = io.client ?? createOllamaClient({ role: 'translate', model, env });
		stderr.write(`${locale}: translating with ${model}\n`);
		const glossary = await resolveGlossary(locale, options, { env, stderr, fetchImpl: io.fetchImpl });
		const summary = await translateLocale({
			locale,
			client,
			cacheDirectory,
			glossary,
			batchSize: options.batchSize,
			keys: options.keys,
			directory: io.directory,
			log: (line) => stderr.write(`${line}\n`),
		});
		summaries.push(summary);
		stdout.write(`${locale}: translated ${summary.translated}, retained ${summary.retained}, skipped ${summary.skipped.length}, dropped ${summary.orphaned} orphaned (${summary.requests} requests, ${summary.cached} cached)\n`);
		for (const { key, reason } of summary.skipped) stdout.write(`  skipped ${key}: ${reason}\n`);
	}
	return summaries;
}

async function resolveGlossary(locale, options, { env, stderr, fetchImpl }) {
	if (options.glossary === 'none') return [];
	try {
		const glossary = options.glossary === 'published'
			? await loadGlossary({ locale, baseUrl: env.PUBLIC_TRANSLATIONS_BASE_URL, fetchImpl })
			: await loadGlossary({ locale, snapshotDirectory: resolve(options.glossary) });
		stderr.write(`${locale}: glossary of ${glossary.length} Audacity-reviewed strings\n`);
		return glossary;
	} catch (error) {
		if (options.glossary !== 'published') throw error;
		stderr.write(`${locale}: continuing without a glossary (${error.message})\n`);
		return [];
	}
}

export { HELP };
