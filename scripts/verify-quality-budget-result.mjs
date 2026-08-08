#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { evaluateQualityBudgetResult } from './quality-budget-result.mjs';

const execFileAsync = promisify(execFile);
const defaultConfigPath = fileURLToPath(new URL('../config/quality-budgets.json', import.meta.url));

/**
 * Verify an accepted summary against the exact quality ledger, retained raw
 * artifact, and checked-out source revision.
 *
 * @param {{
 *   configPath: string,
 *   resultPath: string,
 *   expectedSourceRevision: string,
 * }} options
 */
export async function verifyQualityBudgetResultFiles(options) {
	const failures = [];
	const [configBytes, resultBytes] = await Promise.all([
		readRequiredFile(options.configPath, 'Quality-budget config', failures),
		readRequiredFile(options.resultPath, 'Quality-budget result', failures),
	]);
	if (!configBytes || !resultBytes) return failedEvaluation(failures);

	const config = parseJson(configBytes, 'Quality-budget config', failures);
	const result = parseJson(resultBytes, 'Quality-budget result', failures);
	if (!isRecord(config) || !isRecord(result)) return failedEvaluation(failures);

	const workload = findExactDescriptor(config.workloads, result.workloadId, 'workload', failures);
	const environment = findExactDescriptor(
		config.environments,
		result.environmentId,
		'environment',
		failures,
	);
	await verifyRawEvidence(options.resultPath, result, failures);
	if (result.sourceRevision !== options.expectedSourceRevision) {
		failures.push(
			`Result source revision does not match ${options.expectedSourceRevision}.`,
		);
	}

	if (!workload || !environment) return failedEvaluation(failures);
	const evaluation = evaluateQualityBudgetResult({
		workload,
		expectedEnvironment: environment,
		expectedBudgetSha256: sha256(configBytes),
		measurementPolicy: isRecord(config.measurementPolicy) ? config.measurementPolicy : {},
	}, result);
	return Object.freeze({
		passed: failures.length === 0 && evaluation.passed,
		failures: Object.freeze([...failures, ...evaluation.failures]),
		verdicts: evaluation.verdicts,
	});
}

async function verifyRawEvidence(resultPath, result, failures) {
	if (!isRecord(result.rawEvidence) || typeof result.rawEvidence.artifactName !== 'string') {
		failures.push('Result raw evidence does not name a local artifact.');
		return;
	}
	const resultDirectory = resolve(dirname(resultPath));
	const rawPath = resolve(resultDirectory, result.rawEvidence.artifactName);
	if (dirname(rawPath) !== resultDirectory || basename(rawPath) !== result.rawEvidence.artifactName) {
		failures.push('Result raw evidence must stay in the result directory.');
		return;
	}
	if (rawPath === resolve(resultPath)) {
		failures.push('Result raw evidence must be distinct from the accepted summary.');
		return;
	}

	let bytes;
	try {
		bytes = await readFile(rawPath);
	} catch (error) {
		failures.push(`Result raw evidence could not be read: ${errorMessage(error)}.`);
		return;
	}
	if (bytes.byteLength !== result.rawEvidence.byteLength) {
		failures.push(
			`Result raw evidence byte length was ${bytes.byteLength}; expected ${String(result.rawEvidence.byteLength)}.`,
		);
	}
	if (sha256(bytes) !== result.rawEvidence.sha256) {
		failures.push('Result raw evidence digest does not match its actual bytes.');
	}
}

function findExactDescriptor(collection, id, label, failures) {
	if (!Array.isArray(collection) || typeof id !== 'string') {
		failures.push(`Quality-budget config must contain exactly one ${label} descriptor for the result.`);
		return null;
	}
	const matches = collection.filter((candidate) => isRecord(candidate) && candidate.id === id);
	if (matches.length !== 1) {
		failures.push(
			`Quality-budget config must contain exactly one ${label} descriptor for ${id}.`,
		);
		return null;
	}
	return matches[0];
}

async function readRequiredFile(path, label, failures) {
	try {
		return await readFile(path);
	} catch (error) {
		failures.push(`${label} could not be read: ${errorMessage(error)}.`);
		return null;
	}
}

function parseJson(bytes, label, failures) {
	try {
		return JSON.parse(bytes.toString('utf8'));
	} catch (error) {
		failures.push(`${label} is not valid JSON: ${errorMessage(error)}.`);
		return null;
	}
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}

function failedEvaluation(failures) {
	return Object.freeze({
		passed: false,
		failures: Object.freeze([...failures]),
		verdicts: Object.freeze([]),
	});
}

async function currentSourceRevision() {
	const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
		cwd: fileURLToPath(new URL('..', import.meta.url)),
		encoding: 'utf8',
	});
	return stdout.trim();
}

async function main() {
	if (process.argv.length !== 3) {
		process.stderr.write('Usage: node scripts/verify-quality-budget-result.mjs <accepted-summary.json>\n');
		process.exitCode = 2;
		return;
	}
	const evaluation = await verifyQualityBudgetResultFiles({
		configPath: defaultConfigPath,
		resultPath: resolve(process.argv[2]),
		expectedSourceRevision: await currentSourceRevision(),
	});
	process.stdout.write(`${JSON.stringify(evaluation, null, '\t')}\n`);
	if (!evaluation.passed) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	await main();
}
