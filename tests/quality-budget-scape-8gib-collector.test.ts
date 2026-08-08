import assert from 'node:assert/strict';
import test from 'node:test';

import {
	collectScape8GibQualityEvidence,
	parseScape8GibReferenceDiagnostic,
} from '../scripts/collect-m2-scape-8gib-quality.mjs';

const diagnostic = Object.freeze({
	profile: 'exact-8-gib-sparse-full-import-counting-sha256-sink',
	workloadId: 'm2-streaming-project-8gib-v1',
	fixtureId: 'm2-streaming-project-8gib-v1',
	durationMs: 525_000,
	archiveLogicalBytes: 8_589_934_592,
	assetBytes: 8_589_932_094,
	assetSha256: '7feeb1e9eacb6561f3c5afb4ebf3896c8237660a9b4ed8917d3275c79bed38be',
	protocolRangeRequests: 2050,
	budgetMetrics: {
		'streaming.maximumProtocolRangeBytes': 16_777_216,
		'streaming.maximumMediaEmissionBytes': 4_194_304,
		'streaming.retainedMediaPayloadBytes': 0,
		'streaming.invalidPublishedRevisions': 0,
	},
	opfsQualified: false,
	processRssQualified: false,
});

function reporterOutput(value: unknown): string {
	return `✔ reference test\nℹ ${JSON.stringify(value)}\nℹ tests 1\n`;
}

test('the sparse Scape collector admits one exact reference diagnostic', async () => {
	let runCalls = 0;
	let written: unknown;
	const result = await collectScape8GibQualityEvidence({ outputDirectory: '/ignored' }, {
		runReference: async () => {
			runCalls += 1;
			return { stdout: reporterOutput(diagnostic), stderr: '' };
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
		workloadId: 'm2-streaming-project-8gib-v1',
		metrics: diagnostic.budgetMetrics,
		observations: {
			profile: diagnostic.profile,
			fixtureId: diagnostic.fixtureId,
			durationMs: diagnostic.durationMs,
			archiveLogicalBytes: diagnostic.archiveLogicalBytes,
			assetBytes: diagnostic.assetBytes,
			assetSha256: diagnostic.assetSha256,
			protocolRangeRequests: diagnostic.protocolRangeRequests,
			opfsQualified: false,
			processRssQualified: false,
		},
	});
	assert.equal(result.evaluation.passed, true);
});

test('the sparse collector rejects missing, duplicate, and wrong-identity diagnostics', () => {
	assert.throws(() => parseScape8GibReferenceDiagnostic('ℹ tests 1\n'), /exactly one/iu);
	assert.throws(
		() => parseScape8GibReferenceDiagnostic(
			`${reporterOutput(diagnostic)}${reporterOutput(diagnostic)}`,
		),
		/exactly one/iu,
	);
	assert.throws(
		() => parseScape8GibReferenceDiagnostic(reporterOutput({
			...diagnostic,
			workloadId: 'another-workload',
		})),
		/exactly one/iu,
	);
});

test('sparse reference failure prevents evidence publication', async () => {
	let writeCalls = 0;
	await assert.rejects(
		collectScape8GibQualityEvidence({ outputDirectory: '/ignored' }, {
			runReference: async () => { throw new Error('sparse reference failed'); },
			writeEvidence: async () => {
				writeCalls += 1;
				return {
					rawPath: '/raw',
					resultPath: '/result',
					evaluation: { passed: true, failures: [], verdicts: [] },
				};
			},
		}),
		/sparse reference failed/iu,
	);
	assert.equal(writeCalls, 0);
});
