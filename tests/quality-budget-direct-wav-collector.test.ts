import assert from 'node:assert/strict';
import test from 'node:test';

import {
	collectDirectWavQualityEvidence,
	parseDirectWavReferenceDiagnostic,
} from '../scripts/collect-m2-direct-wav-quality.mjs';

const diagnostic = Object.freeze({
	profile: 'direct-wav-385mib-counting-sha256-node-v2',
	workloadId: 'm2-direct-wav-385mib-v1',
	fixtureId: 'm2-direct-wav-385mib-v1',
	generatorRevision: 2,
	durationMs: 12_345,
	outputFileBytes: 403_701_804,
	outputSha256: 'f1978598e11527049bcafae0f1d4847238e5322e11fddf714cc9f298bf12f9fe',
	renderPackets: 193,
	budgetMetrics: {
		'directWav.maximumPathOwnedBinaryBytes': 41_943_384,
		'directWav.maximumDestinationWriteBytes': 4_194_304,
		'directWav.retainedOutputPayloadBytes': 0,
		'directWav.oversizePreflightBytesRead': 0,
		'directWav.partialPublishedOutputs': 0,
	},
});

function reporterOutput(value: unknown): string {
	return `✔ reference test\nℹ ${JSON.stringify(value)}\nℹ tests 1\n`;
}

test('the direct WAV collector admits exactly one matching structured diagnostic', async () => {
	let runCalls = 0;
	let written: unknown;
	const result = await collectDirectWavQualityEvidence({ outputDirectory: '/ignored' }, {
		runReference: async () => {
			runCalls += 1;
			return { stdout: reporterOutput(diagnostic), stderr: '' };
		},
		writeDiagnostic: async (options: unknown) => {
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
		workloadId: 'm2-direct-wav-385mib-v1',
		metrics: diagnostic.budgetMetrics,
		observations: {
			profile: diagnostic.profile,
			fixtureId: diagnostic.fixtureId,
			generatorRevision: diagnostic.generatorRevision,
			durationMs: diagnostic.durationMs,
			outputFileBytes: diagnostic.outputFileBytes,
			outputSha256: diagnostic.outputSha256,
			renderPackets: diagnostic.renderPackets,
		},
	});
	assert.deepEqual(result, {
		rawPath: '/raw',
		resultPath: '/result',
		evaluation: { passed: true, failures: [], verdicts: [] },
	});
});

test('diagnostic parsing rejects missing, duplicate, and wrong-identity records', () => {
	assert.throws(() => parseDirectWavReferenceDiagnostic('ℹ tests 1\n'), /exactly one/iu);
	assert.throws(
		() => parseDirectWavReferenceDiagnostic(
			`${reporterOutput(diagnostic)}${reporterOutput(diagnostic)}`,
		),
		/exactly one/iu,
	);
	assert.throws(
		() => parseDirectWavReferenceDiagnostic(reporterOutput({
			...diagnostic,
			fixtureId: 'another-fixture',
		})),
		/exactly one/iu,
	);
});

test('reference-process failure prevents diagnostic publication', async () => {
	let writeCalls = 0;
	await assert.rejects(
		collectDirectWavQualityEvidence({ outputDirectory: '/ignored' }, {
			runReference: async () => { throw new Error('reference failed'); },
			writeDiagnostic: async () => {
				writeCalls += 1;
				return {
					rawPath: '/raw',
					resultPath: '/result',
					evaluation: { passed: true, failures: [], verdicts: [] },
				};
			},
		}),
		/reference failed/iu,
	);
	assert.equal(writeCalls, 0);
});
