#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	createM5NativeHelperCohort,
	writeM5NativeHelperCohort,
} from './lib/m5-native-helper-cohort.mjs';

const CONFIG_URL = new URL('../config/quality-budgets.json', import.meta.url);

export function parseM5NativeHelperCohortArguments(args) {
	if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) {
		throw new TypeError('M5 native-helper cohort arguments must be strings.');
	}
	const measurementPaths = [];
	let outputDirectory = null;
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === '--measurement') {
			if (index + 1 >= args.length) throw new Error('--measurement requires a path.');
			measurementPaths.push(resolve(args[index += 1]));
			continue;
		}
		if (argument === '--output-directory') {
			if (outputDirectory !== null || index + 1 >= args.length) {
				throw new Error('--output-directory requires exactly one path.');
			}
			outputDirectory = resolve(args[index += 1]);
			continue;
		}
		throw new Error(`Unknown M5 native-helper cohort argument ${argument}.`);
	}
	return Object.freeze({ measurementPaths: Object.freeze(measurementPaths), outputDirectory });
}

export async function collectM5NativeHelperCohort(options, dependencies = {}) {
	const config = dependencies.config ?? JSON.parse(await readFile(CONFIG_URL, 'utf8'));
	const load = dependencies.readMeasurement ?? (async (path) => JSON.parse(await readFile(path, 'utf8')));
	const measurements = await Promise.all(options.measurementPaths.map(load));
	const cohort = createM5NativeHelperCohort(measurements, config);
	return (dependencies.writeCohort ?? writeM5NativeHelperCohort)(
		options.outputDirectory,
		measurements,
		cohort,
		config,
	);
}

async function main() {
	const options = parseM5NativeHelperCohortArguments(process.argv.slice(2));
	if (options.measurementPaths.length === 0) {
		process.stderr.write('Usage: node scripts/collect-m5-native-helper-cohort.mjs --measurement <record.json>... [--output-directory <directory>]\n');
		process.exitCode = 2;
		return;
	}
	const result = await collectM5NativeHelperCohort({
		...options,
		outputDirectory: options.outputDirectory ?? fileURLToPath(
			new URL('../test-results/quality/m5-native-helper-cohort', import.meta.url),
		),
	});
	process.stdout.write(`${JSON.stringify(result.cohort, null, '\t')}\n`);
	if (result.cohort.status === 'failed') process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
