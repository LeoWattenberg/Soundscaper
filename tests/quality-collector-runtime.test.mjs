/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	assertNonHostedQualityCollector,
	isDirectExecution,
	normalizeQualityCollectorOptions,
	parseQualityCollectorCliOptions,
	readQualityCollectorMeasurement,
	runQualityCollectorMain,
	sameOrderedStrings,
	writeQualityCollectorResult,
} from '../scripts/lib/quality-collector-runtime.mjs';

test('shared collector option normalization accepts exactly two bounded paths', () => {
	assert.deepEqual(normalizeQualityCollectorOptions({
		measurementPath: '/lab/record.json',
		outputDirectory: '/results',
	}), {
		measurementPath: '/lab/record.json',
		outputDirectory: '/results',
	});
	assert.throws(
		() => normalizeQualityCollectorOptions({
			measurementPath: '/lab/record.json', outputDirectory: '/results', qualify: true,
		}),
		/collector options must contain the exact fields\./u,
	);
	assert.throws(
		() => normalizeQualityCollectorOptions({ measurementPath: '', outputDirectory: '/results' }),
		/measurementPath must be a bounded string\./u,
	);
});

test('shared collector CLI parsing preserves the milestone-specific diagnostics', () => {
	assert.deepEqual(
		parseQualityCollectorCliOptions(['--measurement', 'record.json', 'out'], 'M9'),
		{ measurementPath: 'record.json', outputDirectory: 'out' },
	);
	assert.deepEqual(
		parseQualityCollectorCliOptions([], 'M9'),
		{ measurementPath: null, outputDirectory: null },
	);
	assert.throws(
		() => parseQualityCollectorCliOptions(['--measurement'], 'M9'),
		/M9 collector option --measurement requires a path\./u,
	);
	assert.throws(
		() => parseQualityCollectorCliOptions(['--measurement', 'one', '--measurement', 'two'], 'M9'),
		/M9 collector accepts one measurement path\./u,
	);
	assert.throws(
		() => parseQualityCollectorCliOptions(['--qualify'], 'M9'),
		/Unknown M9 collector option --qualify\./u,
	);
	assert.throws(
		() => parseQualityCollectorCliOptions(['one', 'two'], 'M9'),
		/M9 collector accepts one output directory\./u,
	);
	assert.throws(
		() => parseQualityCollectorCliOptions(['valid', 3], 'M9'),
		/M9 collector CLI arguments must be strings\./u,
	);
});

test('shared hosted-runner admission reads only own string data properties', () => {
	const rejection = (key) => `M9 rejects ${key}.`;
	assert.doesNotThrow(() => assertNonHostedQualityCollector({}, rejection));
	assert.doesNotThrow(() => assertNonHostedQualityCollector({ CI: '' }, rejection));
	assert.throws(
		() => assertNonHostedQualityCollector({ BUILDKITE: 'true' }, rejection),
		/M9 rejects BUILDKITE\./u,
	);
	assert.doesNotThrow(
		() => assertNonHostedQualityCollector(Object.create({ CI: 'true' }), rejection),
	);
	const accessorEnvironment = {};
	Object.defineProperty(accessorEnvironment, 'CI', { get: () => 'true' });
	assert.throws(
		() => assertNonHostedQualityCollector(accessorEnvironment, rejection),
		/Collector environment CI must be an own string data property\./u,
	);
	assert.throws(
		() => assertNonHostedQualityCollector(null, rejection),
		/Collector environment must expose own data properties\./u,
	);
});

test('shared measurement reading wraps invalid JSON without losing its cause', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-quality-runtime-read-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const path = join(directory, 'measurement.json');
	await writeFile(path, '{');
	await assert.rejects(
		() => readQualityCollectorMeasurement(path, 'M9 measurement'),
		(error) => {
			assert.match(error.message, /^M9 measurement is unavailable or invalid:/u);
			assert.ok(error.cause instanceof Error);
			return true;
		},
	);
});

test('shared result output supports one validated raw artifact and exclusive writes', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-quality-runtime-write-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const result = { schemaVersion: 1, status: 'passed', metric: 1 };
	const raw = { schemaVersion: 1, samples: [1, 2] };
	const written = await writeQualityCollectorResult(directory, result, {
		resultLabel: 'M9 diagnostic result',
		resultFilename: (snapshot) => `m9.${snapshot.status}.json`,
		prepareRawArtifact: (snapshot) => {
			assert.notEqual(snapshot, result);
			return { filename: 'm9.raw.json', value: raw };
		},
	});
	assert.deepEqual(written, {
		rawPath: join(directory, 'm9.raw.json'),
		resultPath: join(directory, 'm9.passed.json'),
		result,
	});
	assert.equal(Object.isFrozen(written), true);
	assert.deepEqual(JSON.parse(await readFile(written.rawPath, 'utf8')), raw);
	assert.deepEqual(JSON.parse(await readFile(written.resultPath, 'utf8')), result);
	await assert.rejects(
		writeQualityCollectorResult(directory, result, {
			resultLabel: 'M9 diagnostic result',
			resultFilename: () => 'm9.passed.json',
		}),
		/EEXIST/u,
	);
	await assert.rejects(
		writeQualityCollectorResult('/unused', { ...result, status: 'accepted' }, {
			resultLabel: 'M9 diagnostic result',
			resultFilename: () => 'unused.json',
		}),
		/M9 diagnostic result has unsupported status accepted\./u,
	);
});

test('shared main plumbing preserves usage, path resolution, JSON output, and failed exit status', async () => {
	const usageErrors = [];
	const usageExitCodes = [];
	await runQualityCollectorMain({
		parseOptions: (args) => parseQualityCollectorCliOptions(args, 'M9'),
		collect: () => assert.fail('missing measurement must not collect'),
		defaultOutputDirectory: new URL('../test-results/quality/m9', import.meta.url),
		usage: 'M9 usage\n',
	}, {
		args: [],
		writeStderr: (value) => usageErrors.push(value),
		setExitCode: (value) => usageExitCodes.push(value),
	});
	assert.deepEqual(usageErrors, ['M9 usage\n']);
	assert.deepEqual(usageExitCodes, [2]);

	const outputs = [];
	const exitCodes = [];
	let options = null;
	await runQualityCollectorMain({
		parseOptions: (args) => parseQualityCollectorCliOptions(args, 'M9'),
		collect: (value) => {
			options = value;
			return Promise.resolve({ result: { status: 'failed', metric: 1 } });
		},
		defaultOutputDirectory: '/default-output',
		usage: 'unused',
	}, {
		args: ['--measurement', 'relative.json', 'relative-output'],
		writeStdout: (value) => outputs.push(value),
		setExitCode: (value) => exitCodes.push(value),
	});
	assert.deepEqual(options, {
		measurementPath: resolve('relative.json'),
		outputDirectory: resolve('relative-output'),
	});
	assert.deepEqual(outputs, [`${JSON.stringify({ status: 'failed', metric: 1 }, null, '\t')}\n`]);
	assert.deepEqual(exitCodes, [1]);
	assert.equal(isDirectExecution(import.meta.url, '/definitely/not-this-test.mjs'), false);
	assert.equal(isDirectExecution(import.meta.url, fileURLToPath(import.meta.url)), true);
});

test('shared ordered comparison remains exact', () => {
	assert.equal(sameOrderedStrings(['one', 'two'], ['one', 'two']), true);
	assert.equal(sameOrderedStrings(['two', 'one'], ['one', 'two']), false);
	assert.equal(sameOrderedStrings(['one'], ['one', 'two']), false);
	assert.equal(sameOrderedStrings('one', ['one']), false);
});
