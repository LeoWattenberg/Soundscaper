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
// behind them can start once the build artifact exists; the desktop preview
// runs them as one job and resolves its release scope there.
const WORKFLOWS = new Map([
	['quality.yml', { staticJobs: ['build', 'lint', 'typecheck', 'audits'], buildJob: 'build', historyJobs: ['audits'] }],
	['desktop-preview.yml', { staticJobs: ['quality'], buildJob: 'quality', historyJobs: ['quality'] }],
]);

// `test:coverage` runs the whole Node suite and reports fresh local evidence.
// CI splits Node by owner and scores the union with its Chromium shards.
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

test('desktop preview never cancels scheduled, tagged, or manual distribution runs', async () => {
	const workflow = await readWorkflow('desktop-preview.yml');
	const header = workflow.slice(0, workflow.indexOf('\njobs:\n'));
	assert.match(header, /^ {2}group: desktop-preview-and-nightly-\$\{\{ github\.run_id \}\}$/mu);
	assert.match(header, /^ {2}cancel-in-progress: false$/mu);
	assert.doesNotMatch(header, /workflow_run:/u);
});

test('push and manual test artifact packaging cannot be cancelled by another run', async () => {
	const workflow = await readWorkflow('desktop-nightly-tests.yml');
	const header = workflow.slice(0, workflow.indexOf('\njobs:\n'));

	assert.match(
		header,
		/^ {2}group: desktop-test-artifacts-\$\{\{ github\.run_id \}\}$/mu,
		'test artifact runs need unique groups',
	);
	assert.match(header, /^ {2}cancel-in-progress: false$/mu);
	assert.doesNotMatch(header, /workflow_run:/u);
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

test('quality starts browser and Node checks after build and keeps static checks in the final gate', async () => {
	const workflow = await readWorkflow('quality.yml');
	const { staticJobs } = WORKFLOWS.get('quality.yml');
	const gate = `needs: [${staticJobs.join(', ')}]`;

	for (const jobName of staticJobs) {
		assert.doesNotMatch(extractJob(workflow, jobName), /^\s+needs:/mu,
			`${jobName} may not wait on another static check, or the gate is serial again`);
	}
	assert.ok(extractJob(workflow, 'native-platform-compile').includes(gate),
		'native compiles retain their complete static prerequisite');
	for (const jobName of ['tests', 'browser', 'firefox']) {
		assert.match(extractJob(workflow, jobName), /^\s+needs: build$/mu,
			`${jobName} must start once the verified build is ready`);
	}
	const coverage = extractJob(workflow, 'coverage');
	for (const jobName of ['tests', 'native-platform-compile', 'browser', 'lint', 'typecheck', 'audits']) {
		assert.match(coverage, new RegExp(`^\\s+needs: \\[[^\\]\\n]*\\b${jobName}\\b[^\\]\\n]*\\]$`, 'mu'),
			`coverage must wait for ${jobName} before reporting the union`);
	}
	const deploy = extractJob(workflow, 'deploy');
	for (const jobName of ['coverage', 'browser', 'firefox', 'native-platform-compile']) {
		assert.match(deploy, new RegExp(`^\\s+needs: \\[[^\\]\\n]*\\b${jobName}\\b[^\\]\\n]*\\]$`, 'mu'),
			`deployment must wait for ${jobName}`);
	}
});

test('quality gives both architecture ratchets the same event base revision', async () => {
	const audits = extractJob(await readWorkflow('quality.yml'), 'audits');
	const baseExpression = "${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || github.event_name == 'push' && github.event.before || github.sha }}";
	for (const variable of ['CONTROLLER_DOMAIN_BASE_REVISION', 'MAINTAINABILITY_BASE_REVISION']) {
		assert.ok(
			audits.includes(`${variable}: ${baseExpression}`),
			`${variable} must select the pull-request or push base used by the architecture gate`,
		);
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

	test(`${workflowName} shards the Node suite by owner and gates it on the merged coverage`, async () => {
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
