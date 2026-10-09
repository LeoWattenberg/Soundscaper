/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const WORKFLOW_JOBS = [
	['quality.yml', ['browser', 'firefox']],
	['desktop-preview.yml', ['browser', 'firefox']],
	['soundscaper-stable-1.yml', ['browser']],
] as const;

for (const [workflowName, jobs] of WORKFLOW_JOBS) {
	for (const jobName of jobs) {
		test(`${workflowName} ${jobName} provisions the independent interchange readers before browser tests`, async () => {
			const workflow = await readFile(new URL(`../.github/workflows/${workflowName}`, import.meta.url), 'utf8');
			const job = workflow.split(`\n  ${jobName}:\n`)[1]?.split(/\n {2}[a-z][a-z0-9-]*:\n/u)[0];
			assert.ok(job, `Missing ${jobName} job`);
			assert.match(job, /uses: actions\/setup-python@[a-f0-9]{40}/u);
			assert.match(job, /python-version: '3\.12'/u);
			const provision = job.indexOf('run: npm run provision:interchange-conformance');
			const browserTests = job.search(/run: npm run test:browser(?::built)?(?:\s|$)/u);
			assert.ok(provision >= 0, 'Independent reference readers must be provisioned in every browser job');
			assert.ok(browserTests > provision, 'Provisioning must precede browser tests');
			const provisionStep = job.slice(0, provision).split(/\n {6}- /u).at(-1);
			assert.ok(provisionStep);
			assert.doesNotMatch(provisionStep, /\n\s+if:/u, 'Every engine and shard needs the reference readers');
		});
	}
}
