/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import { LINT_SHARD_IDS } from '../scripts/lib/lint-shards.mjs';
import { NODE_TEST_SHARD_IDS } from '../scripts/lib/node-test-shards.mjs';
import { expandNpmScript, extractJob, npmScriptsRunBy, readWorkflow } from './helpers/workflow-jobs.js';

// `npm run check` is the canonical gate. Neither workflow runs it as one
// command, and they do not divide it the same way, so each declares the jobs
// that have to add back up to it. Quality shards the static checks so the jobs
// behind them start about ninety seconds in rather than seven and a half
// minutes in; the nightly runs them as one job because nothing waits on it in a
// hurry and its release scope has to be resolved there anyway.
const WORKFLOWS = new Map([
	['quality.yml', { staticJobs: ['build', 'lint', 'typecheck', 'audits'], buildJob: 'build', historyJobs: ['audits'] }],
	['desktop-preview.yml', { staticJobs: ['quality'], buildJob: 'quality', historyJobs: ['quality'] }],
]);

// `test:coverage` runs the whole suite in one process and checks the thresholds
// on the way out. Split up, that is one shard per product plus the job that
// checks the thresholds over the union of what the shards recorded.
const SHARDED_EQUIVALENT = new Map([['test:coverage', ['test:shard', 'coverage:check']]]);

test('quality only cancels superseded pull-request runs', async () => {
	const workflow = await readWorkflow('quality.yml');
	const header = workflow.slice(0, workflow.indexOf('\njobs:\n'));

	assert.match(
		header,
		/^ {2}cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}$/mu,
		'running main and manually dispatched work must not be interrupted by a newer invocation',
	);
});

test('desktop preview only supersedes automatic workflow-run packaging', async () => {
	const workflow = await readWorkflow('desktop-preview.yml');
	const header = workflow.slice(0, workflow.indexOf('\njobs:\n'));

	assert.match(
		header,
		/^ {2}group: desktop-preview-and-nightly-\$\{\{ github\.event_name == 'workflow_run' && 'workflow-run' \|\| github\.run_id \}\}$/mu,
		'manual, scheduled, and tagged runs need unique groups so automatic runs cannot cancel them',
	);
	assert.match(
		header,
		/^ {2}cancel-in-progress: \$\{\{ github\.event_name == 'workflow_run' \}\}$/mu,
		'only automatic workflow-run packaging may cancel an older automatic packaging run',
	);
});

test('npm run typecheck still covers every project in the tree', async () => {
	const { scripts } = await readPackageJson();
	const checked = new Set();
	const pending = ['typecheck'];
	for (const name of pending) {
		for (const match of scripts[name].matchAll(/tsc -p (\S+)/gu)) checked.add(match[1]);
		for (const match of scripts[name].matchAll(/npm run ([\w:-]+)/gu)) {
			if (!pending.includes(match[1])) pending.push(match[1]);
		}
	}

	const projects = (await readdir(new URL('../', import.meta.url)))
		.filter((entry) => /^tsconfig\..+\.json$/u.test(entry) || entry === 'tsconfig.json')
		.filter((entry) => entry !== 'tsconfig.base.json');

	assert.deepEqual([...checked].sort(), projects.sort(),
		'splitting typecheck across jobs may not quietly drop a project from the gate');
});

test('quality shards lint across the shards the lint runner defines', async () => {
	const lint = extractJob(await readWorkflow('quality.yml'), 'lint');

	assert.match(lint, /npm run lint -- --shard=\$\{\{ matrix\.shard \}\}/u,
		'each lint job must lint only its own shard, or the split saves nothing');
	for (const shard of LINT_SHARD_IDS) {
		assert.ok(lint.includes(`- ${shard}\n`), `the lint matrix must name the ${shard} shard`);
	}
});

test('quality runs its static checks in parallel and gates everything behind all of them', async () => {
	const workflow = await readWorkflow('quality.yml');
	const { staticJobs } = WORKFLOWS.get('quality.yml');
	const gate = `needs: [${staticJobs.join(', ')}]`;

	for (const jobName of staticJobs) {
		assert.doesNotMatch(extractJob(workflow, jobName), /^\s+needs:/mu,
			`${jobName} may not wait on another static check, or the gate is serial again`);
	}
	for (const jobName of ['native-platform-compile', 'tests', 'browser', 'firefox']) {
		assert.ok(extractJob(workflow, jobName).includes(gate),
			`${jobName} must wait on the whole static gate, so a red check cannot burn its runners`);
	}
});

for (const [workflowName, { staticJobs, buildJob, historyJobs }] of WORKFLOWS) {
	const gateJobs = [...staticJobs, 'tests', 'coverage'];

	test(`${workflowName} runs every part of npm run check across its gate jobs`, async () => {
		const { scripts } = await readPackageJson();
		const workflow = await readWorkflow(workflowName);
		const invoked = new Set(gateJobs.flatMap((jobName) => [...npmScriptsRunBy(extractJob(workflow, jobName))]));
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
		assert.match(coverage, /^\s+needs: (?:tests|\[[^\]\n]*\btests\b[^\]\n]*\])$/mu,
			'the thresholds may only be checked once every shard has reported');
	});

	test(`${workflowName} checks out the history the gate reads`, async () => {
		const workflow = await readWorkflow(workflowName);
		for (const jobName of [...historyJobs, 'tests']) {
			assert.deepEqual(
				[...extractJob(workflow, jobName).matchAll(/^\s+fetch-depth:\s*(\d+)\s*$/gmu)].map((match) => match[1]),
				['0'],
				`${workflowName} ${jobName} must fetch history because npm run audit:ci and `
					+ 'tests/milestone-5-package-audit.test.js read revision-bound Git inputs',
			);
		}
	});

	test(`${workflowName} publishes the verified build from exactly one gate job`, async () => {
		const workflow = await readWorkflow(workflowName);
		const publishers = gateJobs.filter((jobName) => extractJob(workflow, jobName).includes('verified-site-build'));
		assert.deepEqual(publishers, [buildJob],
			'the browser jobs download that artifact, so exactly one gate job may produce it');
	});
}

async function readPackageJson() {
	return JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
}
