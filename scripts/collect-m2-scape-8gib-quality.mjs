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
const PROFILE = 'exact-8-gib-sparse-full-import-counting-sha256-sink';
const WORKLOAD_ID = 'm2-streaming-project-8gib-v1';

export async function collectScape8GibQualityEvidence(options, dependencies = {}) {
	return collectReferenceDiagnostic({
		configPath: CONFIG_URL,
		outputDirectory: options.outputDirectory,
		profile: PROFILE,
		workloadId: WORKLOAD_ID,
	}, {
		runReference: dependencies.runReference ?? runScape8GibReference,
		writeDiagnostic: dependencies.writeDiagnostic,
	});
}

export function parseScape8GibReferenceDiagnostic(output) {
	return parseReferenceDiagnostic(output, { profile: PROFILE, workloadId: WORKLOAD_ID });
}

async function runScape8GibReference() {
	return execFileAsync('npm', ['run', 'test:reference:scape-8gib'], {
		cwd: REPOSITORY_ROOT,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
	});
}

async function main() {
	if (process.argv.length > 3) {
		process.stderr.write('Usage: node scripts/collect-m2-scape-8gib-quality.mjs [output-directory]\n');
		process.exitCode = 2;
		return;
	}
	const outputDirectory = resolve(
		process.argv[2] ?? fileURLToPath(new URL('../test-results/quality/m2-resources', import.meta.url)),
	);
	const result = await collectScape8GibQualityEvidence({ outputDirectory });
	process.stdout.write(`${JSON.stringify(result.evaluation, null, '\t')}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	await main();
}
