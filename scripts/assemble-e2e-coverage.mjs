#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import { assembleE2ECoverageCapture } from './lib/e2e-coverage-assembler.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const { output, runRoots } = argumentsFrom(process.argv.slice(2));
const result = assembleE2ECoverageCapture({
	repositoryRoot,
	runRoots: runRoots.map((path) => resolve(path)),
	...(output === null ? {} : { outputRoot: resolve(output) }),
});

process.stdout.write(
	`Assembled ${result.captureIndex.scripts.length} executable scripts from ${runRoots.length} nightly run(s) `
	+ `across ${result.captureIndex.surfaces.length} required E2E surfaces in ${result.outputRoot}.\n`,
);

function argumentsFrom(values) {
	let output = null;
	const runRoots = [];
	for (let index = 0; index < values.length; index += 1) {
		const value = values[index];
		if (value === '--output') {
			if (output !== null || values[index + 1] === undefined) usage();
			output = values[index + 1];
			index += 1;
		} else if (value === '--help' || value === '-h') {
			usage(0);
		} else if (value.startsWith('-')) {
			usage();
		} else {
			runRoots.push(value);
		}
	}
	if (runRoots.length === 0) usage();
	return { output, runRoots };
}

function usage(exitCode = 1) {
	const text = 'Usage: node scripts/assemble-e2e-coverage.mjs '
		+ '[--output <capture-directory>] <nightly-run-root> [<nightly-run-root> ...]\n';
	if (exitCode === 0) {
		process.stdout.write(text);
		process.exit(0);
	}
	throw new Error(text.trim());
}
