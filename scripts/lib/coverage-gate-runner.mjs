/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { analyzeCoverageSummary, formatCoverageScopes } from './coverage-gates.mjs';

export function runCoverageGate(repositoryRoot, temporaryDirectory) {
	const reportDirectory = resolve(repositoryRoot, 'coverage');
	// The synchronous merge is deterministic for the pre-compacted CI shards.
	// `--merge-async` has shifted branch counts with directory listing order.
	const result = spawnSync(resolve(repositoryRoot, 'node_modules/.bin/c8'), [
		'report',
		`--temp-directory=${resolve(repositoryRoot, temporaryDirectory)}`,
		`--reports-dir=${reportDirectory}`,
		'--reporter=text-summary',
		'--reporter=lcov',
		'--reporter=json-summary',
	], { cwd: repositoryRoot, env: process.env, stdio: 'inherit' });

	if (result.error) throw result.error;
	if (result.signal) throw new Error(`The coverage report terminated with ${result.signal}.`);
	if (result.status !== 0) throw new Error(`The coverage report exited with status ${result.status ?? 1}.`);

	const summary = JSON.parse(readFileSync(resolve(reportDirectory, 'coverage-summary.json'), 'utf8'));
	const analysis = analyzeCoverageSummary(summary, repositoryRoot);
	process.stdout.write(formatCoverageScopes(analysis.scopes));
	if (analysis.failures.length > 0) {
		process.stderr.write(`${analysis.failures.join('\n')}\n`);
	}
	return analysis.failures.length === 0;
}
