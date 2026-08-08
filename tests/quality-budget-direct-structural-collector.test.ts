import assert from 'node:assert/strict';
import test from 'node:test';

import {
	collectDirectStructuralQualityEvidence,
	structuralMetricsForFixture,
} from '../scripts/collect-m2-direct-structural-quality.mjs';

const FIXTURES = Object.freeze({
	'm2-direct-stem-archives-v3': {
		generatorRevision: 4,
		inputSliceBytes: 65_536,
		maximumOwnedCompressedStemBytes: 268_435_456,
		compressedMaximumOwnedEncodedStems: 1,
		directRouteFinalZipBlobConstructions: 0,
		partialPublishedOutputs: 0,
	},
	'm2-direct-compressed-output-v2': {
		generatorRevision: 3,
		offlineCentralUsefulBinaryAdmissionCeilingBytes: 268_435_456,
		maximumOutputRangeBytes: 1_048_576,
		maximumConcurrentRangeReads: 1,
		retainedFinalOutputBytes: 0,
		partialPublishedOutputs: 0,
	},
	'm2-direct-mp4-webm-video-output-v1': {
		generatorRevision: 1,
		maximumOutputRangeBytes: 1_048_576,
		maximumConcurrentRangeReads: 1,
		maximumConcurrentSinkWrites: 1,
		retainedFinalOutputBytes: 0,
		partialPublishedOutputs: 0,
	},
});

test('each direct structural fixture maps independent specification counters', () => {
	assert.deepEqual(structuralMetricsForFixture(
		'm2-direct-stem-archives-v3',
		FIXTURES['m2-direct-stem-archives-v3'],
	), {
		'directStems.maximumInputSliceBytes': 65_536,
		'directStems.maximumOwnedCompressedStemBytes': 268_435_456,
		'directStems.maximumOwnedEncodedStems': 1,
		'directStems.finalArchiveBlobBytes': 0,
		'directStems.partialPublishedOutputs': 0,
	});
	assert.deepEqual(structuralMetricsForFixture(
		'm2-direct-compressed-output-v2',
		FIXTURES['m2-direct-compressed-output-v2'],
	), {
		'directCompressed.maximumStagingBytes': 268_435_456,
		'directCompressed.maximumOutputRangeBytes': 1_048_576,
		'directCompressed.maximumConcurrentRangeReads': 1,
		'directCompressed.retainedFinalOutputBytes': 0,
		'directCompressed.partialPublishedOutputs': 0,
	});
	assert.deepEqual(structuralMetricsForFixture(
		'm2-direct-mp4-webm-video-output-v1',
		FIXTURES['m2-direct-mp4-webm-video-output-v1'],
	), {
		'directVideo.maximumOutputRangeBytes': 1_048_576,
		'directVideo.maximumConcurrentRangeReads': 1,
		'directVideo.maximumConcurrentSinkWrites': 1,
		'directVideo.retainedFinalOutputBytes': 0,
		'directVideo.partialPublishedOutputs': 0,
	});
});

test('one focused no-retry test process feeds one exact workload result', async () => {
	let runCalls = 0;
	let written: unknown;
	const workloadId = 'm2-direct-compressed-output-v2';
	const result = await collectDirectStructuralQualityEvidence({
		outputDirectory: '/ignored',
		workloadId,
	}, {
		loadConfig: async () => ({
			fixtures: [{ id: workloadId, specification: FIXTURES[workloadId] }],
		}),
		runTests: async (testFiles: readonly string[]) => {
			runCalls += 1;
			assert.ok(testFiles.length >= 2);
			return { stdout: 'all focused tests passed\n', stderr: '' };
		},
		writeEvidence: async (options: unknown) => {
			written = options;
			return {
				rawPath: '/raw',
				resultPath: '/result',
				evaluation: { passed: true, failures: [], verdicts: [] },
			};
		},
	});

	assert.equal(runCalls, 1);
	assert.deepEqual(written, {
		configPath: new URL('../config/quality-budgets.json', import.meta.url),
		outputDirectory: '/ignored',
		workloadId,
		metrics: structuralMetricsForFixture(workloadId, FIXTURES[workloadId]),
		observations: {
			profile: 'focused-direct-structural-node-v1',
			fixtureId: workloadId,
			generatorRevision: 3,
			testFiles: [
				'tests/audio-editor-export-direct-compressed-service.test.ts',
				'tests/audio-editor-export-direct-offline-compressed-service.test.ts',
				'tests/audio-editor-ffmpeg-output-stream.test.ts',
				'tests/production-direct-compressed-security.test.js',
			],
			testStdout: 'all focused tests passed\n',
			testStderr: '',
		},
	});
	assert.equal(result.evaluation.passed, true);
});

test('unknown workloads, duplicate fixtures, and test failures refuse publication', async () => {
	await assert.rejects(
		collectDirectStructuralQualityEvidence({
			outputDirectory: '/ignored', workloadId: 'unknown',
		}, {}),
		/unsupported/iu,
	);
	await assert.rejects(
		collectDirectStructuralQualityEvidence({
			outputDirectory: '/ignored', workloadId: 'm2-direct-stem-archives-v3',
		}, {
			loadConfig: async () => ({ fixtures: [
				{ id: 'm2-direct-stem-archives-v3', specification: FIXTURES['m2-direct-stem-archives-v3'] },
				{ id: 'm2-direct-stem-archives-v3', specification: FIXTURES['m2-direct-stem-archives-v3'] },
			] }),
		}),
		/exactly one fixture/iu,
	);
	let writeCalls = 0;
	await assert.rejects(
		collectDirectStructuralQualityEvidence({
			outputDirectory: '/ignored', workloadId: 'm2-direct-mp4-webm-video-output-v1',
		}, {
			loadConfig: async () => ({ fixtures: [{
				id: 'm2-direct-mp4-webm-video-output-v1',
				specification: FIXTURES['m2-direct-mp4-webm-video-output-v1'],
			}] }),
			runTests: async () => { throw new Error('focused tests failed'); },
			writeEvidence: async () => {
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
