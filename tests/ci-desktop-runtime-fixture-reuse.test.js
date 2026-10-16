/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { extractJob, readWorkflow } from './helpers/workflow-jobs.js';

test('each workflow compiles the desktop test runtime once and shares authenticated private-copy input across common shards', async () => {
	for (const [workflow, producer] of [['quality.yml', 'build'], ['desktop-preview.yml', 'quality'], ['soundscaper-stable-1.yml', 'source']]) {
		const source = await readWorkflow(workflow);
		assert.match(extractJob(source, producer), /uses: \.\/\.github\/actions\/prepare-desktop-runtime-test-fixture/u);
		const consumers = extractJob(source, 'tests');
		assert.match(consumers, /name: node-desktop-runtime-fixture-\$\{\{ github\.sha \}\}/u);
		assert.match(consumers, /if: matrix\.shard == 'common-1' \|\| matrix\.shard == 'common-2'/u);
		assert.match(consumers, /--desktop-runtime-fixture=\.wrangler\/node-desktop-runtime-fixture/u);
	}
	const action = await readFile(new URL('../.github/actions/prepare-desktop-runtime-test-fixture/action.yml', import.meta.url), 'utf8');
	assert.match(action, /NODE_V8_COVERAGE: \$\{\{ github\.workspace \}\}\/coverage\/v8-desktop-fixture/u);
	assert.match(action, /node scripts\/prepare-node-desktop-runtime-artifact\.mjs/u);
	assert.match(action, /node scripts\/compact-v8-coverage\.mjs coverage\/v8-desktop-fixture coverage\/shards\/desktop-runtime-fixture\.json/u);
	assert.match(action, /name: \$\{\{ inputs\.coverage-prefix \}\}desktop-runtime-fixture/u);
	assert.match(action, /include-hidden-files: true/u);
});
