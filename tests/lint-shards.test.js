/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	LINT_SHARD_IDS,
	classifyLintFile,
	isLintableRepositoryPath,
	parseLintSelection,
	selectChangedLintFiles,
} from '../scripts/lib/lint-shards.mjs';

const ROOT = new URL('../', import.meta.url).pathname.replace(/\/$/u, '');

function repositoryFiles() {
	return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
		cwd: ROOT,
		encoding: 'utf8',
	}).split('\0').filter(Boolean);
}

test('every repository lint file belongs to exactly one bounded shard', () => {
	const lintFiles = repositoryFiles().filter(isLintableRepositoryPath);
	assert.ok(lintFiles.length > 0, 'expected the repository to contain lintable files');

	const assignments = lintFiles.map((file) => [file, classifyLintFile(file)]);
	assert.ok(assignments.every(([, shard]) => LINT_SHARD_IDS.includes(shard)));
	assert.equal(new Set(assignments.map(([file]) => file)).size, lintFiles.length);

	const counts = new Map(LINT_SHARD_IDS.map((shard) => [shard, 0]));
	for (const [, shard] of assignments) counts.set(shard, counts.get(shard) + 1);
	assert.ok(
		Math.max(...counts.values()) < lintFiles.length / 4,
		`a lint shard has regrown too large: ${JSON.stringify(Object.fromEntries(counts))}`,
	);
});

test('lint shards preserve semantic ownership before subdividing large trees', () => {
	assert.match(classifyLintFile('src/common/editor/model.ts'), /^source-common-[12]$/u);
	assert.equal(classifyLintFile('src/framescaper/App.tsx'), 'source-products');
	assert.equal(classifyLintFile('src/soundscaper/App.tsx'), 'source-products');
	assert.match(classifyLintFile('tests/audio-editor-model.test.js'), /^tests-[123]$/u);
	assert.equal(classifyLintFile('desktop/main.ts'), 'desktop');
	assert.equal(classifyLintFile('scripts/check-build.mjs'), 'tooling');
	assert.equal(classifyLintFile('eslint.config.mjs'), 'tooling');
});

test('lint file discovery follows the extensions and ignores in the ESLint config', () => {
	for (const file of ['src/a.js', 'src/a.jsx', 'src/a.mjs', 'src/a.cjs', 'src/a.ts', 'src/a.tsx', 'src/a.mts', 'src/a.cts']) {
		assert.equal(isLintableRepositoryPath(file), true, file);
	}
	for (const file of [
		'src/a.css',
		'node_modules/package/index.js',
		'vendor/library/index.js',
		'handbook/dist/chunk.js',
		'src/common/editor/codec/native/generated.js',
	]) {
		assert.equal(isLintableRepositoryPath(file), false, file);
	}
});

test('changed lint includes modified and untracked lint files once', () => {
	assert.deepEqual(
		selectChangedLintFiles(
			['src/edited.ts', 'README.md', 'tests/edited.test.ts', 'src/edited.ts'],
			['src/new.tsx', 'vendor/ignored.js', 'tests/edited.test.ts'],
		),
		['src/edited.ts', 'src/new.tsx', 'tests/edited.test.ts'],
	);
});

test('lint selection accepts a shard or changed files, but not both', () => {
	assert.deepEqual(parseLintSelection([]), { changed: false, shard: null });
	assert.deepEqual(parseLintSelection(['--changed']), { changed: true, shard: null });
	for (const shard of LINT_SHARD_IDS) {
		assert.deepEqual(parseLintSelection([`--shard=${shard}`]), { changed: false, shard });
	}
	assert.throws(() => parseLintSelection(['--changed', '--shard=desktop']), /cannot be combined/u);
	assert.throws(() => parseLintSelection(['--shard=everything']), /Unknown lint shard/u);
	assert.throws(() => parseLintSelection(['--stripe=1/8']), /Unknown lint selection argument/u);
});

test('package scripts and agent guidance use the bounded lint entry points', () => {
	const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
	assert.equal(packageJson.scripts.lint, 'node scripts/run-lint.mjs');
	assert.equal(packageJson.scripts['lint:changed'], 'node scripts/run-lint.mjs --changed');

	const guidance = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');
	assert.match(guidance, /lint added and modified lintable files with `npm run lint:changed`/u);
	assert.match(guidance, /complete repository lint.*CI\/pre-merge gate/u);
});
