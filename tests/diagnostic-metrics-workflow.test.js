/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { extractJob, npmScriptsRunBy, readWorkflow } from './helpers/workflow-jobs.js';

const workflow = await readWorkflow('diagnostic-metrics.yml');
const { scripts } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('diagnostic metrics run nightly and on demand, not on every pull request', () => {
	assert.match(workflow, /^\s+- cron: '[\d*/ ,-]+'$/mu);
	assert.match(workflow, /^\s{2}workflow_dispatch:$/mu);
	assert.doesNotMatch(workflow, /^\s{2}pull_request:$/mu);
});

test('the hosted job builds both browser products before collecting diagnostics', () => {
	const job = extractJob(workflow, 'hosted-metrics');
	const runs = npmScriptsRunBy(job);
	assert.ok(runs.has('build'));
	assert.ok(runs.has('build:browser:framescaper'));
	assert.ok(runs.has('quality:collect:ci-diagnostics'));
	assert.match(
		scripts['quality:collect:ci-diagnostics'],
		/^node scripts\/collect-ci-diagnostics\.mjs$/u,
	);
	assert.doesNotMatch(job, /qualification|accepted evidence|lower bound/iu);
});

test('diagnostic reports are retained even when a correctness gate fails', () => {
	const job = extractJob(workflow, 'hosted-metrics');
	assert.match(job, /if: always\(\)/u);
	assert.match(job, /test-results\/ci-diagnostics\//u);
	assert.match(job, /retention-days: 30/u);
	assert.doesNotMatch(job, /\.accepted\.json|qualificationEvidencePublished/u);
});
