#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { prepareE2ECoverageArtifacts } from './lib/e2e-coverage-builder.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const indexArgument = process.argv[2];
if (indexArgument === undefined) {
	throw new Error(
		'Usage: node scripts/prepare-e2e-coverage.mjs <capture-index.json> [artifact-directory]',
	);
}
const indexPath = resolve(repositoryRoot, indexArgument);
const artifactRoot = resolve(repositoryRoot, process.argv[3] ?? 'coverage/e2e');
const captureIndex = JSON.parse(readFileSync(indexPath, 'utf8'));
const result = prepareE2ECoverageArtifacts({
	captureIndex,
	captureRoot: dirname(indexPath),
	artifactRoot,
	repositoryRoot,
});

process.stdout.write(
	`Prepared ${result.inventory.sources.length} executable sources and `
	+ `${result.manifests.length} required E2E surfaces in ${artifactRoot}.\n`,
);
