/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { load } = require('js-yaml') as { load: (source: string) => { jobs: Record<string, { 'timeout-minutes': unknown }> } };

for (const [workflow, id, context, windowsBudget, otherBudget] of [
	['desktop-preview', 'publish-assistance-runtime-handoff', 'matrix.target.platform', 180, 90],
	['desktop-preview', 'soundscaper-project-library-lease-matrix', 'matrix.target.platform', 240, 90],
	['update-ai-assets', 'publish', 'matrix.target.platform', 180, 90],
	['soundscaper-professional-native-build', 'build', 'matrix.platform', 180, 120],
] as const) test(`${workflow}/${id} bounds the full Windows CPU and GPU build separately`, async () => {
	const source = await readFile(new URL(`../.github/workflows/${workflow}.yml`, import.meta.url), 'utf8');
	const job = load(source).jobs[id];
	assert.ok(job);
	assert.equal(job['timeout-minutes'], `\${{ ${context} == 'win' && ${windowsBudget} || ${otherBudget} }}`);
});

test('Windows preflights exercise real compiler descendant termination before runtime staging', async () => {
	for (const workflow of ['quality', 'soundscaper-professional-native-build']) {
		const source = await readFile(new URL(`../.github/workflows/${workflow}.yml`, import.meta.url), 'utf8');
		const start = source.indexOf('- name: Verify Windows GPU CMake recipes');
		assert.ok(start > 0);
		const step = source.slice(start, source.indexOf('\n      - ', start + 1));
		assert.ok(step.includes('tests/desktop-assistance-build-process.test.ts'));
	}
});
