#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	canonicalM9SoakFixtureBytes,
	generateM9SoakFixture,
	validateM9SoakSpec,
} from './lib/m9-soak-fixture.mjs';

const DEFAULT_SPEC_PATH = 'config/milestone-9-soak-spec.json';
const REPOSITORY_ROOT = new URL('../', import.meta.url);

export function parseM9SoakGeneratorArguments(args) {
	if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) {
		throw new TypeError('M9 fixture generator arguments must be strings.');
	}
	let check = false;
	let mode = 'qualification';
	let outputPath = null;
	let specPath = DEFAULT_SPEC_PATH;
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === '--check') {
			check = true;
			continue;
		}
		if (argument === '--mode') {
			mode = args[index += 1];
			if (!['qualification', 'contract'].includes(mode)) throw new Error('--mode is invalid.');
			continue;
		}
		if (argument === '--output') {
			outputPath = args[index += 1] ?? null;
			if (outputPath === null) throw new Error('--output requires a path.');
			continue;
		}
		if (argument === '--spec') {
			specPath = args[index += 1] ?? null;
			if (specPath === null) throw new Error('--spec requires a path.');
			continue;
		}
		throw new Error(`Unknown M9 fixture generator option ${argument}.`);
	}
	if (check && outputPath !== null) throw new Error('--check does not write an output artifact.');
	if (!check && outputPath === null) throw new Error('--output is required unless --check is used.');
	return Object.freeze({ check, mode, outputPath, specPath });
}

export async function runM9SoakGenerator(args = process.argv.slice(2)) {
	const options = parseM9SoakGeneratorArguments(args);
	const spec = validateM9SoakSpec(JSON.parse(await readFile(
		resolve(fileURLToPath(REPOSITORY_ROOT), options.specPath), 'utf8',
	)));
	const source = await readFile(new URL(spec.generator.sourcePath, REPOSITORY_ROOT));
	if (sha256(source) !== spec.generator.sourceSha256) {
		throw new Error('M9 soak generator source does not match its specification pin.');
	}
	if (options.check) {
		process.stdout.write(
			`M9 soak pins verified: qualification events=${spec.generatedArtifacts.qualification.eventCount}; `
			+ `contract events=${spec.generatedArtifacts.contract.eventCount}.\n`,
		);
		return 0;
	}
	const fixture = generateM9SoakFixture(spec, options.mode);
	await writeFile(resolve(options.outputPath), canonicalM9SoakFixtureBytes(fixture), { flag: 'wx' });
	process.stdout.write(`${JSON.stringify(spec.generatedArtifacts[options.mode])}\n`);
	return 0;
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function isMain() {
	return Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
	runM9SoakGenerator().then(
		(exitCode) => { process.exitCode = exitCode; },
		(error) => {
			console.error(error instanceof Error ? error.message : error);
			process.exitCode = 2;
		},
	);
}
