#!/usr/bin/env node

import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const testDirectory = resolve(root, 'tests');
const testFiles = readdirSync(testDirectory, { withFileTypes: true })
	.filter((entry) => entry.isFile() && /\.test\.(?:[cm]?[jt]s|[jt]sx)$/u.test(entry.name))
	.map((entry) => resolve(testDirectory, entry.name))
	.sort();

if (testFiles.length === 0) throw new Error('No Node test files were found.');

const styleAssetLoader = resolve(root, 'scripts/node-style-asset-loader.mjs');
const result = spawnSync(process.execPath, ['--import', 'tsx', '--import', styleAssetLoader, '--test', ...testFiles], {
	cwd: root,
	env: process.env,
	stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.signal) throw new Error(`Node test runner terminated with ${result.signal}.`);
process.exitCode = result.status ?? 1;
