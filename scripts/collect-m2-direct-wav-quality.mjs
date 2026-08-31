#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	collectReferenceDiagnostic,
	parseReferenceDiagnostic,
} from './quality-budget-reference-diagnostic.mjs';

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
 *   writeDiagnostic?: (options: unknown) => Promise<unknown>,
 * }} dependencies
 */
export async function collectDirectWavQualityEvidence(options, dependencies = {}) {
	return collectReferenceDiagnostic({
		configPath: CONFIG_URL,
		outputDirectory: options.outputDirectory,
		profile: PROFILE,
		workloadId: WORKLOAD_ID,
	}, {
		runReference: dependencies.runReference ?? runDirectWavReference,
		writeDiagnostic: dependencies.writeDiagnostic,
	});
}

export function parseDirectWavReferenceDiagnostic(output) {
	return parseReferenceDiagnostic(output, { profile: PROFILE, workloadId: WORKLOAD_ID });
}

async function runDirectWavReference() {
	return execFileAsync('npm', ['run', 'test:reference:wav-385mib'], {
		cwd: REPOSITORY_ROOT,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
	});
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
