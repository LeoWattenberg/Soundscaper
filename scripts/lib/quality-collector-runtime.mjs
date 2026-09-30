/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { boundedString, exactRecord } from './measurement-validation.mjs';
import { snapshotStrictJsonData } from './strict-json-snapshot.mjs';

const HOSTED_RUNNER_VARIABLES = Object.freeze([
	'GITHUB_ACTIONS', 'CI', 'GITLAB_CI', 'BUILDKITE', 'CIRCLECI',
]);

/** Snapshot and validate the two paths accepted by every collector API. */
export function normalizeQualityCollectorOptions(optionsValue) {
	const options = exactRecord(
		snapshotStrictJsonData(optionsValue, 'collector options'),
		['measurementPath', 'outputDirectory'],
		'collector options',
	);
	return Object.freeze({
		measurementPath: boundedString(options.measurementPath, 1, 4_096, 'measurementPath'),
		outputDirectory: boundedString(options.outputDirectory, 1, 4_096, 'outputDirectory'),
	});
}

/** Parse the common `[--measurement <path>] [output-directory]` contract. */
export function parseQualityCollectorCliOptions(argsValue, collectorId) {
	const args = snapshotStrictJsonData(argsValue, `${collectorId} collector CLI arguments`);
	if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) {
		throw new TypeError(`${collectorId} collector CLI arguments must be strings.`);
	}
	let measurementPath = null;
	let outputDirectory = null;
	let expectingMeasurement = false;
	for (const argument of args) {
		if (expectingMeasurement) {
			measurementPath = argument;
			expectingMeasurement = false;
			continue;
		}
		if (argument === '--measurement') {
			if (measurementPath !== null) {
				throw new Error(`${collectorId} collector accepts one measurement path.`);
			}
			expectingMeasurement = true;
			continue;
		}
		if (argument.startsWith('-')) {
			throw new Error(`Unknown ${collectorId} collector option ${argument}.`);
		}
		if (outputDirectory !== null) {
			throw new Error(`${collectorId} collector accepts one output directory.`);
		}
		outputDirectory = argument;
	}
	if (expectingMeasurement) {
		throw new Error(`${collectorId} collector option --measurement requires a path.`);
	}
	return Object.freeze({ measurementPath, outputDirectory });
}

/** Refuse hosted automation without reading inherited properties or accessors. */
export function assertNonHostedQualityCollector(processEnvironment, rejectionMessage) {
	for (const key of HOSTED_RUNNER_VARIABLES) {
		const value = ownEnvironmentString(processEnvironment, key);
		if (value === undefined || value === '') continue;
		throw new Error(rejectionMessage(key));
	}
}

/** Read and parse one measurement while retaining the original failure as cause. */
export async function readQualityCollectorMeasurement(path, description) {
	try {
		return JSON.parse(await readFile(path, 'utf8'));
	} catch (error) {
		throw new Error(
			`${description} is unavailable or invalid: ${errorMessage(error)}.`,
			{ cause: error },
		);
	}
}

/**
 * Persist one immutable passed/failed result, optionally preceded by one raw
 * artifact prepared and admitted by the milestone-specific caller.
 */
export async function writeQualityCollectorResult(outputDirectory, resultValue, options) {
	const result = snapshotStrictJsonData(resultValue, 'result');
	if (result.status !== 'passed' && result.status !== 'failed') {
		throw new Error(`${options.resultLabel} has unsupported status ${String(result.status)}.`);
	}
	const rawArtifact = options.prepareRawArtifact?.(result) ?? null;
	const resultPath = join(outputDirectory, options.resultFilename(result));
	await mkdir(outputDirectory, { recursive: true });
	if (rawArtifact === null) {
		await writeJsonExclusive(resultPath, result);
		return Object.freeze({ resultPath, result });
	}
	const rawPath = join(outputDirectory, rawArtifact.filename);
	const rawValue = snapshotStrictJsonData(rawArtifact.value, 'raw artifact');
	await writeJsonExclusive(rawPath, rawValue);
	await writeJsonExclusive(resultPath, result);
	return Object.freeze({ rawPath, resultPath, result });
}

/** Run the common CLI main flow with injectable process effects for tests. */
export async function runQualityCollectorMain(definition, runtime = {}) {
	const cli = definition.parseOptions(runtime.args ?? process.argv.slice(2));
	const writeStderr = runtime.writeStderr ?? ((value) => process.stderr.write(value));
	const writeStdout = runtime.writeStdout ?? ((value) => process.stdout.write(value));
	const setExitCode = runtime.setExitCode ?? ((value) => { process.exitCode = value; });
	if (cli.measurementPath === null) {
		writeStderr(definition.usage);
		setExitCode(2);
		return;
	}
	const collected = await definition.collect({
		measurementPath: resolve(cli.measurementPath),
		outputDirectory: resolve(cli.outputDirectory ?? outputPath(definition.defaultOutputDirectory)),
	});
	writeStdout(`${JSON.stringify(collected.result, null, '\t')}\n`);
	if (collected.result.status === 'failed') setExitCode(1);
}

/** Identify direct ESM execution without making imported collectors run. */
export function isDirectExecution(moduleUrl, executablePath = process.argv[1]) {
	return Boolean(executablePath) && pathToFileURL(resolve(executablePath)).href === moduleUrl;
}

/** Compare two ordered string inventories without accepting array-like values. */
export function sameOrderedStrings(left, right) {
	return Array.isArray(left)
		&& Array.isArray(right)
		&& left.length === right.length
		&& left.every((value, index) => value === right[index]);
}

function ownEnvironmentString(environment, key) {
	if (environment === null || (typeof environment !== 'object' && typeof environment !== 'function')) {
		throw new Error('Collector environment must expose own data properties.');
	}
	const descriptor = Object.getOwnPropertyDescriptor(environment, key);
	if (!descriptor) return undefined;
	if (!Object.hasOwn(descriptor, 'value')
		|| (descriptor.value !== undefined && typeof descriptor.value !== 'string')) {
		throw new Error(`Collector environment ${key} must be an own string data property.`);
	}
	return descriptor.value;
}

function outputPath(value) {
	return value instanceof URL ? fileURLToPath(value) : value;
}

function writeJsonExclusive(path, value) {
	return writeFile(path, `${JSON.stringify(value, null, '\t')}\n`, { flag: 'wx' });
}

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
