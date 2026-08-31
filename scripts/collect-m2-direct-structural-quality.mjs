#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { writeStructuralQualityBudgetDiagnostic } from './quality-budget-diagnostic.mjs';

const execFileAsync = promisify(execFile);
const CONFIG_URL = new URL('../config/quality-budgets.json', import.meta.url);
const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROFILE = 'focused-direct-structural-node-v2';

const METRIC_IDS = Object.freeze({
	'm2-direct-stem-archives-v3': Object.freeze([
		'directStems.maximumInputSliceBytes',
		'directStems.maximumOwnedCompressedStemBytes',
		'directStems.maximumOwnedEncodedStems',
		'directStems.finalArchiveBlobBytes',
		'directStems.partialPublishedOutputs',
	]),
	'm2-direct-compressed-output-v2': Object.freeze([
		'directCompressed.maximumStagingBytes',
		'directCompressed.maximumOutputRangeBytes',
		'directCompressed.maximumConcurrentRangeReads',
		'directCompressed.retainedFinalOutputBytes',
		'directCompressed.partialPublishedOutputs',
	]),
	'm2-direct-mp4-webm-video-output-v1': Object.freeze([
		'directVideo.maximumOutputRangeBytes',
		'directVideo.maximumConcurrentRangeReads',
		'directVideo.maximumConcurrentSinkWrites',
		'directVideo.retainedFinalOutputBytes',
		'directVideo.partialPublishedOutputs',
	]),
});

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

export async function collectDirectStructuralQualityDiagnostic(options, dependencies = {}) {
	const testFiles = TEST_FILES[options.workloadId];
	if (!testFiles) throw new Error(`Unsupported direct structural workload ${options.workloadId}.`);
	const runTests = dependencies.runTests ?? runFocusedTests;
	const writeDiagnostic = dependencies.writeDiagnostic ?? writeStructuralQualityBudgetDiagnostic;
	const { stdout, stderr } = await runTests(testFiles, options.workloadId);
	const diagnostic = parseDirectStructuralDiagnostics(
		`${stdout}\n${stderr}`, options.workloadId,
	);
	return writeDiagnostic({
		configPath: CONFIG_URL,
		outputDirectory: options.outputDirectory,
		workloadId: options.workloadId,
		metrics: diagnostic.metrics,
		observations: {
			profile: PROFILE,
			fixtureId: options.workloadId,
			diagnosticCount: diagnostic.diagnosticCount,
			testFiles,
			testStdout: stdout,
			testStderr: stderr,
		},
	});
}

export function parseDirectStructuralDiagnostics(output, workloadId) {
	const expected = METRIC_IDS[workloadId];
	if (!expected) throw new Error(`Unsupported direct structural workload ${workloadId}.`);
	const metrics = {};
	let diagnosticCount = 0;
	for (const line of output.split(/\r?\n/u)) {
		const start = line.indexOf('{');
		if (start < 0) continue;
		let value;
		try { value = JSON.parse(line.slice(start)); } catch { continue; }
		if (!isRecord(value) || value.profile !== PROFILE || value.workloadId !== workloadId
			|| value.fixtureId !== workloadId) continue;
		if (!isRecord(value.budgetMetrics)) {
			throw new Error(`Structural diagnostic ${workloadId} has no metric object.`);
		}
		diagnosticCount += 1;
		for (const [metricId, metricValue] of Object.entries(value.budgetMetrics)) {
			if (!expected.includes(metricId)) {
				throw new Error(`Structural diagnostic ${workloadId} published unexpected metric ${metricId}.`);
			}
			if (Object.hasOwn(metrics, metricId)) {
				throw new Error(`Structural diagnostic ${workloadId} duplicated metric ${metricId}.`);
			}
			if (typeof metricValue !== 'number' || !Number.isFinite(metricValue) || metricValue < 0) {
				throw new Error(`Structural diagnostic ${workloadId} metric ${metricId} is invalid.`);
			}
			metrics[metricId] = metricValue;
		}
	}
	const received = Object.keys(metrics).sort();
	const required = [...expected].sort();
	if (JSON.stringify(received) !== JSON.stringify(required)) {
		throw new Error(`Structural diagnostic ${workloadId} did not publish its exact metric set.`);
	}
	return Object.freeze({ metrics: Object.freeze(metrics), diagnosticCount });
}

async function runFocusedTests(testFiles, workloadId) {
	return execFileAsync(process.execPath, ['--import', 'tsx', '--import', new URL('./node-style-asset-loader.mjs', import.meta.url).pathname, '--test', ...testFiles], {
		cwd: REPOSITORY_ROOT,
		encoding: 'utf8',
		env: { ...process.env, SOUNDSCAPER_M2_DIRECT_STRUCTURAL_WORKLOAD: workloadId },
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
	const result = await collectDirectStructuralQualityDiagnostic({
		outputDirectory,
		workloadId: process.argv[2],
	});
	process.stdout.write(`${JSON.stringify(result.evaluation, null, '\t')}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	await main();
}
