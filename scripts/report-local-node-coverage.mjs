#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import { compactV8Coverage } from './lib/v8-coverage-compaction.mjs';
import { reportCoverageSummary } from './lib/coverage-gate-runner.mjs';
import {
	assertLocalNodeCoverageStructure,
	replaceLocalNodeCoverage,
} from './lib/local-coverage-evidence.mjs';

const root = resolve(import.meta.dirname, '..');
const rawDirectory = resolve(root, process.argv[2] ?? 'coverage/v8-all');
const localDirectory = resolve(root, 'coverage/all');

replaceLocalNodeCoverage(localDirectory, compactV8Coverage(rawDirectory, root));
process.stdout.write('Fresh Node-only coverage; CI checks the combined Node and Chromium floors.\n');
assertLocalNodeCoverageStructure(reportCoverageSummary(root, localDirectory), root);
