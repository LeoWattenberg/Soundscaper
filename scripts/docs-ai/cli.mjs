import { resolve } from 'node:path';

import { docsAiRuntimeOptions } from './config.mjs';
import { createOllamaClient } from './ollama.mjs';
import { checkDraft, checkTranslation, draftDocument, translateDocument } from './workflows.mjs';

const HELP = `Usage:
  node scripts/docs-ai.mjs draft --facts FACTS.json --output PAGE.md [--model MODEL] [--stdout] [--check]
  node scripts/docs-ai.mjs translate --source PAGE.md --target PAGE.de.md --locale de [--model MODEL] [--stdout] [--check]

Generation writes the output file by default. --stdout prints instead of writing.
--check validates an existing output without contacting Ollama or changing files.`;

export function parseCliArguments(argv) {
	const [command, ...rest] = argv;
	if (!['draft', 'translate'].includes(command)) throw new Error(HELP);
	const options = { command, mode: 'write' };
	let requestedStdout = false;
	let requestedCheck = false;
	for (let index = 0; index < rest.length; index += 1) {
		const argument = rest[index];
		if (argument === '--stdout') {
			requestedStdout = true;
			options.mode = 'stdout';
			continue;
		}
		if (argument === '--check') {
			requestedCheck = true;
			options.mode = 'check';
			continue;
		}
		if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}\n\n${HELP}`);
		const key = argument.slice(2).replace(/-([a-z])/gu, (_match, character) => character.toUpperCase());
		const value = rest[index + 1];
		if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
		options[key] = value;
		index += 1;
	}
	if (requestedStdout && requestedCheck) throw new Error('--stdout and --check cannot be combined.');
	return options;
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

	const sourcePath = required(options, 'source');
	const targetPath = required(options, 'target');
	const targetLocale = required(options, 'locale');
	if (options.mode === 'check') {
		const result = await checkTranslation({ sourcePath, targetPath });
		stdout.write(`${targetPath}: ${result.status}\n`);
		if (result.status !== 'current') process.exitCode = 1;
		return result;
	}
	const client = createOllamaClient({ role: 'translate', model: options.model, env });
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

export { HELP };
