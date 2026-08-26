/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { expandNpmScript, extractJob, npmScriptsRunBy, readWorkflow } from './helpers/workflow-jobs.js';

const WORKFLOW = 'qualification-metrics.yml';
const workflow = await readWorkflow(WORKFLOW);
const { scripts } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('the qualification metrics workflow runs on a schedule and on demand', () => {
	assert.match(workflow, /^\s+- cron: '[\d*/ ,-]+'$/mu, 'the workflow must carry a cron schedule');
	assert.match(workflow, /^\s{2}workflow_dispatch:$/mu, 'the workflow must be dispatchable for a rerun');
	assert.doesNotMatch(workflow, /^\s{2}pull_request:$/mu,
		'benchmark collection must not run on every pull request');
});

test('the hosted job builds the application and then collects its metrics', () => {
	const job = extractJob(workflow, 'hosted-metrics');
	const runs = npmScriptsRunBy(job);
	assert.ok(runs.has('build'), 'the collector measures a build, so the job must produce one');
	assert.ok(runs.has('quality:collect:ci-metrics'), 'the job must run the hosted collector');
	assert.ok(job.indexOf('npm run build') < job.indexOf('npm run quality:collect:ci-metrics'),
		'the build must precede collection');
	assert.deepEqual(expandNpmScript(scripts, 'quality:collect:ci-metrics'), ['quality:collect:ci-metrics']);
	assert.match(scripts['quality:collect:ci-metrics'], /^node scripts\/collect-ci-qualification-metrics\.mjs$/u);
});

test('the hosted job retains its evidence even when a gate fails', () => {
	const job = extractJob(workflow, 'hosted-metrics');
	assert.match(job, /if: always\(\)/u, 'evidence must be uploaded on a failed run too');
	assert.match(job, /test-results\/ci-qualification-metrics\//u, 'the evidence directory must be uploaded');
	assert.match(job, /retention-days: 30/u, 'a nightly benchmark needs a retention window longer than a day');
});
