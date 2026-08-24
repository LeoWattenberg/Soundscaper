#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { writeStructuralQualityBudgetEvidence } from './quality-budget-evidence.mjs';

const execFileAsync = promisify(execFile);
const CONFIG_URL = new URL('../config/quality-budgets.json', import.meta.url);
const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));

const TEST_FILES = Object.freeze({
	'm2-direct-stem-archives-v3': Object.freeze([
		'tests/audio-editor-export-direct-compressed-stem-stream.test.ts',
		'tests/audio-editor-export-direct-seven-zip-stem-stream.test.ts',
		'tests/audio-editor-export-direct-stem-stream.test.ts',
		// Asserts the published 64 KiB maximum input-slice bound the evidence
		// metrics republish from the fixture specification.
		'tests/audio-editor-sequential-zip32-stream.test.ts',
		'tests/production-direct-stem-zip-security.test.js',
	]),
	'm2-direct-compressed-output-v2': Object.freeze([
		'tests/audio-editor-export-direct-compressed-service.test.ts',
		'tests/audio-editor-export-direct-offline-compressed-service.test.ts',
		'tests/audio-editor-ffmpeg-output-stream.test.ts',
		'tests/production-direct-compressed-security.test.js',
	]),
	'm2-direct-mp4-webm-video-output-v1': Object.freeze([
		'tests/audio-editor-export-direct-video.test.ts',
		'tests/audio-editor-ffmpeg-output-stream.test.ts',
		'tests/production-direct-video-security.test.js',
	]),
});

export async function collectDirectStructuralQualityEvidence(options, dependencies = {}) {
	const testFiles = TEST_FILES[options.workloadId];
	if (!testFiles) throw new Error(`Unsupported direct structural workload ${options.workloadId}.`);
	const loadConfig = dependencies.loadConfig ?? loadQualityConfig;
	const runTests = dependencies.runTests ?? runFocusedTests;
	const writeEvidence = dependencies.writeEvidence ?? writeStructuralQualityBudgetEvidence;
	const config = await loadConfig();
	const matches = Array.isArray(config.fixtures)
		? config.fixtures.filter((fixture) => isRecord(fixture) && fixture.id === options.workloadId)
		: [];
	if (matches.length !== 1) {
		throw new Error(`Quality config must contain exactly one fixture for ${options.workloadId}.`);
	}
	const fixture = matches[0];
	if (!isRecord(fixture.specification)) {
		throw new Error(`Quality fixture ${options.workloadId} has no structural specification.`);
	}
	const { stdout, stderr } = await runTests(testFiles);
	return writeEvidence({
		configPath: CONFIG_URL,
		outputDirectory: options.outputDirectory,
		workloadId: options.workloadId,
		metrics: structuralMetricsForFixture(options.workloadId, fixture.specification),
		observations: {
			profile: 'focused-direct-structural-node-v1',
			fixtureId: options.workloadId,
			generatorRevision: fixture.specification.generatorRevision,
			testFiles,
			testStdout: stdout,
			testStderr: stderr,
		},
	});
}

export function structuralMetricsForFixture(workloadId, specification) {
	if (workloadId === 'm2-direct-stem-archives-v3') {
		return {
			'directStems.maximumInputSliceBytes': specification.inputSliceBytes,
			'directStems.maximumOwnedCompressedStemBytes': specification.maximumOwnedCompressedStemBytes,
			'directStems.maximumOwnedEncodedStems': specification.compressedMaximumOwnedEncodedStems,
			'directStems.finalArchiveBlobBytes': specification.directRouteFinalZipBlobConstructions,
			'directStems.partialPublishedOutputs': specification.partialPublishedOutputs,
		};
	}
	if (workloadId === 'm2-direct-compressed-output-v2') {
		return {
			'directCompressed.maximumStagingBytes': specification.offlineCentralUsefulBinaryAdmissionCeilingBytes,
			'directCompressed.maximumOutputRangeBytes': specification.maximumOutputRangeBytes,
			'directCompressed.maximumConcurrentRangeReads': specification.maximumConcurrentRangeReads,
			'directCompressed.retainedFinalOutputBytes': specification.retainedFinalOutputBytes,
			'directCompressed.partialPublishedOutputs': specification.partialPublishedOutputs,
		};
	}
	if (workloadId === 'm2-direct-mp4-webm-video-output-v1') {
		return {
			'directVideo.maximumOutputRangeBytes': specification.maximumOutputRangeBytes,
			'directVideo.maximumConcurrentRangeReads': specification.maximumConcurrentRangeReads,
			'directVideo.maximumConcurrentSinkWrites': specification.maximumConcurrentSinkWrites,
			'directVideo.retainedFinalOutputBytes': specification.retainedFinalOutputBytes,
			'directVideo.partialPublishedOutputs': specification.partialPublishedOutputs,
		};
	}
	throw new Error(`Unsupported direct structural workload ${workloadId}.`);
}

async function loadQualityConfig() {
	return JSON.parse(await readFile(CONFIG_URL, 'utf8'));
}

async function runFocusedTests(testFiles) {
	return execFileAsync(process.execPath, ['--import', 'tsx', '--import', new URL('./node-style-asset-loader.mjs', import.meta.url).pathname, '--test', ...testFiles], {
		cwd: REPOSITORY_ROOT,
		encoding: 'utf8',
		maxBuffer: 32 * 1024 * 1024,
	});
}

function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function main() {
	if (process.argv.length < 3 || process.argv.length > 4) {
		process.stderr.write(
			'Usage: node scripts/collect-m2-direct-structural-quality.mjs <workload-id> [output-directory]\n',
		);
		process.exitCode = 2;
		return;
	}
	const outputDirectory = resolve(
		process.argv[3] ?? fileURLToPath(new URL('../test-results/quality/m2-resources', import.meta.url)),
	);
	const result = await collectDirectStructuralQualityEvidence({
		outputDirectory,
		workloadId: process.argv[2],
	});
	process.stdout.write(`${JSON.stringify(result.evaluation, null, '\t')}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	await main();
}
