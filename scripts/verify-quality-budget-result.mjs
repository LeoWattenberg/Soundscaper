#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { evaluateQualityBudgetResult } from './quality-budget-result.mjs';
import { qualityWorkloadBudget } from './lib/quality-budget-config.mjs';

const execFileAsync = promisify(execFile);
const defaultConfigPath = fileURLToPath(new URL('../config/quality-budgets.json', import.meta.url));

/**
 * Verify a diagnostic summary against the exact quality ledger, retained raw
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

	let workload = null;
	try {
		workload = qualityWorkloadBudget(config, result.workloadId);
	} catch (error) {
		failures.push(errorMessage(error));
	}
	await verifyRawArtifact(options.resultPath, result, failures);
	if (result.sourceRevision !== options.expectedSourceRevision) {
		failures.push(
			`Result source revision does not match ${options.expectedSourceRevision}.`,
		);
	}

	if (!workload) return failedEvaluation(failures);
	const evaluation = evaluateQualityBudgetResult({
		workload,
		expectedBudgetSha256: sha256(configBytes),
	}, result);
	return Object.freeze({
		passed: failures.length === 0 && evaluation.passed,
		failures: Object.freeze([...failures, ...evaluation.failures]),
		warnings: evaluation.warnings,
		verdicts: evaluation.verdicts,
	});
}

async function verifyRawArtifact(resultPath, result, failures) {
	if (!isRecord(result.rawArtifact) || typeof result.rawArtifact.artifactName !== 'string') {
		failures.push('Result does not name a local raw artifact.');
		return;
	}
	const resultDirectory = resolve(dirname(resultPath));
	const rawPath = resolve(resultDirectory, result.rawArtifact.artifactName);
	if (dirname(rawPath) !== resultDirectory || basename(rawPath) !== result.rawArtifact.artifactName) {
		failures.push('Result raw artifact must stay in the result directory.');
		return;
	}
	if (rawPath === resolve(resultPath)) {
		failures.push('Result raw artifact must be distinct from the diagnostic summary.');
		return;
	}

	let bytes;
	try {
		bytes = await readFile(rawPath);
	} catch (error) {
		failures.push(`Result raw artifact could not be read: ${errorMessage(error)}.`);
		return;
	}
	if (bytes.byteLength !== result.rawArtifact.byteLength) {
		failures.push(
			`Result raw artifact byte length was ${bytes.byteLength}; expected ${String(result.rawArtifact.byteLength)}.`,
		);
	}
	if (sha256(bytes) !== result.rawArtifact.sha256) {
		failures.push('Result raw artifact digest does not match its actual bytes.');
	}
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
		warnings: Object.freeze([]),
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
		process.stderr.write('Usage: node scripts/verify-quality-budget-result.mjs <diagnostic-summary.json>\n');
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
