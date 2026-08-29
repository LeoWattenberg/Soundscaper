#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { writeM9SoakEvidence } from './lib/m9-soak-evidence.mjs';
import { validateM9SoakSpec } from './lib/m9-soak-fixture.mjs';

const CONFIG_URL = new URL('../config/quality-budgets.json', import.meta.url);
const SPEC_URL = new URL('../config/milestone-9-soak-spec.json', import.meta.url);

export function parseM9SoakCollectorArguments(args) {
	if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) {
		throw new TypeError('M9 soak collector arguments must be strings.');
	}
	const measurementPaths = [];
	let outputDirectory = null;
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === '--measurement') {
			const path = args[index += 1];
			if (!path) throw new Error('--measurement requires a path.');
			measurementPaths.push(path);
			continue;
		}
		if (argument === '--output-directory') {
			if (outputDirectory !== null) throw new Error('--output-directory may be supplied once.');
			outputDirectory = args[index += 1] ?? null;
			if (outputDirectory === null) throw new Error('--output-directory requires a path.');
			continue;
		}
		throw new Error(`Unknown M9 soak collector option ${argument}.`);
	}
	if (![1, 2].includes(measurementPaths.length)) {
		throw new Error('M9 collection requires one contract measurement or two qualification measurements.');
	}
	if (outputDirectory === null) throw new Error('--output-directory is required.');
	return Object.freeze({
		measurementPaths: Object.freeze([...measurementPaths]),
		outputDirectory,
	});
}

export async function collectM9SoakQuality(optionsValue, dependencies = {}) {
	const options = parseM9SoakCollectorArguments(flattenOptions(optionsValue));
	const configBytes = await (dependencies.readConfig ?? readFile)(CONFIG_URL);
	const config = JSON.parse(Buffer.from(configBytes).toString('utf8'));
	const spec = validateM9SoakSpec(JSON.parse(await readFile(SPEC_URL, 'utf8')));
	const loadMeasurement = dependencies.readMeasurement
		?? (async (path) => JSON.parse(await readFile(path, 'utf8')));
	const measurements = await Promise.all(options.measurementPaths.map(loadMeasurement));
	return writeM9SoakEvidence(resolve(options.outputDirectory), measurements, {
		config,
		spec,
		budgetSha256: sha256(configBytes),
	});
}

function flattenOptions(value) {
	if (Array.isArray(value)) return value;
	if (value === null || typeof value !== 'object') throw new TypeError('M9 collector options are invalid.');
	const args = value.measurementPaths.flatMap((path) => ['--measurement', path]);
	return [...args, '--output-directory', value.outputDirectory];
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function isMain() {
	return Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
	try {
		const result = await collectM9SoakQuality(process.argv.slice(2));
		process.stdout.write(`${JSON.stringify(result.evidence, null, '\t')}\n`);
		if (result.evidence.metricGatePassed === false) process.exitCode = 1;
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 2;
	}
}
