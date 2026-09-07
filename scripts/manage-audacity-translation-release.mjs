#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

// Finds the newest reviewed Audacity translation artifact and writes it, with
// its licence and metadata, to a directory for the converter. The converted
// strings are committed source (see scripts/audacity-qt-translations.mjs
// commit), so the publication commands this file once routed to are gone.

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseArgs } from './lib/audacity-translation-release-values.mjs';
import { discover } from './lib/audacity-translation-release-discovery.mjs';

export {
	validateAudacityArtifactResult,
	validateAudacityWorkflowRun,
} from './lib/audacity-translation-release-validation.mjs';

function usage() {
	console.error(`Usage:
  node scripts/manage-audacity-translation-release.mjs discover --output <directory> [--max-age-hours 24] [--github-env <file>] [--github-output <file>]`);
}

async function runCli(argv) {
	const { command, options } = parseArgs(argv);
	if (command === 'discover') await discover(options);
	else {
		usage();
		process.exitCode = 2;
	}
}

function isMainModule() {
	if (!process.argv[1]) return false;
	return pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
	runCli(process.argv.slice(2)).catch((error) => {
		console.error(`Translation discovery error: ${error.message}`);
		process.exitCode = 1;
	});
}
