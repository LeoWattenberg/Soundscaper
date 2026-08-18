/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowNames = ['quality.yml', 'desktop-preview.yml'];

for (const workflowName of workflowNames) {
	test(`${workflowName} checks out the history required by quality cohort audits`, async () => {
		const workflow = await readFile(
			new URL(`../.github/workflows/${workflowName}`, import.meta.url),
			'utf8',
		);
		const job = extractJob(workflow, 'quality');

		// A wrapper is allowed — the job runs under a virtual display — but the
		// full check has to be what it wraps, and nothing may follow it on the line.
		assert.match(job, /^\s+run: (?:\S+(?: --?\S+)* )?npm run check$/mu);
		assert.deepEqual(
			[...job.matchAll(/^\s+fetch-depth:\s*(\d+)\s*$/gmu)].map((match) => match[1]),
			['0'],
			`${workflowName} quality checkout must fetch the history used by audit:quality-results`,
		);
	});
}

function extractJob(workflow, jobName) {
	const marker = `\n  ${jobName}:\n`;
	const start = workflow.indexOf(marker);
	assert.notEqual(start, -1, `missing ${jobName} workflow job`);
	const remainder = workflow.slice(start + marker.length);
	const nextJob = remainder.search(/^ {2}[a-z][a-z0-9-]*:\s*$/mu);
	return nextJob === -1 ? remainder : remainder.slice(0, nextJob);
}
