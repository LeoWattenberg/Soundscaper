#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { NODE_TEST_SHARD_IDS } from './lib/node-test-shards.mjs';

const root = resolve(import.meta.dirname, '..');
const shardDirectory = process.argv[2] ?? 'coverage/shards';

// c8 reports an empty temp directory as 0% — or, with --merge-async, as a yargs
// usage dump with a TypeError buried in it. Either way a shard that never handed
// its coverage over reads as a catastrophic regression rather than the missing
// artifact it is, so say so plainly before the thresholds are applied.
const missing = NODE_TEST_SHARD_IDS.filter((shard) => {
	const file = resolve(root, shardDirectory, `${shard}.json`);
	return !existsSync(file) || statSync(file).size === 0;
});

if (missing.length > 0) {
	process.stderr.write(
		`${shardDirectory} is missing usable coverage for: ${missing.join(', ')}. `
		+ 'Every test shard must upload its compacted profile before the thresholds can be checked.\n',
	);
	process.exit(1);
}

// The merge stays on c8's synchronous path: --merge-async is order-sensitive and
// has been seen to shift branch counts with the directory listing order, and the
// shards arrive pre-merged, so there is nothing here for it to save.
const result = spawnSync(resolve(root, 'node_modules/.bin/c8'), [
	'report',
	`--temp-directory=${shardDirectory}`,
	'--reporter=text-summary',
	'--reporter=lcov',
	'--check-coverage',
], { cwd: root, env: process.env, stdio: 'inherit' });

if (result.error) throw result.error;
if (result.signal) throw new Error(`The coverage report terminated with ${result.signal}.`);
process.exitCode = result.status ?? 1;
