/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { analyzeCoverageSummary, formatCoverageScopes } from './coverage-gates.mjs';

/**
 * Merge the recorded shards into one report and hand back its summary.
 *
 * The gate and the ratchet must measure the same thing, so both go through
 * here rather than each spawning c8 with its own idea of the reporters.
 *
 * @param {string} repositoryRoot
 * @param {string} temporaryDirectory
 */
export function reportCoverageSummary(repositoryRoot, temporaryDirectory) {
	const reportDirectory = resolve(repositoryRoot, 'coverage');
	// The synchronous merge is deterministic for the pre-compacted CI shards.
	// `--merge-async` has shifted branch counts with directory listing order.
	const result = spawnSync(resolve(repositoryRoot, 'node_modules/.bin/c8'), [
		'report',
		// The Node shards address a script by the source file it was loaded from,
		// but a browser shard addresses a bundled chunk in a build directory that
		// no `.c8rc.json` include pattern names — and that a container job checked
		// out at a path of its own. Excluding after the remap applies the include
		// patterns to the sources a script maps back to instead of the file it was
		// served as, which is the only address both kinds of shard share. It is a
		// no-op for the Node shards: the union's summary is byte-identical with
		// and without it.
		'--exclude-after-remap',
		`--temp-directory=${resolve(repositoryRoot, temporaryDirectory)}`,
		`--reports-dir=${reportDirectory}`,
		'--reporter=text-summary',
		'--reporter=lcov',
		'--reporter=json-summary',
	], { cwd: repositoryRoot, env: process.env, stdio: 'inherit' });

	if (result.error) throw result.error;
	if (result.signal) throw new Error(`The coverage report terminated with ${result.signal}.`);
	if (result.status !== 0) throw new Error(`The coverage report exited with status ${result.status ?? 1}.`);

	return JSON.parse(readFileSync(resolve(reportDirectory, 'coverage-summary.json'), 'utf8'));
}

export function runCoverageGate(repositoryRoot, temporaryDirectory) {
	const summary = reportCoverageSummary(repositoryRoot, temporaryDirectory);
	const analysis = analyzeCoverageSummary(summary, repositoryRoot);
	process.stdout.write(formatCoverageScopes(analysis.scopes));
	if (analysis.failures.length > 0) {
		process.stderr.write(`${analysis.failures.join('\n')}\n`);
	}
	return analysis.failures.length === 0;
}
