#!/usr/bin/env node

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
	describeNodeTestSelection,
	parseNodeTestSelection,
	partitionNodeTestExecutionBatches,
	selectNodeTestFiles,
} from './lib/node-test-shards.mjs';
import {
	assertRequiredLinuxNativeTestHost,
	REQUIRED_LINUX_NATIVE_SKIP_REPORT_ENV,
	requiredLinuxNativeSkipError,
} from './lib/required-linux-native-tests.mjs';
import {
	DESKTOP_RUNTIME_TEST_FIXTURE_ENV,
	needsDesktopRuntimeTestFixture,
} from './lib/node-test-desktop-runtime-fixture.ts';

const root = resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const coverageArgument = argv.find((argument) => argument.startsWith('--coverage-directory='));
const requireLinuxNative = argv.includes('--require-linux-native');
const selection = parseNodeTestSelection(argv.filter((argument) => (
	argument !== coverageArgument && argument !== '--require-linux-native'
)));
const testFiles = selectNodeTestFiles(root, selection);

if (requireLinuxNative) assertRequiredLinuxNativeTestHost(process.platform, process.arch);

if (testFiles.length === 0) {
	throw new Error(`No Node test files were found for ${describeNodeTestSelection(selection)}.`);
}

const env = { ...process.env };
let requiredNativeReportDirectory = null;
let requiredNativeReportPath = null;
if (requireLinuxNative) {
	requiredNativeReportDirectory = mkdtempSync(join(tmpdir(), 'soundscaper-required-native-tests-'));
	requiredNativeReportPath = join(requiredNativeReportDirectory, 'skips.txt');
	env[REQUIRED_LINUX_NATIVE_SKIP_REPORT_ENV] = requiredNativeReportPath;
}
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
const requiredNativeReporter = resolve(root, 'scripts/require-linux-native-tests-reporter.mjs');
const desktopRuntimeFixtureScript = resolve(root, 'scripts/lib/node-test-desktop-runtime-fixture.ts');
let desktopRuntimeFixtureDirectory = null;
// Only this invocation may supply a fixture; direct test runs compile normally.
delete env[DESKTOP_RUNTIME_TEST_FIXTURE_ENV];
let executionError = null;
let exitCode = 0;
try {
	for (const batch of partitionNodeTestExecutionBatches(testFiles)) {
		if (desktopRuntimeFixtureDirectory === null && needsDesktopRuntimeTestFixture(batch)) {
			// Compile once before the parallel consumers, with the same coverage
			// environment. Each consumer receives a private copy of these fresh bytes.
			desktopRuntimeFixtureDirectory = mkdtempSync(join(tmpdir(), 'soundscaper-node-desktop-runtime-'));
			const preparation = spawnSync(process.execPath, [
				desktopRuntimeFixtureScript, root, desktopRuntimeFixtureDirectory,
			], { cwd: root, env, stdio: 'inherit' });
			if (preparation.error || preparation.signal) {
				executionError = preparation.error ?? new Error(`Desktop test runtime compilation terminated with ${preparation.signal}.`);
				break;
			}
			if (preparation.status !== 0) {
				exitCode = preparation.status ?? 1;
				break;
			}
			env[DESKTOP_RUNTIME_TEST_FIXTURE_ENV] = desktopRuntimeFixtureDirectory;
		}
		const result = spawnSync(process.execPath, [
			'--import', 'tsx', '--import', styleAssetLoader,
			...(requireLinuxNative ? ['--test-reporter', requiredNativeReporter] : []),
			'--test', ...batch,
		], {
			cwd: root,
			env,
			stdio: 'inherit',
		});
		if (result.error) {
			executionError = result.error;
			break;
		}
		if (result.signal) {
			executionError = new Error(`Node test runner terminated with ${result.signal}.`);
			break;
		}
		if (result.status !== 0) exitCode = result.status ?? 1;
	}
} finally {
	if (desktopRuntimeFixtureDirectory !== null) {
		rmSync(desktopRuntimeFixtureDirectory, { recursive: true, force: true });
	}
}

let requiredNativeReport = '';
if (requiredNativeReportPath !== null) {
	try {
		requiredNativeReport = readFileSync(requiredNativeReportPath, 'utf8');
	} catch (error) {
		if (error?.code !== 'ENOENT') throw error;
	} finally {
		rmSync(requiredNativeReportDirectory, { recursive: true, force: true });
	}
}

if (executionError !== null) throw executionError;
const requiredNativeError = requiredLinuxNativeSkipError(requiredNativeReport);
if (requiredNativeError !== null) throw requiredNativeError;
process.exitCode = exitCode;
