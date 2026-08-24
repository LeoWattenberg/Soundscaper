#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { M5B_QUALITY_PIPELINES } from './lib/m5b-quality-pipeline.mjs';
import {
	createM5bQualityCohortV2,
	writeM5bQualityCohortV2,
} from './lib/m5b-quality-cohort-v2.mjs';

const CONFIG_URL = new URL('../config/quality-budgets.json', import.meta.url);

export function parseM5bQualityCohortArguments(args) {
	if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) {
		throw new TypeError('5B cohort arguments must be strings.');
	}
	const measurementPaths = [];
	let profileId = null;
	let outputDirectory = null;
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === '--profile') {
			if (profileId !== null || index + 1 >= args.length) throw new Error('--profile requires one value.');
			profileId = args[index += 1];
			continue;
		}
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
		throw new Error(`Unknown 5B cohort argument ${argument}.`);
	}
	if (profileId !== null && !Object.hasOwn(M5B_QUALITY_PIPELINES, profileId)) {
		throw new Error(`Unknown 5B quality pipeline ${profileId}.`);
	}
	return Object.freeze({ profileId, measurementPaths: Object.freeze(measurementPaths), outputDirectory });
}

export async function collectM5bQualityCohort(options, dependencies = {}) {
	const config = dependencies.config ?? JSON.parse(await readFile(CONFIG_URL, 'utf8'));
	const load = dependencies.readMeasurement ?? (async (path) => JSON.parse(await readFile(path, 'utf8')));
	const measurements = await Promise.all(options.measurementPaths.map(load));
	const cohort = createM5bQualityCohortV2(options.profileId, measurements, config);
	return (dependencies.writeCohort ?? writeM5bQualityCohortV2)(
		options.outputDirectory,
		options.profileId,
		measurements,
		cohort,
		config,
	);
}

async function main() {
	const options = parseM5bQualityCohortArguments(process.argv.slice(2));
	if (options.profileId === null || options.measurementPaths.length === 0) {
		process.stderr.write('Usage: node scripts/collect-m5b-quality-cohort.mjs --profile <pipeline> --measurement <record.json>... [--output-directory <directory>]\n');
		process.exitCode = 2;
		return;
	}
	const result = await collectM5bQualityCohort({
		...options,
		outputDirectory: options.outputDirectory ?? fileURLToPath(
			new URL(`../test-results/quality/m5b-${options.profileId}-cohort`, import.meta.url),
		),
	});
	process.stdout.write(`${JSON.stringify(result.cohort, null, '\t')}\n`);
	if (result.cohort.status === 'failed') process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
