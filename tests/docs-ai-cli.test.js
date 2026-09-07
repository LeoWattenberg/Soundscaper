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
		all: false,
		prune: false,
		strict: false,
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

test('a handbook run names the languages it acts on', () => {
	const parsed = parseCliArguments(['handbook', '--locale', 'fr,ja', '--pages', 'index.md', '--prune']);

	assert.equal(parsed.command, 'handbook');
	assert.equal(parsed.locale, 'fr,ja');
	assert.equal(parsed.pages, 'index.md');
	assert.equal(parsed.prune, true);
	assert.equal(parseCliArguments(['handbook', '--all']).all, true);
	assert.equal(parseCliArguments(['handbook', '--check']).mode, 'check');
	assert.equal(parseCliArguments(['handbook', '--check', '--strict']).strict, true);
});

test('a handbook run must say which languages it is for, and writes what it translates', () => {
	assert.throws(() => parseCliArguments(['handbook']), /needs --locale or --all/u);
	assert.throws(() => parseCliArguments(['handbook', '--all', '--locale', 'fr']), /cannot be combined/u);
	assert.throws(() => parseCliArguments(['handbook', '--locale', 'fr', '--stdout']), /no --stdout mode/u);
});
