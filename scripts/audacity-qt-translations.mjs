#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

// The Audacity Qt translation tooling's command line and public surface. Reading
// the catalogs, converting reviewed messages, and writing the committed layer
// are each implemented in their own module beside this one.

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

import {
	DEFAULT_TRANSLATION_ARCHIVE_LIMITS,
	TranslationArtifactError,
	inspectVerifiedZip,
} from './lib/verified-zip.mjs';
import { encodeCanonicalJson } from './lib/audacity-qt-values.mjs';
import { buildAudacityLayer, writeAudacityLayer } from './lib/audacity-committed-layer.mjs';
import { TRANSLATION_CATALOG_DIRECTORY } from './i18n-ai/catalog.mjs';

export { DEFAULT_TRANSLATION_ARCHIVE_LIMITS, TranslationArtifactError, inspectVerifiedZip };
export {
	baseLanguage,
	normalizeQtLocale,
	parseQtTs,
	readAudacityQtCatalogsFromZip,
} from './lib/audacity-qt-catalog.mjs';
export {
	auditQtMappingCandidates,
	convertQtCatalog,
	extractPlaceholders,
	stripEllipses,
	validateAudacityQtMapping,
	validateMappingAgainstSourceCatalog,
} from './lib/audacity-qt-conversion.mjs';
export { encodeCanonicalJson } from './lib/audacity-qt-values.mjs';
export {
	AUDACITY_TRANSLATION_MODIFICATION_NOTICE,
	buildAudacityLayer,
	mergeAudacityMessages,
	writeAudacityLayer,
} from './lib/audacity-committed-layer.mjs';

async function runCli(argv) {
	const [command, ...rest] = argv;
	if (command !== 'commit') throw usageError();
	return runCommit(parseFlags(rest));
}

/** Merge one verified artifact's reviewed strings into the catalogs under src/common/i18n/translations/. */
async function runCommit(flags) {
	const required = [
		'archive',
		'artifact-id',
		'source-run-id',
		'source-head-sha',
		'source-workflow-url',
		'source-sha256',
		'source-byte-length',
		'source-license',
	];
	for (const flag of required) if (!flags[flag]) throw usageError(`Missing --${flag}.`);
	const archivePath = path.resolve(flags.archive);
	const layer = buildAudacityLayer({
		archiveBytes: await readFile(archivePath),
		licenseBytes: await readFile(path.resolve(flags['source-license'])),
		source: {
			artifactId: Number(flags['artifact-id']),
			archiveName: path.basename(archivePath),
			expectedSha256: flags['source-sha256'],
			expectedByteLength: Number(flags['source-byte-length']),
			repository: 'audacity/audacity',
			runId: Number(flags['source-run-id']),
			headSha: flags['source-head-sha'],
			workflowUrl: flags['source-workflow-url'],
		},
	});
	const { summaries } = await writeAudacityLayer(layer, flags.output ? path.resolve(flags.output) : TRANSLATION_CATALOG_DIRECTORY);
	process.stdout.write(`${encodeCanonicalJson({
		locales: [...layer.messagesByLocale.keys()],
		messages: Object.fromEntries([...layer.messagesByLocale].map(([locale, messages]) => [locale, Object.keys(messages).length])),
		changed: summaries.filter((summary) => summary.written || summary.removed).map((summary) => summary.locale),
		headSha: layer.provenance.headSha,
		artifactId: layer.provenance.artifactId,
	})}\n`);
}

function parseFlags(args) {
	const flags = {};
	for (let index = 0; index < args.length; index += 2) {
		const flag = args[index];
		const value = args[index + 1];
		if (!flag?.startsWith('--') || value == null || value.startsWith('--')) throw usageError(`Invalid argument ${flag || ''}.`);
		const name = flag.slice(2);
		if (flags[name] != null) throw usageError(`Duplicate --${name}.`);
		flags[name] = value;
	}
	return flags;
}

function usageError(detail = '') {
	return new TranslationArtifactError(
		'CLI_USAGE',
		`${detail ? `${detail}\n` : ''}Usage: node scripts/audacity-qt-translations.mjs commit --archive <zip> --artifact-id <id> --source-run-id <id> --source-head-sha <sha> --source-workflow-url <url> --source-sha256 <sha> --source-byte-length <bytes> --source-license <file> [--output <dir>]`,
	);
}


function isMainModule() {
	if (!process.argv[1]) return false;
	return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
	runCli(process.argv.slice(2)).catch((error) => {
		const code = error?.code || 'TRANSLATION_COMMIT_FAILED';
		process.stderr.write(`${code}: ${error?.message || error}\n`);
		process.exitCode = 1;
	});
}
