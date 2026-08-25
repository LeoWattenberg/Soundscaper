#!/usr/bin/env node

import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
	describeNodeTestSelection,
	parseNodeTestSelection,
	selectNodeTestFiles,
} from './lib/node-test-shards.mjs';

const root = resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const coverageArgument = argv.find((argument) => argument.startsWith('--coverage-directory='));
const selection = parseNodeTestSelection(argv.filter((argument) => argument !== coverageArgument));
const testFiles = selectNodeTestFiles(root, selection);

if (testFiles.length === 0) {
	throw new Error(`No Node test files were found for ${describeNodeTestSelection(selection)}.`);
}

const env = { ...process.env };
if (coverageArgument !== undefined) {
	// Raw V8 profiles are collected directly rather than through c8: a shard only
	// has to hand its range data to the job that checks the thresholds over the
	// union, and c8 would spend minutes building a report nobody reads.
	const coverageDirectory = resolve(root, coverageArgument.slice('--coverage-directory='.length));
	rmSync(coverageDirectory, { recursive: true, force: true });
	mkdirSync(coverageDirectory, { recursive: true });
	env.NODE_V8_COVERAGE = coverageDirectory;
}

const styleAssetLoader = resolve(root, 'scripts/node-style-asset-loader.mjs');
const result = spawnSync(process.execPath, ['--import', 'tsx', '--import', styleAssetLoader, '--test', ...testFiles], {
	cwd: root,
	env,
	stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.signal) throw new Error(`Node test runner terminated with ${result.signal}.`);
process.exitCode = result.status ?? 1;
