#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

// The translation release workflow's command line. Each command is implemented
// in its own module beside this one; this file only routes to them.

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PUBLIC_ROOT, parseArgs, rejectUnknownOptions, requiredOption } from './lib/audacity-translation-release-values.mjs';
import { validateStage } from './lib/audacity-translation-release-validation.mjs';
import { discover, snapshot, verifyPublication } from './lib/audacity-translation-release-discovery.mjs';
import { publish, rollback } from './lib/audacity-translation-release-publication.mjs';

export {
	validateAudacityArtifactResult,
	validateAudacityWorkflowRun,
	validateCommittedRouteEligibility,
	validateHistoricalPack,
} from './lib/audacity-translation-release-validation.mjs';
export { promotePointer } from './lib/audacity-translation-release-publication.mjs';

async function verifyStage(options) {
	rejectUnknownOptions(options, ['root']);
	const release = await validateStage(requiredOption(options, 'root'));
	console.log(`Verified staged release ${release.releaseId}: ${release.files.length} immutable objects`);
}

function usage() {
	console.error(`Usage:
  node scripts/manage-audacity-translation-release.mjs discover --output <directory> [--max-age-hours 24] [--github-env <file>] [--github-output <file>]
  node scripts/manage-audacity-translation-release.mjs snapshot --output <directory> [--base-url ${PUBLIC_ROOT}]
  node scripts/manage-audacity-translation-release.mjs verify-stage --root <directory>
  node scripts/manage-audacity-translation-release.mjs verify-publication --root <directory> --expected-tool-revision <sha> [--public-base-url ${PUBLIC_ROOT}]
  node scripts/manage-audacity-translation-release.mjs publish --root <directory> [--public-base-url ${PUBLIC_ROOT}]
  node scripts/manage-audacity-translation-release.mjs rollback --release-id <artifact-id> [--public-base-url ${PUBLIC_ROOT}]`);
}

async function runCli(argv) {
	const { command, options } = parseArgs(argv);
	if (command === 'discover') await discover(options);
	else if (command === 'snapshot') await snapshot(options);
	else if (command === 'verify-stage') await verifyStage(options);
	else if (command === 'verify-publication') await verifyPublication(options);
	else if (command === 'publish') await publish(options);
	else if (command === 'rollback') await rollback(options);
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
		console.error(`Translation release error: ${error.message}`);
		process.exitCode = 1;
	});
}
