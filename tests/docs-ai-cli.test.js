import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCliArguments } from '../scripts/docs-ai/cli.mjs';

test('Docs AI generation writes by default', () => {
	assert.deepEqual(parseCliArguments([
		'draft',
		'--facts', 'facts.json',
		'--output', 'draft.md',
	]), {
		command: 'draft',
		mode: 'write',
		facts: 'facts.json',
		output: 'draft.md',
	});
});

test('stdout and check modes are explicit and mutually exclusive', () => {
	assert.equal(parseCliArguments(['translate', '--stdout']).mode, 'stdout');
	assert.equal(parseCliArguments(['translate', '--check']).mode, 'check');
	assert.throws(
		() => parseCliArguments(['translate', '--stdout', '--check']),
		/cannot be combined/u,
	);
	assert.throws(
		() => parseCliArguments(['translate', '--check', '--stdout']),
		/cannot be combined/u,
	);
});
