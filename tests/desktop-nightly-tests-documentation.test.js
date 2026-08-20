/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('desktop documentation explains how to run and find nightly-with-tests results', async () => {
	const documentation = await readFile(new URL('../Technical_README.md', import.meta.url), 'utf8');

	assert.match(documentation, /choose\s+`nightly-with-tests`/iu);
	assert.match(documentation, /nightly-with-tests-(?:win|mac|linux)-<architecture>/iu);
	assert.match(documentation, /same directory.*`soundscaper-nightly-tests-playwright-/isu);
	for (const resultPath of [
		'run.json',
		'results.json',
		'junit.xml',
		'playwright-report/index.html',
		'test-results/',
		'console.log',
		'metrics/summary.json',
		'metrics/raw.json',
		'metrics/results.json',
		'metrics/console.log',
	]) assert.ok(documentation.includes(`\`${resultPath}\``), `${resultPath} is not documented`);
	assert.match(documentation, /one worker.*zero retries/isu);
	assert.match(documentation, /pending-external/iu);
	assert.match(documentation, /diagnostic.*not.*public release/isu);
});
