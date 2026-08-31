import assert from 'node:assert/strict';
import test from 'node:test';

import {
	collectDirectStructuralQualityDiagnostic,
	parseDirectStructuralDiagnostics,
} from '../scripts/collect-m2-direct-structural-quality.mjs';

const PROFILE = 'focused-direct-structural-node-v2';
const WORKLOAD_ID = 'm2-direct-compressed-output-v2';
const METRICS = Object.freeze({
	'directCompressed.maximumStagingBytes': 268_435_456,
	'directCompressed.maximumOutputRangeBytes': 1_048_576,
	'directCompressed.maximumConcurrentRangeReads': 1,
	'directCompressed.retainedFinalOutputBytes': 0,
	'directCompressed.partialPublishedOutputs': 0,
});

test('structural diagnostics combine independently observed fragments into one exact metric set', () => {
	const entries = Object.entries(METRICS);
	const output = [
		'ordinary test output',
		diagnostic(Object.fromEntries(entries.slice(0, 2))),
		diagnostic(Object.fromEntries(entries.slice(2))),
	].join('\n');
	assert.deepEqual(parseDirectStructuralDiagnostics(output, WORKLOAD_ID), {
		metrics: METRICS,
		diagnosticCount: 2,
	});
});

test('collector publishes observed diagnostics without loading fixture specification values', async () => {
	let written: unknown;
	let receivedWorkload: string | undefined;
	const result = await collectDirectStructuralQualityDiagnostic({
		outputDirectory: '/ignored', workloadId: WORKLOAD_ID,
	}, {
		runTests: async (testFiles: readonly string[], workloadId: string) => {
			receivedWorkload = workloadId;
			assert.ok(testFiles.length >= 2);
			return { stdout: diagnostic(METRICS), stderr: '' };
		},
		writeDiagnostic: async (options: unknown) => {
			written = options;
			return {
				rawPath: '/raw', resultPath: '/result',
				evaluation: { passed: true, failures: [], verdicts: [] },
			};
		},
	});

	assert.equal(receivedWorkload, WORKLOAD_ID);
	assert.deepEqual(written, {
		configPath: new URL('../config/quality-budgets.json', import.meta.url),
		outputDirectory: '/ignored',
		workloadId: WORKLOAD_ID,
		metrics: METRICS,
		observations: {
			profile: PROFILE,
			fixtureId: WORKLOAD_ID,
			diagnosticCount: 1,
			testFiles: [
				'tests/audio-editor-export-direct-compressed-service.test.ts',
				'tests/audio-editor-export-direct-offline-compressed-service.test.ts',
				'tests/audio-editor-ffmpeg-output-stream.test.ts',
				'tests/production-direct-compressed-security.test.js',
			],
			testStdout: diagnostic(METRICS),
			testStderr: '',
		},
	});
	assert.equal(result.evaluation.passed, true);
});

test('missing, duplicate, foreign, and absent structural metrics refuse publication', () => {
	const entries = Object.entries(METRICS);
	assert.throws(
		() => parseDirectStructuralDiagnostics(diagnostic(Object.fromEntries(entries.slice(1))), WORKLOAD_ID),
		/exact metric set/iu,
	);
	assert.throws(
		() => parseDirectStructuralDiagnostics([
			diagnostic(METRICS), diagnostic({ [entries[0]![0]]: entries[0]![1] }),
		].join('\n'), WORKLOAD_ID),
		/duplicated metric/iu,
	);
	assert.throws(
		() => parseDirectStructuralDiagnostics(diagnostic({ ...METRICS, foreign: 1 }), WORKLOAD_ID),
		/unexpected metric/iu,
	);
	assert.throws(
		() => parseDirectStructuralDiagnostics('all focused tests passed', WORKLOAD_ID),
		/exact metric set/iu,
	);
});

test('unknown workloads and test failures refuse publication', async () => {
	await assert.rejects(
		collectDirectStructuralQualityDiagnostic({
			outputDirectory: '/ignored', workloadId: 'unknown',
		}, {}),
		/unsupported/iu,
	);
	let writeCalls = 0;
	await assert.rejects(
		collectDirectStructuralQualityDiagnostic({
			outputDirectory: '/ignored', workloadId: 'm2-direct-mp4-webm-video-output-v1',
		}, {
			runTests: async () => { throw new Error('focused tests failed'); },
			writeDiagnostic: async () => {
				writeCalls += 1;
				return {
					rawPath: '/raw', resultPath: '/result',
					evaluation: { passed: true, failures: [], verdicts: [] },
				};
			},
		}),
		/focused tests failed/iu,
	);
	assert.equal(writeCalls, 0);
});

function diagnostic(metrics: Readonly<Record<string, number>>): string {
	return JSON.stringify({
		profile: PROFILE,
		workloadId: WORKLOAD_ID,
		fixtureId: WORKLOAD_ID,
		budgetMetrics: metrics,
	});
}
