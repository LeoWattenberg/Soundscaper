#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

// The Audacity Qt translation tooling's command line and public surface. Reading
// the catalogs, converting reviewed messages, and assembling a release are each
// implemented in their own module beside this one.

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

import {
	DEFAULT_TRANSLATION_ARCHIVE_LIMITS,
	TranslationArtifactError,
	inspectVerifiedZip,
} from './lib/verified-zip.mjs';
import {
	loadPreviousRelease,
	prepareAudacityTranslationRelease,
} from './lib/audacity-qt-release-build.mjs';
import { encodeCanonicalJson } from './lib/audacity-qt-values.mjs';

export { DEFAULT_TRANSLATION_ARCHIVE_LIMITS, TranslationArtifactError, inspectVerifiedZip };
export {
	baseLanguage,
	normalizeQtLocale,
	parseQtTs,
	readAudacityQtCatalogsFromZip,
} from './lib/audacity-qt-catalog.mjs';
export {
	AUDACITY_TRANSLATION_ELIGIBILITY,
	auditQtMappingCandidates,
	convertQtCatalog,
	extractPlaceholders,
	stripEllipses,
	validateAudacityQtMapping,
	validateMappingAgainstSourceCatalog,
} from './lib/audacity-qt-conversion.mjs';
export {
	AUDACITY_TRANSLATION_MODIFICATION_NOTICE,
	TRANSLATION_PACK_SCHEMA_VERSION,
	TRANSLATION_RELEASE_SCHEMA_VERSION,
	buildAudacityTranslationRelease,
	prepareAudacityTranslationRelease,
} from './lib/audacity-qt-release-build.mjs';
export { encodeCanonicalJson } from './lib/audacity-qt-values.mjs';

async function runCli(argv) {
	const [command, ...rest] = argv;
	if (command !== 'prepare') throw usageError();
	const flags = parseFlags(rest);
	const required = [
		'archive',
		'output',
		'artifact-id',
		'source-run-id',
		'source-head-sha',
		'source-workflow-url',
		'source-sha256',
		'source-byte-length',
		'source-license',
		'tool-revision',
		'converted-at',
	];
	for (const flag of required) if (!flags[flag]) throw usageError(`Missing --${flag}.`);
	const archivePath = path.resolve(flags.archive);
	const licensePath = path.resolve(flags['source-license']);
	const previousRelease = flags['previous-root'] ? await loadPreviousRelease(path.resolve(flags['previous-root'])) : undefined;
	const release = await prepareAudacityTranslationRelease({
		archiveBytes: await readFile(archivePath),
		licenseBytes: await readFile(licensePath),
		outputDirectory: flags.output,
		exposedLocales: flags['exposed-locales'] ? flags['exposed-locales'].split(',').filter(Boolean) : ['en', 'de'],
		previousRelease,
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
		conversion: {
			toolRevision: flags['tool-revision'],
			convertedAt: flags['converted-at'],
		},
	});
	process.stdout.write(encodeCanonicalJson({
		manifestPath: release.manifestPath,
		normalizedContentSha256: release.manifest.normalizedContentSha256,
		eligibleLocales: release.manifest.eligibleLocales,
		pendingLocales: release.manifest.pendingLocales,
		retainedLocales: release.manifest.retainedLocales,
	}));
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
		`${detail ? `${detail}\n` : ''}Usage: node scripts/audacity-qt-translations.mjs prepare --archive <zip> --output <dir> --artifact-id <id> --source-run-id <id> --source-head-sha <sha> --source-workflow-url <url> --source-sha256 <sha> --source-byte-length <bytes> --source-license <file> --tool-revision <sha> --converted-at <ISO timestamp> [--previous-root <dir>] [--exposed-locales en,de]`,
	);
}


function isMainModule() {
	if (!process.argv[1]) return false;
	return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
	runCli(process.argv.slice(2)).catch((error) => {
		const code = error?.code || 'TRANSLATION_PREPARE_FAILED';
		process.stderr.write(`${code}: ${error?.message || error}\n`);
		process.exitCode = 1;
	});
}
