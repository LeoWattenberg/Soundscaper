import { resolve } from 'node:path';

import { docsAiRuntimeOptions } from './config.mjs';
import { checkHandbook, pruneOrphanedTranslations, translateHandbook } from './handbook.mjs';
import { translateChrome } from './chrome.mjs';
import { handbookTranslationLocales } from '../lib/handbook-locales.mjs';
import { createOllamaClient } from './ollama.mjs';
import { checkDraft, checkTranslation, draftDocument, translateDocument } from './workflows.mjs';

const HELP = `Usage:
  node scripts/docs-ai.mjs draft --facts FACTS.json --output PAGE.md [--model MODEL] [--stdout] [--check]
  node scripts/docs-ai.mjs translate --source PAGE.md --target PAGE.de.md --locale de [--model MODEL] [--stdout] [--check]
  node scripts/docs-ai.mjs handbook (--locale fr[,es] | --all) [--model MODEL] [--pages a.md,b.md] [--prune]
  node scripts/docs-ai.mjs handbook --check [--locale fr[,es]] [--strict]

handbook translates every English page a language is missing or has fallen behind on into
handbook/src/content/docs/<language>/, one page at a time, and skips a page the model cannot
answer acceptably rather than stopping the language for it. Writing a language's first page is
what publishes it, and --all means every language that already has pages. --prune removes the
translations of English pages that no longer exist. --check reports what each language owes
without contacting Ollama; --strict then fails when anything is stale, missing or invalid.

Generation writes the output file by default. --stdout prints instead of writing.
--check validates an existing output without contacting Ollama or changing files.`;

/** Options that stand alone; everything else names a value. */
const FLAGS = Object.freeze(['--stdout', '--check', '--all', '--prune', '--strict']);

export function parseCliArguments(argv) {
	const [command, ...rest] = argv;
	if (!['draft', 'translate', 'handbook'].includes(command)) throw new Error(HELP);
	const options = { command, mode: 'write', all: false, prune: false, strict: false };
	for (let index = 0; index < rest.length; index += 1) {
		const argument = rest[index];
		if (FLAGS.includes(argument)) {
			if (argument === '--stdout') options.mode = 'stdout';
			else if (argument === '--check') options.mode = 'check';
			else options[argument.slice(2)] = true;
			continue;
		}
		if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}\n\n${HELP}`);
		const key = argument.slice(2).replace(/-([a-z])/gu, (_match, character) => character.toUpperCase());
		const value = rest[index + 1];
		if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
		options[key] = value;
		index += 1;
	}
	if (argv.includes('--stdout') && argv.includes('--check')) throw new Error('--stdout and --check cannot be combined.');
	if (options.command === 'handbook') {
		if (options.mode === 'stdout') throw new Error('handbook writes the pages it translates and has no --stdout mode.');
		if (options.all && options.locale) throw new Error('--all and --locale cannot be combined.');
		if (options.mode !== 'check' && !options.all && !options.locale) throw new Error(`handbook needs --locale or --all.\n\n${HELP}`);
	}
	return options;
}

/** The languages a handbook command acts on: those named, or those that already have pages. */
function handbookLocales(options) {
	if (options.locale) return options.locale.split(',').map((locale) => locale.trim()).filter(Boolean);
	return handbookTranslationLocales();
}

function required(options, key) {
	if (!options[key]) throw new Error(`Missing required --${key.replace(/[A-Z]/gu, (character) => `-${character.toLowerCase()}`)}.\n\n${HELP}`);
	return options[key];
}

function cacheDirectory(env) {
	return resolve(env.DOCS_AI_CACHE_DIR ?? '.docs-ai-cache');
}

export async function runCli(argv, io = {}) {
	const env = io.env ?? process.env;
	const stdout = io.stdout ?? process.stdout;
	const options = parseCliArguments(argv);
	if (options.command === 'draft') {
		const factsPath = required(options, 'facts');
		const outputPath = required(options, 'output');
		if (options.mode === 'check') {
			const result = await checkDraft({ factsPath, outputPath });
			stdout.write(`${outputPath}: ${result.status}\n`);
			if (result.status !== 'current') process.exitCode = 1;
			return result;
		}
		const client = createOllamaClient({ role: 'draft', model: options.model, env });
		const result = await draftDocument({
			factsPath,
			outputPath,
			client,
			cacheDirectory: cacheDirectory(env),
			mode: options.mode,
		});
		if (options.mode === 'stdout') stdout.write(result.document);
		else stdout.write(`Drafted ${outputPath} with ${result.provenance.model}@${result.provenance.modelDigest}.\n`);
		return result;
	}

	if (options.command === 'handbook') return runHandbookCommand(options, { env, stdout });

	const sourcePath = required(options, 'source');
	const targetPath = required(options, 'target');
	const targetLocale = required(options, 'locale');
	if (options.mode === 'check') {
		const result = await checkTranslation({ sourcePath, targetPath });
		stdout.write(`${targetPath}: ${result.status}\n`);
		if (result.status !== 'current') process.exitCode = 1;
		return result;
	}
	const client = createOllamaClient({ role: 'translate', model: options.model, locale: targetLocale, env });
	const runtime = docsAiRuntimeOptions({ env });
	const result = await translateDocument({
		sourcePath,
		targetPath,
		targetLocale,
		client,
		cacheDirectory: cacheDirectory(env),
		maxChunkChars: runtime.maxChunkChars,
		mode: options.mode,
	});
	if (options.mode === 'stdout') stdout.write(result.document);
	else stdout.write(`Translated ${sourcePath} -> ${targetPath} with ${result.provenance.model}@${result.provenance.modelDigest}.\n`);
	return result;
}

async function runHandbookCommand(options, { env, stdout }) {
	const locales = handbookLocales(options);
	if (options.mode === 'check') {
		const reports = await checkHandbook({ locales });
		for (const report of reports) {
			const pending = report.stale + report.missing + report.invalid;
			const navigationPending = report.navigation.pending + report.navigation.orphaned;
			if (options.strict && (pending > 0 || navigationPending > 0 || report.orphaned.length > 0)) process.exitCode = 1;
			stdout.write(`${report.locale}: ${report.current}/${report.pages} current, ${report.stale} stale, ${report.missing} missing, ${report.invalid} invalid${report.orphaned.length ? `, ${report.orphaned.length} orphaned` : ''}; navigation ${report.navigation.current}/${report.navigation.labels}\n`);
			for (const { page, reason } of report.invalidPages) stdout.write(`  ${report.locale}/${page}: ${reason}\n`);
		}
		if (!reports.length) stdout.write('No language has handbook pages yet.\n');
		return reports;
	}
	const runtime = docsAiRuntimeOptions({ env });
	const pages = options.pages?.split(',').map((page) => page.trim()).filter(Boolean);
	const summaries = [];
	if (!locales.length) {
		stdout.write('No language has handbook pages yet; name one with --locale to start it.\n');
		return summaries;
	}
	for (const locale of locales) {
		if (options.prune) {
			const pruned = await pruneOrphanedTranslations(locale);
			for (const page of pruned) stdout.write(`${locale}: removed ${page}, which no longer exists in English\n`);
		}
		const client = createOllamaClient({ role: 'translate', model: options.model, locale, env });
		const summary = await translateHandbook({
			locale,
			pages,
			client,
			cacheDirectory: cacheDirectory(env),
			maxChunkChars: runtime.maxChunkChars,
			log: (line) => stdout.write(`${line}\n`),
		});
		// The navigation is a few dozen short strings and belongs to the same
		// language, so one run leaves nothing behind in English by accident.
		const navigation = await translateChrome({ locale, client, cacheDirectory: cacheDirectory(env) });
		summaries.push({ ...summary, navigation });
		stdout.write(`${locale}: ${summary.translated} translated, ${summary.current} already current, ${summary.skipped.length} skipped of ${summary.pages} pages; navigation ${navigation.translated} translated, ${navigation.current} already current\n`);
		for (const { page, reason } of summary.skipped) stdout.write(`  ${locale}/${page}: ${reason}\n`);
		for (const { keys, reason } of navigation.skipped) stdout.write(`  ${locale} navigation ${keys.join(', ')}: ${reason}\n`);
		for (const page of summary.orphaned) stdout.write(`  ${locale}/${page} no longer exists in English; --prune removes it\n`);
	}
	return summaries;
}

export { HELP };
