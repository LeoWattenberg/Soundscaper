#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { writeStructuralQualityBudgetEvidence } from './quality-budget-evidence.mjs';

const execFileAsync = promisify(execFile);
const CONFIG_URL = new URL('../config/quality-budgets.json', import.meta.url);
const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROFILE = 'direct-wav-385mib-counting-sha256-node-v2';
const WORKLOAD_ID = 'm2-direct-wav-385mib-v1';

/**
 * Run the reference-scale direct WAV witness exactly once and persist its
 * structured counters through the common evidence writer.
 *
 * @param {{ outputDirectory: string }} options
 * @param {{
 *   runReference?: () => Promise<{ stdout: string, stderr: string }>,
 *   writeEvidence?: typeof writeStructuralQualityBudgetEvidence,
 * }} dependencies
 */
export async function collectDirectWavQualityEvidence(options, dependencies = {}) {
	const runReference = dependencies.runReference ?? runDirectWavReference;
	const writeEvidence = dependencies.writeEvidence ?? writeStructuralQualityBudgetEvidence;
	const { stdout, stderr } = await runReference();
	const diagnostic = parseDirectWavReferenceDiagnostic(`${stdout}\n${stderr}`);
	const { budgetMetrics, workloadId: _workloadId, ...observations } = diagnostic;
	return writeEvidence({
		configPath: CONFIG_URL,
		outputDirectory: options.outputDirectory,
		workloadId: WORKLOAD_ID,
		metrics: budgetMetrics,
		observations,
	});
}

export function parseDirectWavReferenceDiagnostic(output) {
	const matches = [];
	for (const line of output.split(/\r?\n/u)) {
		const jsonStart = line.indexOf('{');
		if (jsonStart < 0) continue;
		let candidate;
		try {
			candidate = JSON.parse(line.slice(jsonStart));
		} catch {
			continue;
		}
		if (isRecord(candidate)
			&& candidate.profile === PROFILE
			&& candidate.workloadId === WORKLOAD_ID
			&& candidate.fixtureId === WORKLOAD_ID) matches.push(candidate);
	}
	if (matches.length !== 1) {
		throw new Error(`Expected exactly one ${WORKLOAD_ID} reference diagnostic; received ${matches.length}.`);
	}
	return matches[0];
}

async function runDirectWavReference() {
	return execFileAsync('npm', ['run', 'test:reference:wav-385mib'], {
		cwd: REPOSITORY_ROOT,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
	});
}

function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function main() {
	if (process.argv.length > 3) {
		process.stderr.write('Usage: node scripts/collect-m2-direct-wav-quality.mjs [output-directory]\n');
		process.exitCode = 2;
		return;
	}
	const outputDirectory = resolve(
		process.argv[2] ?? fileURLToPath(new URL('../test-results/quality/m2-resources', import.meta.url)),
	);
	const result = await collectDirectWavQualityEvidence({ outputDirectory });
	process.stdout.write(`${JSON.stringify(result.evaluation, null, '\t')}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	await main();
}
