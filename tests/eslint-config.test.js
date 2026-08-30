/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { ESLint } from 'eslint';

const execFileAsync = promisify(execFile);
const ROOT = new URL('..', import.meta.url).pathname;

const CORE_RECOMMENDED_RULES = [
	'no-constant-binary-expression',
	'no-dupe-else-if',
	'no-duplicate-case',
	'no-fallthrough',
	'no-self-assign',
	'no-unsafe-optional-chaining',
	'preserve-caught-error',
	'use-isnan',
];

test('TypeScript receives the core recommended ESLint rules and the typed unused-variable rule', async () => {
	const eslint = new ESLint({ cwd: ROOT });
	const config = await eslint.calculateConfigForFile('src/common/editor/project-media-types.ts');

	for (const rule of CORE_RECOMMENDED_RULES) {
		assert.equal(config.rules?.[rule]?.[0], 2, `${rule} must apply to TypeScript`);
	}
	assert.equal(config.rules?.['no-unused-vars']?.[0], 0);
	assert.equal(config.rules?.['@typescript-eslint/no-unused-vars']?.[0], 2);
});

test('a new TypeScript core-recommended violation is not hidden by the legacy baseline', async () => {
	const eslint = new ESLint({ cwd: ROOT, applySuppressions: true });
	const [result] = await eslint.lintText(
		'const value = NaN;\nif (value === NaN) {}\n',
		{ filePath: 'src/common/editor/project-media-types.ts' },
	);

	assert.ok(result.messages.some(message => message.ruleId === 'use-isnan'));
	assert.equal(
		result.suppressedMessages.some(message => message.ruleId === 'use-isnan'),
		false,
	);
});

test('the lint CLI rejects a stale bulk suppression', async t => {
	const fixtureDirectory = await mkdtemp(path.join(tmpdir(), 'soundscaper-eslint-suppressions-'));
	t.after(async () => {
		await rm(fixtureDirectory, { force: true, recursive: true });
	});
	const suppressionsPath = path.join(fixtureDirectory, 'eslint-suppressions.json');
	await writeFile(
		suppressionsPath,
		`${JSON.stringify({
			'src/common/editor/project-media-types.ts': {
				'use-isnan': { count: 1 },
			},
		}, null, 2)}\n`,
	);

	await assert.rejects(
		execFileAsync(
			path.join(ROOT, 'node_modules/.bin/eslint'),
			[
				'src/common/editor/project-media-types.ts',
				'--suppressions-location',
				suppressionsPath,
			],
			{ cwd: ROOT },
		),
		error => {
			assert.equal(error.code, 2);
			assert.match(
				error.stderr,
				/There are suppressions left that do not occur anymore/,
			);
			return true;
		},
	);
});
