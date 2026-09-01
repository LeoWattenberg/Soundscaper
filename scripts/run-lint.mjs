#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import {
	LINT_SHARD_IDS,
	parseLintSelection,
	partitionLintFiles,
	selectChangedLintFiles,
} from './lib/lint-shards.mjs';

const root = resolve(import.meta.dirname, '..');
const selection = parseLintSelection(process.argv.slice(2));
const files = selection.changed ? changedFiles() : repositoryFiles();
const shards = partitionLintFiles(files);
const selectedShards = selection.shard === null ? LINT_SHARD_IDS : [selection.shard];
const eslintExecutable = resolve(root, 'node_modules/eslint/bin/eslint.js');

let lintedFileCount = 0;
for (const shard of selectedShards) {
	const shardFiles = shards.get(shard);
	if (shardFiles.length === 0) continue;
	lintedFileCount += shardFiles.length;
	process.stdout.write(`Linting ${shard} (${shardFiles.length} files)...\n`);
	const result = spawnSync(process.execPath, [
		eslintExecutable,
		'--max-warnings', '0',
		'--no-warn-ignored',
		'--',
		...shardFiles,
	], {
		cwd: root,
		stdio: 'inherit',
	});
	if (result.error) throw result.error;
	if (result.signal) throw new Error(`ESLint shard ${shard} terminated with ${result.signal}.`);
	if (result.status !== 0) {
		process.exitCode = result.status ?? 1;
		break;
	}
}

if (lintedFileCount === 0) {
	process.stdout.write(selection.changed
		? 'No added or modified lintable files.\n'
		: 'No lintable files matched the requested shard.\n');
}

function repositoryFiles() {
	return gitFiles(['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
}

function changedFiles() {
	return selectChangedLintFiles(
		gitFiles(['diff', '--name-only', '--diff-filter=ACMR', '-z', 'HEAD']),
		gitFiles(['ls-files', '--others', '--exclude-standard', '-z']),
	);
}

function gitFiles(arguments_) {
	return execFileSync('git', arguments_, {
		cwd: root,
		encoding: 'utf8',
		maxBuffer: 10 * 1024 * 1024,
	}).split('\0').filter(Boolean);
}
