#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { reportCoverageSummary } from './lib/coverage-gate-runner.mjs';
import {
	coverageMeasurementsFromAnalysis,
	describeCoverageFloorChange,
	tightenCoverageGates,
} from './lib/coverage-gate-tightening.mjs';
import {
	COVERAGE_GATE_CONFIGURATION_URL,
	analyzeCoverageSummary,
	formatCoverageScopes,
} from './lib/coverage-gates.mjs';
import { NODE_TEST_SHARD_IDS } from './lib/node-test-shards.mjs';

/**
 * Raise the committed coverage floors to the coverage the shards just recorded.
 *
 * This is the counterpart of `npm run coverage:check`: the same merged report
 * over the same shard profiles, read to claim coverage a scope has gained
 * rather than to fail the build for coverage it has lost.
 *
 * @param {readonly string[]} argv
 */
function main(argv) {
	if (argv.length > 1) throw new RangeError(`Unknown coverage tighten arguments: ${argv.slice(1).join(' ')}`);
	const repositoryRoot = resolve(import.meta.dirname, '..');
	const shardDirectory = argv[0] ?? 'coverage/shards';
	assertShardProfilesRecorded(repositoryRoot, shardDirectory);

	const summary = reportCoverageSummary(repositoryRoot, shardDirectory);
	const analysis = analyzeCoverageSummary(summary, repositoryRoot);
	process.stdout.write(formatCoverageScopes(analysis.scopes));
	const unclassified = analysis.failures.filter((failure) => failure.startsWith('Coverage reported unclassified'));
	if (unclassified.length > 0) throw new Error(unclassified.join('\n'));

	const configurationPath = fileURLToPath(COVERAGE_GATE_CONFIGURATION_URL);
	const configuration = JSON.parse(readFileSync(configurationPath, 'utf8'));
	const { configuration: tightened, changes } = tightenCoverageGates(
		configuration,
		coverageMeasurementsFromAnalysis(analysis),
	);
	if (changes.length === 0) {
		console.log(`No coverage floor has room to tighten against ${shardDirectory}.`);
		return;
	}
	writeFileSync(configurationPath, `${JSON.stringify(tightened, null, '\t')}\n`);
	console.log(`Tightened ${changes.length} coverage floor(s) against ${shardDirectory}:`);
	for (const change of changes) console.log(`  ${describeCoverageFloorChange(change)}`);
}

/**
 * A shard that never handed its profile over reads as a catastrophic
 * regression to the gate; to the ratchet it would read as coverage nobody has,
 * so say plainly which artifact is missing before any floor moves.
 *
 * @param {string} repositoryRoot
 * @param {string} shardDirectory
 */
function assertShardProfilesRecorded(repositoryRoot, shardDirectory) {
	const missing = NODE_TEST_SHARD_IDS.filter((shard) => {
		const file = resolve(repositoryRoot, shardDirectory, `${shard}.json`);
		return !existsSync(file) || statSync(file).size === 0;
	});
	if (missing.length > 0) {
		throw new Error(
			`${shardDirectory} is missing usable coverage for: ${missing.join(', ')}. `
			+ 'Every test shard must record its compacted profile before the floors can follow the measurement up.',
		);
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(2));
}
