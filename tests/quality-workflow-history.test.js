/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { NODE_TEST_SHARD_IDS } from '../scripts/lib/node-test-shards.mjs';
import { expandNpmScript, extractJob, npmScriptsRunBy, readWorkflow } from './helpers/workflow-jobs.js';

const workflowNames = ['quality.yml', 'desktop-preview.yml'];

// `npm run check` is the canonical gate. CI no longer runs it as one command —
// the Node suite is sharded by product so three runners' cores are used instead
// of one runner's four — so these are the jobs that have to add back up to it.
const GATE_JOBS = ['quality', 'tests', 'coverage'];

// `test:coverage` runs the whole suite in one process and checks the thresholds
// on the way out. Split up, that is one shard per product plus the job that
// checks the thresholds over the union of what the shards recorded.
const SHARDED_EQUIVALENT = new Map([['test:coverage', ['test:shard', 'coverage:check']]]);

for (const workflowName of workflowNames) {
	test(`${workflowName} runs every part of npm run check across its gate jobs`, async () => {
		const { scripts } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
		const workflow = await readWorkflow(workflowName);
		const invoked = new Set(GATE_JOBS.flatMap((jobName) => [...npmScriptsRunBy(extractJob(workflow, jobName))]));
		const performed = new Set([...invoked].flatMap((name) => expandNpmScript(scripts, name)));

		for (const step of expandNpmScript(scripts, 'check')) {
			const substitutes = SHARDED_EQUIVALENT.get(step);
			if (substitutes === undefined) {
				assert.ok(performed.has(step), `${workflowName} never runs ${step}, which npm run check does`);
				continue;
			}
			for (const substitute of substitutes) {
				assert.ok(invoked.has(substitute), `${workflowName} must run ${substitute} to stand in for ${step}`);
			}
		}
	});

	test(`${workflowName} shards the Node suite by product and gates it on the merged coverage`, async () => {
		const workflow = await readWorkflow(workflowName);
		const tests = extractJob(workflow, 'tests');
		const coverage = extractJob(workflow, 'coverage');

		for (const shard of NODE_TEST_SHARD_IDS) {
			assert.ok(tests.includes(shard), `the test matrix must name the ${shard} shard`);
		}
		assert.match(tests, /npm run coverage:compact -- coverage\/shards\//u,
			'a shard has to hand its coverage on, or the merged threshold check is measuring less than the suite');
		assert.match(coverage, /^\s+needs: tests$/mu,
			'the thresholds may only be checked once every shard has reported');
	});

	test(`${workflowName} checks out the history the gate reads`, async () => {
		const workflow = await readWorkflow(workflowName);
		for (const jobName of ['quality', 'tests']) {
			assert.deepEqual(
				[...extractJob(workflow, jobName).matchAll(/^\s+fetch-depth:\s*(\d+)\s*$/gmu)].map((match) => match[1]),
				['0'],
				`${workflowName} ${jobName} must fetch history: audit:quality-results resolves recorded revisions `
					+ 'and tests/milestone-5-handoff.test.js resolves HEAD^',
			);
		}
	});

	test(`${workflowName} publishes the verified build from exactly one gate job`, async () => {
		const workflow = await readWorkflow(workflowName);
		const publishers = GATE_JOBS.filter((jobName) => extractJob(workflow, jobName).includes('verified-site-build'));
		assert.deepEqual(publishers, ['quality'],
			'the browser jobs download that artifact, so exactly one gate job may produce it');
	});
}
