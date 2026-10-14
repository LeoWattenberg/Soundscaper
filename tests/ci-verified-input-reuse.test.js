/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { extractJob, readWorkflow } from './helpers/workflow-jobs.js';

test('Preview and Stable test jobs verify restored installed trees before their consumers', async () => {
	for (const [workflow, jobs] of [['desktop-preview.yml', ['tests', 'browser', 'firefox']], ['soundscaper-stable-1.yml', ['tests', 'browser']]]) {
		for (const name of jobs) assert.match(extractJob(await readWorkflow(workflow), name), /uses: \.\/\.github\/actions\/verified-node-dependencies/u);
	}
	const action = await readFile(new URL('../.github/actions/verified-node-dependencies/action.yml', import.meta.url), 'utf8');
	assert.match(action, /verify dependencies >> "\$GITHUB_OUTPUT"/u);
	assert.match(action, /if: steps\.verification\.outputs\.valid != 'true'[\s\S]*?run: npm ci/u);
	assert.match(action, /actions\/cache\/restore@[a-f0-9]{40}/u);
	assert.match(action, /actions\/cache\/save@[a-f0-9]{40}/u);
	assert.match(action, /key: verified-node-modules-v1-\$\{\{ steps\.identity\.outputs\.key \}\}-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/u);
	assert.match(action, /restore-keys: verified-node-modules-v1-\$\{\{ steps\.identity\.outputs\.key \}\}-\s*\n/u);
});

test('Firefox shards reuse verified engine bytes while preserving host dependencies and the live audio clock proof', async () => {
	for (const workflow of ['quality.yml', 'desktop-preview.yml']) {
		const job = extractJob(await readWorkflow(workflow), 'firefox');
		assert.match(job, /uses: \.\/\.github\/actions\/verified-firefox/u);
		assert.match(job, /ci-firefox-pulseaudio\.sh/u);
		assert.match(job, /ci-firefox-audio-clock\.mjs/u);
		assert.match(job, /shard: \[1, 2, 3, 4, 5, 6\]/u);
	}
	const action = await readFile(new URL('../.github/actions/verified-firefox/action.yml', import.meta.url), 'utf8');
	assert.match(action, /run: npx playwright install-deps firefox/u);
	assert.match(action, /verify firefox >> "\$GITHUB_OUTPUT"/u);
	assert.match(action, /run: node scripts\/ci-input-cache\.mjs reset firefox/u);
	assert.match(action, /if: steps\.verification\.outputs\.valid != 'true'[\s\S]*?run: npx playwright install firefox/u);
	assert.match(action, /actions\/cache\/save@[a-f0-9]{40}/u);
});
