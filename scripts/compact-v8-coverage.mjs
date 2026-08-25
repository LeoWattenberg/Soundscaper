#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { compactV8Coverage } from './lib/v8-coverage-compaction.mjs';

const root = resolve(import.meta.dirname, '..');
const [temporaryDirectory, outputFile] = process.argv.slice(2);

if (temporaryDirectory === undefined || outputFile === undefined) {
	throw new Error('Usage: node scripts/compact-v8-coverage.mjs <v8-temp-directory> <output-file>');
}

const compacted = compactV8Coverage(resolve(root, temporaryDirectory), root);
const output = resolve(root, outputFile);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(compacted));

process.stdout.write(
	`Compacted ${compacted.result.length} script coverages and ` +
	`${Object.keys(compacted['source-map-cache']).length} source maps into ${outputFile}.\n`,
);
